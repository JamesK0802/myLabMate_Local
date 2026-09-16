import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { saveAs } from 'file-saver';
import { AppStateService } from '../../services/app-state.service';
import { LocalAnalysisService, LocalAnalysisEvent } from '../../services/local-analysis.service';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { parseIlluminaFilename } from '../../models/illumina.model';

@Component({
  selector: 'app-benchmark-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './benchmark-page.component.html'
})
export class BenchmarkPageComponent {
  benchmarkMode: 'classification' | 'merge' = 'classification';
  benchmarkAdvancedOpen = false;
  mergeR1File: File | null = null;
  mergeR2File: File | null = null;
  mergeMateDragging = false;
  mergeWindow = 90;
  mergeIsLoading = false;
  mergeProgress = 0;
  mergeStage = '';
  mergeError = '';
  mergeOutputFile: File | null = null;
  mergeStats: any = null;

  constructor(
    public state: AppStateService,
    private localAnalysis: LocalAnalysisService,
    private workspace: SequenceWorkspaceService,
    private cdr: ChangeDetectorRef,
  ) {}

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

  onMergeMateInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.assignMergeMateFiles(Array.from(input.files || []));
    input.value = '';
  }

  onMergeMateDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.mergeMateDragging = true;
  }

  onMergeMateDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.mergeMateDragging = false;
  }

  onMergeMateDrop(event: DragEvent): void {
    event.preventDefault();
    this.mergeMateDragging = false;
    this.assignMergeMateFiles(Array.from(event.dataTransfer?.files || []));
  }

  private assignMergeMateFiles(files: File[]): void {
    const fastqFiles = files.filter(file => /\.(?:fastq|fq)(?:\.gz)?$/i.test(file.name)).slice(0, 2);
    if (fastqFiles.length === 0) return;

    let r1 = fastqFiles.length === 2 ? null : this.mergeR1File;
    let r2 = fastqFiles.length === 2 ? null : this.mergeR2File;
    const pending: File[] = [];

    for (const file of fastqFiles) {
      const mate = parseIlluminaFilename(file.name).mate;
      if (mate === 'r1' && !r1) r1 = file;
      else if (mate === 'r2' && !r2) r2 = file;
      else pending.push(file);
    }

    for (const file of pending) {
      if (!r1) r1 = file;
      else if (!r2) r2 = file;
    }

    this.mergeR1File = r1;
    this.mergeR2File = r2;
  }

  runMergeBench(): void {
    this.mergeError = '';
    const hasInput = this.mergeR1File || this.mergeR2File;
    if (!hasInput) {
      this.mergeError = 'Provide at least one R1/R2 FASTQ file.';
      return;
    }
    this.mergeIsLoading = true;
    this.mergeProgress = 0;
    this.mergeStage = 'Preparing Illumina normalization…';
    this.mergeOutputFile = null;
    this.mergeStats = null;

    this.localAnalysis.startIlluminaMergeBench({
      r1File: this.mergeR1File,
      r2File: this.mergeR2File,
      params: { windowSize: this.mergeWindow },
    }).subscribe({
      next: (event: LocalAnalysisEvent) => {
        if (event.type === 'progress') {
          this.mergeProgress = event.percent;
          this.mergeStage = event.stage;
        } else if (event.type === 'illumina-merge-result') {
          this.mergeOutputFile = new File([event.payload.fastq], 'illumina-normalized.fastq', { type: 'text/plain' });
          this.mergeStats = event.payload.stats;
          this.mergeProgress = 100;
          this.mergeStage = 'Illumina normalization complete';
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

  downloadMergeFile(): void {
    if (this.mergeOutputFile) saveAs(this.mergeOutputFile, this.mergeOutputFile.name);
  }

  async exportMergeFile(): Promise<void> {
    if (!this.mergeOutputFile || this.mergeOutputFile.size === 0) return;
    await this.workspace.importGeneratedFastq(this.mergeOutputFile);
    this.state.switchMainTab('workspace');
  }
}
