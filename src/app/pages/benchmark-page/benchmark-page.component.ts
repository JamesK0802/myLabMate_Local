import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppStateService } from '../../services/app-state.service';

@Component({
  selector: 'app-benchmark-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './benchmark-page.component.html'
})
export class BenchmarkPageComponent {
  constructor(public state: AppStateService) {}

  onBenchFileSelected(event: any, i: number) {
    const f = event.target.files?.[0];
    if (f && f.name.match(/\.(fastq|fq)$/i)) {
      this.state.benchRows[i].file = f;
    }
  }

  buildSplitPreview() {
    if (!this.validateBenchRows()) return;
    this.state.buildSplitPreviewLocal();
  }

  runTrainBenchmark() {
    this.runBench('train');
  }

  runTestBenchmark() {
    this.runBench('test');
  }

  private runBench(subset: 'train' | 'test') {
    if (!this.validateBenchRows()) return;
    this.state.runBenchmarkLocal(subset);
  }

  private validateBenchRows(): boolean {
    for (const r of this.state.benchRows) {
      if (!r.file || !r.referenceSequence.trim() || !r.grnaSequence.trim()) {
        this.state.benchError = 'All rows must have a FASTQ file, reference sequence, and gRNA.';
        return false;
      }
    }
    return true;
  }
}
