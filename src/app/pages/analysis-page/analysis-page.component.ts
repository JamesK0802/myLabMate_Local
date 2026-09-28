import { Component, ChangeDetectorRef, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AppStateService, AnalysisTab } from '../../services/app-state.service';
import { ResultDashboardComponent } from '../../components/result-dashboard/result-dashboard.component';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { Subscription } from 'rxjs';
import { findGrnaCutSite, extractWindow, cutIndexInWindow } from '../../workers/core/classifier';
import { SequenceMatcher } from '../../workers/core/sequence-matcher';
import {
  IlluminaMateSlot,
  IlluminaFilePair,
  SequencingPlatform,
  addFilesToIlluminaPairs,
  displayIlluminaPairName,
  deriveIlluminaPairName,
  moveIlluminaMate,
} from '../../models/illumina.model';

export interface ExtractedWindowItem {
  geneName: string;
  targetId: string;
  sequence: string;
  cutSiteIndex: number;
  cutSiteInWindow: number;
  pam: string;
  strand: string;

  // Visual Reference Map properties
  refLength?: number;
  grnaStart?: number;
  grnaLength?: number;
  grnaEnd?: number;
  winStart?: number;
  winEnd?: number;
  winLeftPercent?: number;
  winWidthPercent?: number;
  targetLeftPercent?: number;
  targetWidthPercent?: number;
}

export interface AlignmentCharToken {
  char: string;
  isMatch: boolean;
  isGap: boolean;
  isCutSite?: boolean;
}

export interface PairwiseComparisonData {
  target1: ExtractedWindowItem;
  target2: ExtractedWindowItem;
  similarity: number;
  tokens1: AlignmentCharToken[];
  tokens2: AlignmentCharToken[];
  matchBar: string[];
  matchCount: number;
  mismatchCount: number;
  totalLen: number;
}

interface ReferenceSource { key: string; label: string; workerKey: string; aliases: string[]; }
interface ReferenceExcelRow { geneName: string; geneSeq: string; targetName: string; targetSeq: string; }

@Component({
  selector: 'app-analysis-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResultDashboardComponent],
  templateUrl: './analysis-page.component.html',
  styleUrl: './analysis-page.component.css'
})
export class AnalysisPageComponent implements OnInit, OnDestroy {
  isSaving = false;
  showAutofill = false;
  showPerFileReferences = false;
  showSimilarWindowSettings = false;

  // ── Tab Rename State ──
  editingTabId: string | null = null;
  editingTabName: string = '';

  startRenameTab(tab: AnalysisTab, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.editingTabId = tab.id;
    this.editingTabName = tab.name;
  }

  finishRenameTab(tab: AnalysisTab) {
    if (this.editingTabId && this.editingTabName.trim()) {
      this.state.renameTab(tab.id, this.editingTabName);
    }
    this.editingTabId = null;
  }

  closeTab(event: MouseEvent, tabId: string) {
    event.stopPropagation();
    this.state.closeTab(tabId);
  }

  showWindowCheck = false;
  windowCheckSize = 90;
  isCalculatingWindowCheck = false;
  extractedWindows: ExtractedWindowItem[] = [];
  similarityMatrix: number[][] = [];

  selectedPairRowIndex: number | null = null;
  selectedPairColIndex: number | null = null;
  selectedPairComparison: PairwiseComparisonData | null = null;

  isDraggingScroll = false;
  startX = 0;
  scrollLeft = 0;

  constructor(
    public state: AppStateService,
    private cdr: ChangeDetectorRef
  ) { }

  private resultsUpdateSub?: Subscription;

  ngOnInit() {
    this.state.activateSlot('analysis');
    this.resultsUpdateSub = this.state.resultsUpdated$.subscribe(() => {
      this.cdr.detectChanges();
    });
  }

  ngOnDestroy() {
    this.resultsUpdateSub?.unsubscribe();
  }

  get sequencingPlatform(): SequencingPlatform {
    return this.state.analysisForm.get('sequencingPlatform')?.value === 'illumina' ? 'illumina' : 'nanopore';
  }

  get illuminaUnitCount(): number {
    return this.state.illuminaPairs.filter(pair => pair.r1 || pair.r2).length;
  }

  displayIlluminaPairName(pair: IlluminaFilePair): string {
    return displayIlluminaPairName(pair);
  }

