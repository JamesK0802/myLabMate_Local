import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AppStateService, AnalysisTab } from '../../services/app-state.service';
import { ResultDashboardComponent } from '../../components/result-dashboard/result-dashboard.component';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { findGrnaCutSite, extractWindow, cutIndexInWindow } from '../../workers/core/classifier';
import { SequenceMatcher } from '../../workers/core/sequence-matcher';

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

@Component({
  selector: 'app-analysis-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResultDashboardComponent],
  templateUrl: './analysis-page.component.html'
})
export class AnalysisPageComponent implements OnInit {
  isSaving = false;
  showAutofill = false;
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

  ngOnInit() {
    this.state.activateSlot('analysis');
  }

  toggleWindowCheck() {
    this.showWindowCheck = !this.showWindowCheck;
    if (this.showWindowCheck) {
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

            const winSeq = extractWindow(refSeq, cutSite, this.windowCheckSize);
            const cutWinIdx = cutInfo.grna_start !== -1 ? cutIndexInWindow(refSeq, cutSite, this.windowCheckSize) : -1;

            const refLength = refSeq.length;
            const grnaStart = cutInfo.grna_start;
            const grnaLength = grna.length;
            const grnaEnd = grnaStart >= 0 ? grnaStart + grnaLength : -1;

            let winStart = 0;
            let winEnd = 0;
            if (cutSite >= 0) {
              const halfWin = Math.floor(this.windowCheckSize / 2);
              winStart = Math.max(0, cutSite - halfWin);
              winEnd = Math.min(refLength, winStart + this.windowCheckSize);
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
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('References');
    worksheet.columns = [
      { header: 'Gene Name', key: 'geneName', width: 20 },
      { header: 'Gene Sequence', key: 'geneSeq', width: 50 },
      { header: 'Target Name', key: 'targetName', width: 20 },
      { header: 'gRNA Sequence', key: 'targetSeq', width: 30 }
    ];
    
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'CRISPR_Reference_Template.xlsx');
  }

  async onTemplateUpload(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    const workbook = new ExcelJS.Workbook();
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const buffer = e.target.result;
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);
      const rows: any[] = [];
      worksheet?.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const geneName = row.getCell(1).text;
        const geneSeq = row.getCell(2).text;
        const targetName = row.getCell(3).text;
        const targetSeq = row.getCell(4).text;
        if (geneName && geneSeq && targetSeq) rows.push({ geneName, geneSeq, targetName, targetSeq });
      });
      if (rows.length > 0) {
        this.state.setGenesBulk(rows);
        this.showAutofill = false;
        this.cdr.detectChanges();
        alert(`Successfully loaded ${rows.length} reference targets!`);
      } else {
        alert('No valid data found in Excel. Please check the template.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.match(/\.(fastq|fq)$/)) this.state.selectedFiles.push(files[i]);
    }
  }

  onFileDropped(event: DragEvent) {
    event.preventDefault();
    this.state.isDragging = false;
    if (event.dataTransfer?.files) {
      const files = event.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        if (files[i].name.match(/\.(fastq|fq)$/)) this.state.selectedFiles.push(files[i]);
      }
    }
  }

  onDragOver(event: DragEvent) { event.preventDefault(); this.state.isDragging = true; }
  onDragLeave(event: DragEvent) { event.preventDefault(); this.state.isDragging = false; }
  removeFile(i: number) { this.state.selectedFiles.splice(i, 1); }

  runAnalysis() {
    const rawValue = this.state.analysisForm.value;
    const formInvalid = this.state.analysisForm.get('genes')?.invalid || this.state.analysisForm.get('interestRegion')?.invalid;

    if (formInvalid || this.state.selectedFiles.length === 0) {
      this.state.error = 'Validation failed. Check files and parameters.';
      return;
    }

    this.state.error = null;

    const phredVal = rawValue.phredThreshold ?? 20;
    const rescueThreshold = rawValue.rescueThreshold ?? 20;
    const indelVal = (rawValue.indelPercent ?? 1) * 1.0;
    const marginVal = (rawValue.marginPercent ?? 3) / 100;

    const distanceWeight = Number(rawValue.cutSiteDistanceWeight ?? 0);
    const exclusionFlank = Number(rawValue.cutSiteExclusionFlank ?? 0);

    this.state.lastRunParams = {
      windowSize: rawValue.interestRegion ?? 90,
      phredThreshold: phredVal,
      indelThreshold: indelVal,
      assignmentMargin: (rawValue.marginPercent ?? 3),
      rescueThreshold: rescueThreshold,
      cutSiteDistanceWeight: distanceWeight,
      cutSiteExclusionFlank: exclusionFlank,
      analyzeAmbiguous: rawValue.analyzeAmbiguous || false,
      rescueAmbiguous: rawValue.rescueAmbiguous || false,
      dataType: 'single-end',
      fileCount: this.state.selectedFiles.length
    };

    const genesPayload = rawValue.genes.map((g: any, gi: number) => ({
      gene: g.gene_name?.trim() || `G${gi + 1}`,
      sequence: g.gene_reference,
      targets: g.geneTargets.map((t: any, ti: number) => ({
        target_id: t.target_id?.trim() || `T${ti + 1}`,
        sgrna_seq: t.gRNA,
        reference_seq: g.gene_reference,
        window_size: Number(rawValue.interestRegion ?? 90)
      }))
    }));

    // ── Local Mode: run entirely in browser ──────────────────────────────────
    this.state.runLocalAnalysis(
      [...this.state.selectedFiles],
      genesPayload,
      {
        phredThreshold: phredVal,
        indelThreshold: indelVal,
        marginThreshold: marginVal,
        windowSize: Number(rawValue.interestRegion ?? 90),
        analyzeAmbiguous: rawValue.analyzeAmbiguous || false,
        rescueAmbiguous: rawValue.rescueAmbiguous || false,
        rescueThreshold: rescueThreshold,
        cutSiteDistanceWeight: distanceWeight,
        cutSiteExclusionFlank: exclusionFlank,
      }
    );
  }
}
