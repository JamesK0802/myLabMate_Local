import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { saveAs } from 'file-saver';
import ExcelJS from 'exceljs';
import { AppStateService } from '../../services/app-state.service';
import { LocalAnalysisService, LocalAnalysisEvent } from '../../services/local-analysis.service';
import { AutoAlignPayload, SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import type { IlluminaMateFailureReason, IlluminaPreprocessDiagnostics } from '../../workers/core/illumina-preprocessor';
import { extractWindow, findGrnaCutSite } from '../../workers/core/classifier';
import { SequenceMatcher } from '../../workers/core/sequence-matcher';

interface MergeTargetRow {
  targetName: string;
  grnaSequence: string;
}

interface MergeGeneRow {
  geneName: string;
  referenceSequence: string;
  targets: MergeTargetRow[];
}

interface MergeWindowItem {
  geneName: string;
  targetName: string;
  sequence: string;
  cutSite: number;
  strand: string;
  pam: string;
  referenceLength: number;
  windowStart: number;
  windowEnd: number;
  grnaStart: number;
  grnaLength: number;
}

@Component({
  selector: 'app-benchmark-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './benchmark-page.component.html'
})
export class BenchmarkPageComponent {
  benchmarkMode: 'classification' | 'merge' = 'classification';
  benchmarkAdvancedOpen = false;
  mergeAdvancedOpen = false;
  mergeR1File: File | null = null;
  mergeR2File: File | null = null;
  mergeWindow = 90;
  mergePhred = 20;
  mergeMargin = 10;
  mergeDistanceWeight = 0;
  mergeExclusionFlank = 0;
  mergeGenes: MergeGeneRow[] = [this.emptyMergeGene()];
  mergeShowAutofill = false;
  mergeShowWindowCheck = false;
  mergeWindows: MergeWindowItem[] = [];
  mergeSimilarityMatrix: number[][] = [];
  mergeIsLoading = false;
  mergeProgress = 0;
  mergeStage = '';
  mergeError = '';
  mergeStage1File: File | null = null;
  mergeStage2File: File | null = null;
  mergeStage1AutoAlign: AutoAlignPayload | null = null;
  mergeStage2AutoAlign: AutoAlignPayload | null = null;
  mergeStats: any = null;
  mergeDiagnostics: IlluminaPreprocessDiagnostics | null = null;
  mergeDiagnosticLimit = 100;
  readonly mergeFailureReasons: IlluminaMateFailureReason[] = ['quality', 'no_anchor', 'no_coverage', 'no_alignment', 'no_target_window'];

  constructor(
    public state: AppStateService,
    private localAnalysis: LocalAnalysisService,
    private workspace: SequenceWorkspaceService,
    private cdr: ChangeDetectorRef,
  ) {}

  private emptyMergeTarget(): MergeTargetRow {
    return { targetName: '', grnaSequence: '' };
  }

  private emptyMergeGene(): MergeGeneRow {
    return { geneName: '', referenceSequence: '', targets: [this.emptyMergeTarget()] };
  }

  setMode(mode: 'classification' | 'merge'): void {
    this.benchmarkMode = mode;
  }

  onBenchFileSelected(event: Event, index: number, slot: 'file' | 'r1File' | 'r2File'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    if (file && /\.(?:fastq|fq)(?:\.gz)?$/i.test(file.name)) this.state.benchRows[index][slot] = file;
    input.value = '';
  }

  clearBenchFile(index: number, slot: 'file' | 'r1File' | 'r2File'): void {
    this.state.benchRows[index][slot] = null;
  }

  runBenchmark(): void {
    if (!this.validateBenchRows()) return;
    this.state.runBenchmarkLocal();
  }

  private validateBenchRows(): boolean {
    const referencesByGene = new Map<string, string>();
    for (const [index, row] of this.state.benchRows.entries()) {
      const hasInput = this.state.benchPlatform === 'illumina' ? Boolean(row.r1File || row.r2File) : Boolean(row.file);
      if (!hasInput || !row.referenceSequence.trim() || !row.grnaSequence.trim()) {
        this.state.benchError = `Row ${index + 1} requires sequencing input, reference sequence, and gRNA.`;
        return false;
      }
      const gene = row.geneName.trim() || `G${index + 1}`;
      const reference = row.referenceSequence.replace(/\s+/g, '').toUpperCase();
      const previous = referencesByGene.get(gene);
      if (previous && previous !== reference) {
        this.state.benchError = `Rows using gene name "${gene}" must use the same reference sequence.`;
        return false;
      }
      referencesByGene.set(gene, reference);
    }
    this.state.benchError = null;
    return true;
  }

  onMergeFileSelected(event: Event, slot: 'r1' | 'r2'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] || null;
    if (file && /\.(?:fastq|fq)(?:\.gz)?$/i.test(file.name)) {
      if (slot === 'r1') this.mergeR1File = file;
      else this.mergeR2File = file;
    }
    input.value = '';
  }

  addMergeGene(): void {
    this.mergeGenes.push(this.emptyMergeGene());
  }

  removeMergeGene(index: number): void {
    if (this.mergeGenes.length > 1) this.mergeGenes.splice(index, 1);
    if (this.mergeShowWindowCheck) this.recalculateMergeWindowCheck();
  }

  addMergeTarget(geneIndex: number): void {
    this.mergeGenes[geneIndex].targets.push(this.emptyMergeTarget());
  }

  removeMergeTarget(geneIndex: number, targetIndex: number): void {
    const targets = this.mergeGenes[geneIndex].targets;
    if (targets.length > 1) targets.splice(targetIndex, 1);
    if (this.mergeShowWindowCheck) this.recalculateMergeWindowCheck();
  }

  toggleMergeWindowCheck(): void {
    this.mergeShowWindowCheck = !this.mergeShowWindowCheck;
    if (this.mergeShowWindowCheck) this.recalculateMergeWindowCheck();
  }

  recalculateMergeWindowCheck(): void {
    const windows: MergeWindowItem[] = [];
    this.mergeGenes.forEach((gene, geneIndex) => {
      const reference = gene.referenceSequence.replace(/\s+/g, '').toUpperCase();
      if (!reference) return;
      gene.targets.forEach((target, targetIndex) => {
        const grna = target.grnaSequence.replace(/\s+/g, '').toUpperCase();
        if (!grna) return;
        const cut = findGrnaCutSite(reference, grna);
        const cutSite = cut.grna_start >= 0 ? cut.cut_site : Math.floor(reference.length / 2);
        const windowSize = Math.max(1, Number(this.mergeWindow) || 90);
        const windowStart = Math.max(0, cutSite - Math.floor(windowSize / 2));
        const sequence = extractWindow(reference, cutSite, windowSize);
        windows.push({
          geneName: gene.geneName.trim() || `Gene ${geneIndex + 1}`,
          targetName: target.targetName.trim() || `T${targetIndex + 1}`,
          sequence,
          cutSite: cut.grna_start >= 0 ? cut.cut_site : -1,
          strand: cut.strand,
          pam: cut.pam,
          referenceLength: reference.length,
          windowStart,
          windowEnd: Math.min(reference.length, windowStart + sequence.length),
          grnaStart: cut.grna_start,
          grnaLength: grna.length,
        });
      });
    });
    this.mergeWindows = windows;
    this.mergeSimilarityMatrix = windows.map((left, row) => windows.map((right, col) => {
      if (row === col) return 100;
      const forward = new SequenceMatcher(null, left.sequence, right.sequence).ratio();
      const reverse = new SequenceMatcher(null, right.sequence, left.sequence).ratio();
      return Math.round(((forward + reverse) / 2) * 1000) / 10;
    }));
  }

  mergeHeatmapColor(value: number, diagonal: boolean): string {
    if (diagonal) return 'rgba(46, 204, 113, 0.25)';
    if (value >= 90) return `rgba(46, 204, 113, ${0.15 + (value - 90) * 0.015})`;
    if (value >= 75) return `rgba(54, 162, 235, ${0.12 + (value - 75) * 0.01})`;
    if (value >= 50) return `rgba(255, 206, 86, ${0.12 + (value - 50) * 0.008})`;
    return 'rgba(240, 242, 245, 0.8)';
  }

  async downloadMergeTemplate(): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('References');
    worksheet.columns = [
      { header: 'Gene Name', key: 'geneName', width: 20 },
      { header: 'Gene Sequence', key: 'geneSeq', width: 50 },
      { header: 'Target Name', key: 'targetName', width: 20 },
      { header: 'gRNA Sequence', key: 'targetSeq', width: 30 },
    ];
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'CRISPR_Reference_Template.xlsx');
  }

  async onMergeTemplateUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.getWorksheet(1);
      const grouped = new Map<string, MergeGeneRow>();
      worksheet?.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const geneName = row.getCell(1).text.trim();
        const referenceSequence = row.getCell(2).text.trim();
        const targetName = row.getCell(3).text.trim();
        const grnaSequence = row.getCell(4).text.trim();
        if (!geneName || !referenceSequence || !grnaSequence) return;
        const gene = grouped.get(geneName) || { geneName, referenceSequence, targets: [] };
        gene.targets.push({ targetName: targetName || `T${gene.targets.length + 1}`, grnaSequence });
        grouped.set(geneName, gene);
      });
      if (!grouped.size) {
        this.mergeError = 'No valid reference rows were found in the Excel file.';
        return;
      }
      this.mergeGenes = [...grouped.values()];
      this.mergeShowAutofill = false;
      this.mergeError = '';
      if (this.mergeShowWindowCheck) this.recalculateMergeWindowCheck();
    } catch (error: any) {
      this.mergeError = error?.message || 'Failed to read the reference template.';
    } finally {
      // ExcelJS completes through async work that can finish outside Angular's
      // change-detection turn. Ensure newly imported genes/targets (or errors)
      // are rendered immediately without requiring another user interaction.
      this.cdr.detectChanges();
    }
  }

  runMergeBench(): void {
    this.mergeError = '';
    const hasInput = this.mergeR1File || this.mergeR2File;
    if (!hasInput) {
      this.mergeError = 'Provide at least one R1/R2 FASTQ file.';
      return;
    }
    if (this.mergeGenes.some(gene => !gene.referenceSequence.trim() || gene.targets.some(target => !target.grnaSequence.trim()))) {
      this.mergeError = 'Every gene requires a reference sequence and every target requires a gRNA.';
      return;
    }
    const genesPayload = this.buildMergeGenesPayload();
    this.mergeIsLoading = true;
    this.mergeProgress = 0;
    this.mergeStage = 'Preparing merge bench…';
    this.mergeStage1File = null;
    this.mergeStage2File = null;
    this.mergeStage1AutoAlign = null;
    this.mergeStage2AutoAlign = null;
    this.mergeStats = null;
    this.mergeDiagnostics = null;
    this.mergeDiagnosticLimit = 100;

    this.localAnalysis.startIlluminaMergeBench({
      r1File: this.mergeR1File,
      r2File: this.mergeR2File,
      genesPayload,
      params: {
        windowSize: this.mergeWindow,
        phredThreshold: this.mergePhred,
        marginThreshold: this.mergeMargin / 100,
        cutSiteDistanceWeight: this.mergeDistanceWeight,
        cutSiteExclusionFlank: this.mergeExclusionFlank,
      },
    }).subscribe({
      next: (event: LocalAnalysisEvent) => {
        if (event.type === 'progress') {
          this.mergeProgress = event.percent;
          this.mergeStage = event.stage;
        } else if (event.type === 'illumina-merge-result') {
          this.mergeStage1File = new File([event.payload.stage1Fastq], 'illumina-stage1-pseudo.fastq', { type: 'text/plain' });
          this.mergeStage2File = new File([event.payload.stage2Fastq], 'illumina-stage2-consensus.fastq', { type: 'text/plain' });
          this.mergeStage1AutoAlign = event.payload.stage1AutoAlign;
          this.mergeStage2AutoAlign = event.payload.stage2AutoAlign;
          this.mergeStats = event.payload.stats;
          this.mergeDiagnostics = event.payload.diagnostics;
          this.mergeProgress = 100;
          this.mergeStage = 'Merge bench complete';
          this.mergeIsLoading = false;
        } else if (event.type === 'error') {
          this.mergeError = event.message;
          this.mergeIsLoading = false;
        }
        this.cdr.detectChanges();
      },
      error: error => {
        this.mergeError = error?.message || 'Illumina merge bench failed.';
        this.mergeIsLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  mergeFailureLabel(reason: IlluminaMateFailureReason): string {
    switch (reason) {
      case 'quality': return 'Low quality';
      case 'no_anchor': return 'Anchor failed';
      case 'no_coverage': return 'Insufficient coverage';
      case 'no_target_window': return 'No valid target window';
      default: return 'No alignment';
    }
  }

  mergeFailureDescription(reason: IlluminaMateFailureReason): string {
    switch (reason) {
      case 'quality': return 'A candidate window was observed, but its mean Phred score was below the configured threshold.';
      case 'no_anchor': return 'A candidate alignment was found, but the required window anchors did not pass.';
      case 'no_coverage': return 'The mate did not cover enough of the requested reference window.';
      case 'no_target_window': return 'No configured reference/gRNA produced a valid target window.';
      default: return 'No compatible alignment to any configured reference/target window was found.';
    }
  }

  mergeFailureCount(reason: IlluminaMateFailureReason): number {
    return this.mergeDiagnostics?.reasonCounts?.[reason] || 0;
  }

  showMoreMergeDiagnostics(): void {
    this.mergeDiagnosticLimit += 100;
  }

  private buildMergeGenesPayload(): any[] {
    return this.mergeGenes.map((row, geneIndex) => ({
      gene: row.geneName.trim() || `G${geneIndex + 1}`,
      sequence: row.referenceSequence.replace(/\s+/g, '').toUpperCase(),
      targets: row.targets.map((target, targetIndex) => ({
        target_id: target.targetName.trim() || `T${targetIndex + 1}`,
        sgrna_seq: target.grnaSequence.replace(/\s+/g, '').toUpperCase(),
        window_size: this.mergeWindow,
      })),
    }));
  }

  downloadMergeFile(stage: 1 | 2): void {
    const file = stage === 1 ? this.mergeStage1File : this.mergeStage2File;
    if (file) saveAs(file, file.name);
  }

  async exportMergeFile(stage: 1 | 2): Promise<void> {
    const file = stage === 1 ? this.mergeStage1File : this.mergeStage2File;
    const autoAlign = stage === 1 ? this.mergeStage1AutoAlign : this.mergeStage2AutoAlign;
    if (!file || file.size === 0) return;
    await this.workspace.importGeneratedFastq(file, autoAlign || undefined);
    this.state.switchMainTab('workspace');
  }
}