  get referenceSources(): ReferenceSource[] {
    if (this.sequencingPlatform === 'illumina') {
      return this.state.illuminaPairs.filter(pair => pair.r1 || pair.r2).map(pair => {
        const label = this.barcodeName(displayIlluminaPairName(pair));
        return { key: `pair:${pair.id}`, label, workerKey: pair.id, aliases: [label, pair.name, displayIlluminaPairName(pair), pair.r1?.name || '', pair.r2?.name || ''] };
      });
    }
    return this.state.selectedFiles.map(file => ({
      key: `file:${file.name}:${file.size}:${file.lastModified}`,
      label: this.barcodeName(file.name), workerKey: file.name,
      aliases: [file.name, this.barcodeName(file.name)]
    }));
  }

  get customReferenceCount(): number { return this.referenceSources.filter(source => this.state.hasCustomReferenceConfig(source.key)).length; }
  get activeReferenceIsCustom(): boolean { return this.state.hasCustomReferenceConfig(this.state.activeReferenceKey); }
  togglePerFileReferences() {
    this.showPerFileReferences = !this.showPerFileReferences;
    if (!this.showPerFileReferences && this.state.activeReferenceKey !== 'default') this.state.selectReferenceConfig('default');
  }
  selectReferenceSource(key: string) { this.state.selectReferenceConfig(key); if (this.showWindowCheck) this.recalculateWindowCheck(); }
  useDefaultForActiveSource() {
    const key = this.state.activeReferenceKey;
    if (key === 'default') return;
    this.state.useDefaultReferenceConfig(key);
    if (this.showWindowCheck) this.recalculateWindowCheck();
  }

  setSequencingPlatform(platform: SequencingPlatform): void {
    if (this.state.activeReferenceKey !== 'default') this.state.selectReferenceConfig('default');
    this.state.analysisForm.get('sequencingPlatform')?.setValue(platform);
  }

  toggleWindowCheck() {
    this.showWindowCheck = !this.showWindowCheck;
    if (this.showWindowCheck) {
      this.windowCheckSize = Number(this.state.analysisForm.get('interestRegion')?.value) || 90;
      this.recalculateWindowCheck();
    }
  }

  onWindowCheckSizeChange(newSize: any) {
    const parsed = Number(newSize);
    this.windowCheckSize = isNaN(parsed) || parsed < 1 ? 90 : parsed;
    if (this.showWindowCheck) {
      this.recalculateWindowCheck();
    }
  }

  selectPairComparison(rIdx: number, cIdx: number) {
    if (rIdx < 0 || rIdx >= this.extractedWindows.length || cIdx < 0 || cIdx >= this.extractedWindows.length) {
      return;
    }
    this.selectedPairRowIndex = rIdx;
    this.selectedPairColIndex = cIdx;
    this.updatePairComparison();
  }

  clearPairComparison() {
    this.selectedPairRowIndex = null;
    this.selectedPairColIndex = null;
    this.selectedPairComparison = null;
  }

  // ── Drag to scroll handler for sequence alignment & heatmap table ───────
  startDragScroll(e: MouseEvent, element: HTMLElement) {
    this.isDraggingScroll = true;
    element.classList.add('dragging-scroll');
    this.startX = e.pageX - element.offsetLeft;
    this.scrollLeft = element.scrollLeft;
  }

  stopDragScroll(element: HTMLElement) {
    this.isDraggingScroll = false;
    element.classList.remove('dragging-scroll');
  }

  onDragScroll(e: MouseEvent, element: HTMLElement) {
    if (!this.isDraggingScroll) return;
    e.preventDefault();
    const x = e.pageX - element.offsetLeft;
    const walk = (x - this.startX) * 1.5;
    element.scrollLeft = this.scrollLeft - walk;
  }

  updatePairComparison() {
    if (this.selectedPairRowIndex === null || this.selectedPairColIndex === null) {
      this.selectedPairComparison = null;
      return;
    }
    const rIdx = this.selectedPairRowIndex;
    const cIdx = this.selectedPairColIndex;

    if (rIdx >= this.extractedWindows.length || cIdx >= this.extractedWindows.length) {
      this.selectedPairComparison = null;
      return;
    }

    const t1 = this.extractedWindows[rIdx];
    const t2 = this.extractedWindows[cIdx];
    const seq1 = t1.sequence;
    const seq2 = t2.sequence;
    const similarity = this.similarityMatrix[rIdx]?.[cIdx] ?? 0;

    const matcher = new SequenceMatcher(null, seq1, seq2);
    const opcodes = matcher.getOpcodes();

    const tokens1: AlignmentCharToken[] = [];
    const tokens2: AlignmentCharToken[] = [];
    const matchBar: string[] = [];
    let matchCount = 0;
    let mismatchCount = 0;

    for (const [tag, i1, i2, j1, j2] of opcodes) {
      if (tag === 'equal') {
        for (let k = 0; k < (i2 - i1); k++) {
          const idx1 = i1 + k;
          const idx2 = j1 + k;
          const c1 = seq1[idx1];
          const c2 = seq2[idx2];
          const isCut1 = idx1 === t1.cutSiteInWindow;
          const isCut2 = idx2 === t2.cutSiteInWindow;
          tokens1.push({ char: c1, isMatch: true, isGap: false, isCutSite: isCut1 });
          tokens2.push({ char: c2, isMatch: true, isGap: false, isCutSite: isCut2 });
          matchBar.push((isCut1 || isCut2) ? '✂' : '|');
          matchCount++;
        }
      } else if (tag === 'replace') {
        const len1 = i2 - i1;
        const len2 = j2 - j1;
        const maxLen = Math.max(len1, len2);
        for (let k = 0; k < maxLen; k++) {
          const idx1 = i1 + k;
          const idx2 = j1 + k;
          const c1 = k < len1 ? seq1[idx1] : '-';
          const c2 = k < len2 ? seq2[idx2] : '-';
          const isM = c1 === c2;
          const isCut1 = k < len1 && idx1 === t1.cutSiteInWindow;
          const isCut2 = k < len2 && idx2 === t2.cutSiteInWindow;
          tokens1.push({ char: c1, isMatch: isM, isGap: c1 === '-', isCutSite: isCut1 });
          tokens2.push({ char: c2, isMatch: isM, isGap: c2 === '-', isCutSite: isCut2 });
          matchBar.push((isCut1 || isCut2) ? '✂' : (isM ? '|' : '•'));
          if (isM) matchCount++; else mismatchCount++;
        }
      } else if (tag === 'delete') {
        for (let k = 0; k < (i2 - i1); k++) {
          const idx1 = i1 + k;
          const c1 = seq1[idx1];
          const isCut1 = idx1 === t1.cutSiteInWindow;
          tokens1.push({ char: c1, isMatch: false, isGap: false, isCutSite: isCut1 });
          tokens2.push({ char: '-', isMatch: false, isGap: true });
          matchBar.push(isCut1 ? '✂' : '•');
          mismatchCount++;
        }
      } else if (tag === 'insert') {
        for (let k = 0; k < (j2 - j1); k++) {
          const idx2 = j1 + k;
          const c2 = seq2[idx2];
          const isCut2 = idx2 === t2.cutSiteInWindow;
          tokens1.push({ char: '-', isMatch: false, isGap: true });
          tokens2.push({ char: c2, isMatch: false, isGap: false, isCutSite: isCut2 });
          matchBar.push(isCut2 ? '✂' : '•');
          mismatchCount++;
        }
      }
    }

    this.selectedPairComparison = {
      target1: t1,
      target2: t2,
      similarity,
      tokens1,
      tokens2,
      matchBar,
      matchCount,
      mismatchCount,
      totalLen: tokens1.length
    };
  }

  recalculateWindowCheck() {
    this.isCalculatingWindowCheck = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      try {
        const genesFormVal = this.state.analysisForm.get('genes')?.value || [];
        const customWindowEnabled = Boolean(this.state.analysisForm.get('customWindowEnabled')?.value);
        const customWindowLeft = Math.max(0, Number(this.state.analysisForm.get('customWindowLeft')?.value) || 0);
        const customWindowRight = Math.max(0, Number(this.state.analysisForm.get('customWindowRight')?.value) || 0);
        const displayWindowSize = customWindowEnabled ? customWindowLeft + customWindowRight : this.windowCheckSize;
        const extracted: ExtractedWindowItem[] = [];

        genesFormVal.forEach((g: any, gi: number) => {
          const geneName = g.gene_name?.trim() || `Gene ${gi + 1}`;
          const refSeq = (g.gene_reference || '').trim().toUpperCase();
          if (!refSeq) return;

          (g.geneTargets || []).forEach((t: any, ti: number) => {
            const targetId = t.target_id?.trim() || `T${ti + 1}`;
            const grna = (t.gRNA || '').trim().toUpperCase();
            if (!grna) return;

            const cutInfo = findGrnaCutSite(refSeq, grna);
            let cutSite = cutInfo.cut_site;
            if (cutSite < 0 || cutSite >= refSeq.length) {
              cutSite = Math.floor(refSeq.length / 2);
            }

            const winSeq = extractWindow(refSeq, cutSite, displayWindowSize,
              customWindowEnabled ? customWindowLeft : undefined,
              customWindowEnabled ? customWindowRight : undefined);
            const cutWinIdx = cutInfo.grna_start !== -1 ? cutIndexInWindow(refSeq, cutSite, displayWindowSize,
              customWindowEnabled ? customWindowLeft : undefined,
              customWindowEnabled ? customWindowRight : undefined) : -1;

            const refLength = refSeq.length;
            const grnaStart = cutInfo.grna_start;
            const grnaLength = grna.length;
            const grnaEnd = grnaStart >= 0 ? grnaStart + grnaLength : -1;

            let winStart = 0;
            let winEnd = 0;
            if (cutSite >= 0) {
              const left = customWindowEnabled ? customWindowLeft : Math.floor(displayWindowSize / 2);
              const right = customWindowEnabled ? customWindowRight : Math.floor(displayWindowSize / 2);
              winStart = Math.max(0, cutSite - left);
              winEnd = Math.min(refLength, cutSite + right);
            }

            const winLeftPercent = refLength > 0 ? (winStart / refLength) * 100 : 0;
            const winWidthPercent = refLength > 0 ? ((winEnd - winStart) / refLength) * 100 : 0;
            const targetLeftPercent = (grnaStart >= 0 && refLength > 0) ? (grnaStart / refLength) * 100 : 0;
            const targetWidthPercent = (grnaStart >= 0 && refLength > 0) ? (grnaLength / refLength) * 100 : 0;

            extracted.push({
              geneName,
              targetId,
              sequence: winSeq,
              cutSiteIndex: cutInfo.grna_start !== -1 ? cutSite : -1,
              cutSiteInWindow: cutWinIdx,
              pam: cutInfo.pam,
              strand: cutInfo.strand,
              refLength,
              grnaStart: grnaStart >= 0 ? grnaStart : undefined,
              grnaLength,
              grnaEnd: grnaEnd >= 0 ? grnaEnd : undefined,
              winStart,
              winEnd,
              winLeftPercent,
              winWidthPercent,
              targetLeftPercent: grnaStart >= 0 ? targetLeftPercent : undefined,
              targetWidthPercent: grnaStart >= 0 ? targetWidthPercent : undefined
            });
          });
        });

        this.extractedWindows = extracted;
        const n = extracted.length;
        const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

        for (let i = 0; i < n; i++) {
          matrix[i][i] = 100.0;
          for (let j = i + 1; j < n; j++) {
            const sim = this.calculateSymmetricSimilarity(extracted[i].sequence, extracted[j].sequence);
            matrix[i][j] = sim;
            matrix[j][i] = sim;
          }
        }
        this.similarityMatrix = matrix;

        if (this.selectedPairRowIndex !== null && this.selectedPairColIndex !== null) {
          this.updatePairComparison();
        }
      } catch (err) {
        console.error('Error calculating window check matrix:', err);
      } finally {
        this.isCalculatingWindowCheck = false;
        this.cdr.detectChanges();
      }
    }, 50);
  }

  calculateSymmetricSimilarity(seq1: string, seq2: string): number {
    if (!seq1 || !seq2) return 0;
    if (seq1 === seq2) return 100.0;

    if (seq1.length === seq2.length && seq1.length > 0) {
      let matchCount = 0;
      for (let k = 0; k < seq1.length; k++) {
        if (seq1[k] === seq2[k]) {
          matchCount++;
        }
      }
      return Math.round((matchCount / seq1.length) * 1000) / 10;
    }

    const m1 = new SequenceMatcher(null, seq1, seq2).ratio();
    const m2 = new SequenceMatcher(null, seq2, seq1).ratio();
    return Math.round(((m1 + m2) / 2.0) * 1000) / 10;
  }

  itemLabel(w: ExtractedWindowItem): string {
    return `${w.geneName} - ${w.targetId}`;
  }

  getHeatmapColor(val: number, isDiagonal: boolean): string {
    if (isDiagonal) {
      return 'rgba(46, 204, 113, 0.25)'; // Soft green highlight for diagonal 100%
    }
    if (val >= 90) return `rgba(46, 204, 113, ${0.15 + (val - 90) * 0.015})`;
    if (val >= 75) return `rgba(54, 162, 235, ${0.12 + (val - 75) * 0.01})`;
    if (val >= 50) return `rgba(255, 206, 86, ${0.12 + (val - 50) * 0.008})`;
    return `rgba(240, 242, 245, 0.8)`;
  }

  async downloadTemplate() {
    await this.downloadReferenceWorkbook(false);
  }

  async downloadCurrentSetup() {
    this.state.saveActiveReferenceConfig();
    const suggested = 'CRISPR_Reference_Config';
    const requested = prompt('File name for the current configuration', suggested);
    if (requested === null) return;
    await this.downloadReferenceWorkbook(true, this.safeDownloadFileName(requested, suggested));
  }

  private async downloadReferenceWorkbook(includeCurrent: boolean, requestedFileName?: string) {
    const workbook = new ExcelJS.Workbook();
    const usedNames = new Set<string>();
    const addSheet = (name: string, genes: any[] = []) => {
      const worksheet = workbook.addWorksheet(this.safeWorksheetName(name, usedNames));
      worksheet.columns = [
      { header: 'Gene Name', key: 'geneName', width: 20 },
      { header: 'Gene Sequence', key: 'geneSeq', width: 50 },
      { header: 'Target Name', key: 'targetName', width: 20 },
      { header: 'gRNA Sequence', key: 'targetSeq', width: 30 }
      ];
      worksheet.getRow(1).font = { bold: true };
      worksheet.views = [{ state: 'frozen', ySplit: 1 }];
      for (const row of this.genesToRows(genes)) worksheet.addRow(row);
    };
    addSheet('Default', includeCurrent ? this.state.referenceGenes('default') : []);
    for (const source of this.referenceSources) {
      if (!includeCurrent || this.state.hasCustomReferenceConfig(source.key)) addSheet(source.label, includeCurrent ? this.state.referenceGenes(source.key) : []);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), includeCurrent ? `${requestedFileName || 'CRISPR_Reference_Config'}.xlsx` : 'CRISPR_Reference_Template.xlsx');
  }

  private safeDownloadFileName(value: string, fallback: string): string {
    const withoutExtension = value.trim().replace(/\.xlsx?$/i, '');
    return (withoutExtension.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback).slice(0, 120);
  }

  async onTemplateUpload(event: any) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sourceByAlias = new Map<string, ReferenceSource>();
      for (const source of this.referenceSources) {
        for (const alias of [...source.aliases, this.safeWorksheetBase(source.label)]) if (alias) sourceByAlias.set(this.normalizedBarcode(alias), source);
      }
      let loadedRows = 0;
      let defaultLoaded = false;
      const customSources: ReferenceSource[] = [];
      const unmatchedSheets: string[] = [];
      for (const worksheet of workbook.worksheets) {
        const rows = this.worksheetRows(worksheet);
        if (!rows.length) continue;
        const normalizedName = this.normalizedBarcode(worksheet.name);
        const isDefault = ['default', 'references', 'reference'].includes(normalizedName);
        if (workbook.worksheets.length === 1 || isDefault) {
          this.state.setReferenceConfig('default', this.rowsToGenes(rows));
          defaultLoaded = true; loadedRows += rows.length; continue;
        }
        const source = sourceByAlias.get(normalizedName);
        if (!source) { unmatchedSheets.push(worksheet.name); continue; }
        this.state.setReferenceConfig(source.key, this.rowsToGenes(rows));
        customSources.push(source); loadedRows += rows.length;
      }
      if (!loadedRows) { alert('No valid reference rows were found. Use Default or a sheet named after a file.'); return; }
      if (customSources.length) { this.showPerFileReferences = true; this.state.selectReferenceConfig(customSources[0].key); }
      else if (defaultLoaded) this.state.selectReferenceConfig('default');
      this.showAutofill = false;
      this.cdr.detectChanges();
      const skipped = unmatchedSheets.length ? ` Skipped unmatched sheets: ${unmatchedSheets.join(', ')}.` : '';
      alert(`Loaded ${loadedRows} reference target${loadedRows === 1 ? '' : 's'}${customSources.length ? ` with ${customSources.length} file override${customSources.length === 1 ? '' : 's'}` : ''}.${skipped}`);
    } catch (error) {
      console.error('Failed to import reference workbook', error);
      alert('The Excel file could not be read. Please check the workbook format.');
    } finally { input.value = ''; }
  }

  async onCurrentFileTemplateUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const activeKey = this.state.activeReferenceKey;
    const source = this.referenceSources.find(item => item.key === activeKey);
    if (!file || activeKey === 'default' || !source) {
      input.value = '';
      if (file) alert('Select a file tab before applying a file-specific configuration.');
      return;
    }
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      let worksheet: ExcelJS.Worksheet | undefined;
      if (workbook.worksheets.length === 1) worksheet = workbook.worksheets[0];
      else {
        const activeName = this.normalizedBarcode(source.label);
        worksheet = workbook.worksheets.find(sheet => this.normalizedBarcode(sheet.name) === activeName);
        if (!worksheet) worksheet = workbook.worksheets.find(sheet => ['default', 'references', 'reference'].includes(this.normalizedBarcode(sheet.name)));
      }
      if (!worksheet) { alert(`No sheet named “${source.label}” or “Default” was found in this workbook.`); return; }
      const rows = this.worksheetRows(worksheet);
      if (!rows.length) { alert(`The “${worksheet.name}” sheet does not contain valid reference rows.`); return; }
      this.state.setReferenceConfig(activeKey, this.rowsToGenes(rows));
      this.state.selectReferenceConfig(activeKey);
      this.showPerFileReferences = true; this.showAutofill = false;
      if (this.showWindowCheck) this.recalculateWindowCheck();
      this.cdr.detectChanges();
      alert(`Applied ${rows.length} reference target${rows.length === 1 ? '' : 's'} to ${source.label} from “${worksheet.name}”.`);
    } catch (error) {
      console.error('Failed to import current-file reference workbook', error);
      alert('The Excel file could not be read. Please check the workbook format.');
    } finally { input.value = ''; }
  }

  onFileSelected(event: any) {
    this.addSequencingFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  onFileDropped(event: DragEvent) {
    event.preventDefault();
    this.state.isDragging = false;
    if (event.dataTransfer?.files) {
      this.addSequencingFiles(Array.from(event.dataTransfer.files));
    }
  }

  onDragOver(event: DragEvent) { event.preventDefault(); this.state.isDragging = true; }
  onDragLeave(event: DragEvent) { event.preventDefault(); this.state.isDragging = false; }
  removeFile(i: number) {
    const removed = this.referenceSources[i];
    this.state.selectedFiles.splice(i, 1);
    if (removed?.key === this.state.activeReferenceKey) this.state.selectReferenceConfig('default');
  }

  private addSequencingFiles(files: File[]): void {
    const fastqFiles = files.filter(file => /\.(?:fastq|fq)(?:\.gz)?$/i.test(file.name));
    if (this.sequencingPlatform === 'illumina') {
      this.state.illuminaPairs = addFilesToIlluminaPairs(this.state.illuminaPairs, fastqFiles);
    } else {
      this.state.selectedFiles.push(...fastqFiles);
    }
  }

  removeIlluminaMate(pairId: string, slot: IlluminaMateSlot): void {
    const pair = this.state.illuminaPairs.find(item => item.id === pairId);
    if (!pair) return;
    pair[slot] = null;
    if (!pair.r1 && !pair.r2) {
      this.state.illuminaPairs = this.state.illuminaPairs.filter(item => item.id !== pairId);
      if (`pair:${pairId}` === this.state.activeReferenceKey) this.state.selectReferenceConfig('default');
    } else {
      pair.name = deriveIlluminaPairName(pair);
    }
  }

  startMateDrag(event: DragEvent, pairId: string, slot: IlluminaMateSlot): void {
    event.stopPropagation();
    event.dataTransfer?.setData('application/x-illumina-mate', JSON.stringify({ pairId, slot }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  allowMateDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  dropMate(event: DragEvent, targetPairId: string, targetSlot: IlluminaMateSlot): void {
    event.preventDefault();
    event.stopPropagation();
    const encoded = event.dataTransfer?.getData('application/x-illumina-mate');
    if (!encoded) return;
    try {
      const source = JSON.parse(encoded) as { pairId: string; slot: IlluminaMateSlot };
      this.state.illuminaPairs = moveIlluminaMate(
        this.state.illuminaPairs,
        source.pairId,
        source.slot,
        targetPairId,
        targetSlot
      );
    } catch {
      return;
    }
  }

  runAnalysis() {
    this.state.saveActiveReferenceConfig();
    const rawValue = this.state.analysisForm.value;
    const formInvalid = this.state.analysisForm.get('interestRegion')?.invalid;

    const platform: SequencingPlatform = rawValue.sequencingPlatform === 'illumina' ? 'illumina' : 'nanopore';
    const inputCount = platform === 'illumina' ? this.illuminaUnitCount : this.state.selectedFiles.length;
    const invalidSource = [{ key: 'default', label: 'Default' }, ...this.referenceSources]
      .find(source => (source.key === 'default' || this.state.hasCustomReferenceConfig(source.key)) && !this.validGenes(this.state.referenceGenes(source.key)));
    if (formInvalid || inputCount === 0 || invalidSource) {
      this.state.error = invalidSource ? `Reference configuration for ${invalidSource.label} is incomplete.` : 'Validation failed. Check files and parameters.';
      return;
    }

    this.state.error = null;

    const phredVal = rawValue.phredThreshold ?? 20;
    const rescueThreshold = rawValue.rescueThreshold ?? 20;
    const indelVal = (rawValue.indelPercent ?? 1) * 1.0;
    const marginVal = (rawValue.marginPercent ?? 3) / 100;

    const distanceWeight = Number(rawValue.cutSiteDistanceWeight ?? 0);
    const exclusionFlank = Number(rawValue.cutSiteExclusionFlank ?? 0);
    const customWindowEnabled = Boolean(rawValue.customWindowEnabled);
    const customWindowLeft = Math.max(0, Number(rawValue.customWindowLeft) || 0);
    const customWindowRight = Math.max(0, Number(rawValue.customWindowRight) || 0);
    const windowSize = customWindowEnabled
      ? customWindowLeft + customWindowRight
      : Number(rawValue.interestRegion ?? 90);

    this.state.lastRunParams = {
      windowSize,
      phredThreshold: phredVal,
      indelThreshold: indelVal,
      assignmentMargin: (rawValue.marginPercent ?? 3),
      rescueThreshold: rescueThreshold,
      cutSiteDistanceWeight: distanceWeight,
      cutSiteExclusionFlank: exclusionFlank,
      customWindowEnabled,
      customWindowLeft: customWindowEnabled ? customWindowLeft : undefined,
      customWindowRight: customWindowEnabled ? customWindowRight : undefined,
      analyzeAmbiguous: rawValue.analyzeAmbiguous || false,
      rescueAmbiguous: rawValue.rescueAmbiguous || false,
      dataType: platform === 'illumina' ? 'paired-end' : 'single-end',
      fileCount: inputCount
    };

    const toPayload = (genes: any[]) => this.buildSequenceBasedPayload(genes, windowSize, customWindowEnabled, customWindowLeft, customWindowRight);
    const genesPayload = toPayload(this.state.referenceGenes('default'));
    const genesByInput: Record<string, any[]> = {};
    for (const source of this.referenceSources) {
      if (this.state.hasCustomReferenceConfig(source.key)) genesByInput[source.workerKey] = toPayload(this.state.referenceGenes(source.key));
    }

    // ── Local Mode: run entirely in browser ──────────────────────────────────
    this.state.runLocalAnalysis(
      [...this.state.selectedFiles],
      genesPayload,
      {
        phredThreshold: phredVal,
        indelThreshold: indelVal,
        marginThreshold: marginVal,
        windowSize,
        analyzeAmbiguous: rawValue.analyzeAmbiguous || false,
        rescueAmbiguous: rawValue.rescueAmbiguous || false,
        rescueThreshold: rescueThreshold,
        cutSiteDistanceWeight: distanceWeight,
        cutSiteExclusionFlank: exclusionFlank,
        sequencingPlatform: platform,
      },
      platform === 'illumina' ? this.state.illuminaPairs.map(pair => ({ ...pair })) : [],
      genesByInput
    );
  }

  private barcodeName(filename: string): string { return filename.replace(/\.(?:fastq|fq)(?:\.gz)?$/i, '') || filename; }
  private normalizedBarcode(value: string): string { return this.barcodeName(value).trim().toLowerCase().replace(/[\s._-]+/g, ''); }

  private buildSequenceBasedPayload(genes: any[], windowSize: number, customWindowEnabled: boolean, customWindowLeft: number, customWindowRight: number): any[] {
    const normalized = (value: unknown) => String(value ?? '').replace(/\s+/g, '').toUpperCase();
    const referenceGroups = new Map<string, { names: string[]; sequence: string; targets: Map<string, string[]> }>();
    genes.forEach((gene: any, geneIndex: number) => {
      const sequence = normalized(gene.gene_reference);
      if (!sequence) return;
      let group = referenceGroups.get(sequence);
      if (!group) { group = { names: [], sequence, targets: new Map() }; referenceGroups.set(sequence, group); }
      const geneName = gene.gene_name?.trim() || `G${geneIndex + 1}`;
      if (!group.names.includes(geneName)) group.names.push(geneName);
      (gene.geneTargets || []).forEach((target: any, targetIndex: number) => {
        const targetSequence = normalized(target.gRNA);
        if (!targetSequence) return;
        const targetName = target.target_id?.trim() || `T${targetIndex + 1}`;
        const aliases = group!.targets.get(targetSequence) || [];
        if (!aliases.includes(targetName)) aliases.push(targetName);
        group!.targets.set(targetSequence, aliases);
      });
    });
    return [...referenceGroups.values()].map((group, geneIndex) => ({
      gene: `reference-${geneIndex + 1}`,
      display_gene: group.names.join('/') || `G${geneIndex + 1}`,
      sequence: group.sequence,
      targets: [...group.targets.entries()].map(([sgrnaSeq, names]) => ({
        target_id: names.join('/'), sgrna_seq: sgrnaSeq, reference_seq: group.sequence,
        window_size: windowSize,
        window_left: customWindowEnabled ? customWindowLeft : undefined,
        window_right: customWindowEnabled ? customWindowRight : undefined
      }))
    }));
  }

  private safeWorksheetBase(value: string): string { return (value.replace(/[\\/?*:[\]]/g, ' ').replace(/\s+/g, ' ').trim() || 'Barcode').slice(0, 31); }
  private safeWorksheetName(value: string, used: Set<string>): string {
    const base = this.safeWorksheetBase(value); let name = base; let suffix = 2;
    while (used.has(name.toLowerCase())) { const tail = ` ${suffix++}`; name = `${base.slice(0, 31 - tail.length)}${tail}`; }
    used.add(name.toLowerCase()); return name;
  }
  private worksheetRows(worksheet: ExcelJS.Worksheet): ReferenceExcelRow[] {
    const rows: ReferenceExcelRow[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const item = { geneName: row.getCell(1).text.trim(), geneSeq: row.getCell(2).text.replace(/\s+/g, '').toUpperCase(), targetName: row.getCell(3).text.trim(), targetSeq: row.getCell(4).text.replace(/\s+/g, '').toUpperCase() };
      if (item.geneName && item.geneSeq && item.targetSeq) rows.push(item);
    });
    return rows;
  }
  private rowsToGenes(rows: ReferenceExcelRow[]): any[] {
    const genes = new Map<string, { names: string[]; gene_reference: string; targets: Map<string, string[]> }>();
    for (const row of rows) {
      let gene = genes.get(row.geneSeq);
      if (!gene) { gene = { names: [], gene_reference: row.geneSeq, targets: new Map() }; genes.set(row.geneSeq, gene); }
      if (!gene.names.includes(row.geneName)) gene.names.push(row.geneName);
      const names = gene.targets.get(row.targetSeq) || [];
      const targetName = row.targetName || `T${gene.targets.size + 1}`;
      if (!names.includes(targetName)) names.push(targetName);
      gene.targets.set(row.targetSeq, names);
    }
    return [...genes.values()].map(gene => ({ gene_name: gene.names.join('/'), gene_reference: gene.gene_reference, geneTargets: [...gene.targets.entries()].map(([gRNA, names]) => ({ target_id: names.join('/'), gRNA })) }));
  }
  private genesToRows(genes: any[]): ReferenceExcelRow[] { return genes.flatMap(gene => (gene.geneTargets || []).map((target: any) => ({ geneName: gene.gene_name || '', geneSeq: gene.gene_reference || '', targetName: target.target_id || '', targetSeq: target.gRNA || '' }))); }
  private validGenes(genes: any[]): boolean { return genes.length > 0 && genes.every(gene => Boolean(gene.gene_reference?.trim()) && Array.isArray(gene.geneTargets) && gene.geneTargets.length > 0 && gene.geneTargets.every((target: any) => Boolean(target.gRNA?.trim()))); }
}
