import { Component, ChangeDetectorRef, NgZone, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AppStateService } from '../../services/app-state.service';
import { Chart } from 'chart.js/auto';

import { MutationGroup } from '../../models/analysis.model';
import { groupKey } from '../../models/curation.model';

@Component({
  selector: 'app-result-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './result-dashboard.component.html'
})
export class ResultDashboardComponent implements OnInit, OnDestroy {
  isSaving = false;
  mobileActionsOpen = false;
  mobileGeneInfoOpen = false;
  mobileChartsOpen = false;

  isDraggingScroll = false;
  startX = 0;
  scrollLeft = 0;

  startDragScroll(e: MouseEvent, element: HTMLElement) {
    const targetEl = e.target as HTMLElement;
    if (targetEl.tagName === 'BUTTON' || targetEl.tagName === 'INPUT' || targetEl.closest('.exclude-btn-group') || targetEl.closest('button')) {
      return;
    }
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

  constructor(
    public state: AppStateService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}


  ngOnInit() {
    this.state.resultsUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.refreshDashboard();
    });

    if (this.state.genes.length > 0) {
      this.refreshDashboard();
    }
  }

  private destroy$ = new Subject<void>();

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.state.destroyCharts();
  }

  selectGene(index: number) {
    this.state.selectedGeneIndex = index;
    this.state.selectedRowIndex = 0;
    this.state.destroyCharts();
    this.refreshDashboard();
  }

  selectScope(index: number) {
    this.state.selectedScopeIndex = index;
    this.state.updateVisibleGenes();
    this.refreshDashboard();
  }

  onMobileScopeChange(event: Event) {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectScope(value);
  }

  runMobileResultAction(action: string) {
    this.mobileActionsOpen = false;
    switch (action) {
      case 'curate':
        this.enterCuratedView();
        break;
      case 'original':
        this.exitCuratedView();
        break;
      case 'new-analysis':
        this.state.newAnalysis();
        break;
      case 'new-view':
        this.state.newViewer();
        break;
      case 'export':
        this.state.exportToExcel();
        break;
      case 'export-curated':
        this.state.exportCuratedToExcel();
        break;
    }
  }

  selectRow(index: number) {
    this.state.selectedRowIndex = index;
    this.refreshDashboard();
  }

  get flatTargets() {
    if (!this.state.currentGene) return [];
    return (this.state.currentGene.analysis_result.targets || []).map(t => ({
      file: { fastq_file: '', sample_name: this.state.currentGene!.gene, target_results: [] as any[] },
      target: t
    }));
  }

  get summaryTableData() {
    return this.flatTargets.map((item, index) => ({
      index,
      sample: this.state.currentGene?.gene ?? 'Gene',
      target: item.target.target_id,
      total: item.target.summary?.total_reads ?? 0,
      matched: item.target.summary?.aligned_reads ?? 0,
      outOfFrame: item.target.summary?.out_of_frame_pct ?? 0,
      inFrame: item.target.summary?.in_frame_pct ?? 0,
      noIndel: item.target.summary?.no_indel_pct ?? 0,
      substitution: item.target.summary?.substitution_pct ?? 0
    }));
  }

  refreshDashboard() {
    this.ngZone.run(() => {
      const gene = this.state.currentGene;
      if (!gene?.analysis_result?.targets?.length) return;
      const targets = gene.analysis_result.targets;
      const idx = Math.min(this.state.selectedRowIndex, targets.length - 1);
      this.state.selectedTarget = targets[idx];

      if (!this.state.selectedTarget) {
        this.cdr.detectChanges();
        return;
      }

      this.state.metrics = {
        totalReads: this.state.selectedTarget.summary?.total_reads ?? 0,
        alignedReads: this.state.selectedTarget.summary?.aligned_reads ?? 0,
        avgOutOfFrame: this.state.selectedTarget.summary?.out_of_frame_pct ?? 0,
        avgInFrame: this.state.selectedTarget.summary?.in_frame_pct ?? 0,
        avgNoIndel: this.state.selectedTarget.summary?.no_indel_pct ?? 0,
        avgSubstitution: this.state.selectedTarget.summary?.substitution_pct ?? 0,
      };

      this.cdr.detectChanges();

      setTimeout(() => {
        this.ngZone.run(() => {
          this.updateChartsForSelected();
          this.centerAnnotation();
          this.cdr.detectChanges();
        });
      }, 64);
    });
  }

  private centerAnnotation() {
    const container = document.querySelector('.unified-anno-container');
    if (!container || !this.state.selectedTarget) return;
    const cutIdx = this.state.selectedTarget.cut_site_index || 0;
    const stickyLeftWidth = 150;
    const baseWidth = 13;
    const padding = 15;
    const xPos = stickyLeftWidth + (cutIdx * baseWidth) + padding;
    const viewportWidth = container.clientWidth;
    const targetScroll = xPos - (viewportWidth / 2);
    container.scrollLeft = Math.max(0, targetScroll);
  }

  private updateChartsForSelected() {
    this.state.destroyCharts();
    const flat = this.flatTargets;
    if (!flat.length || !this.state.selectedTarget) return;
    const safeIdx = Math.min(this.state.selectedRowIndex, flat.length - 1);
    const selectedData = flat[safeIdx].target;

    const indelCtx = document.getElementById('indelChart') as HTMLCanvasElement;
    if (indelCtx) {
      this.state.addChart(new Chart(indelCtx, {
        type: 'bar',
        data: {
          labels: flat.map(item => this.state.isMultiReference ? item.target.target_id : `${item.file.sample_name || item.file.fastq_file.split('/').pop()} (${item.target.target_id})`),
          datasets: [
            { label: 'No Indel %', data: flat.map(item => item.target.summary?.no_indel_pct ?? 0), backgroundColor: '#2ecc71' },
            { label: 'Substitution %', data: flat.map(item => item.target.summary?.substitution_pct ?? 0), backgroundColor: '#3498db' },
            { label: 'In-frame %', data: flat.map(item => item.target.summary?.in_frame_pct ?? 0), backgroundColor: '#e67e22' },
            { label: 'Out-of-frame %', data: flat.map(item => item.target.summary?.out_of_frame_pct ?? 0), backgroundColor: '#e74c3c' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, min: 0, max: 100, title: { display: true, text: 'Percentage (%)' } } },
          plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Mutation Distribution per Target' } }
        }
      }));
    }

    const pieCtx = document.getElementById('mutationPieChart') as HTMLCanvasElement;
    if (pieCtx && selectedData?.breakdown) {
      this.state.addChart(new Chart(pieCtx, {
        type: 'pie',
        data: {
          labels: ['No Indel', 'Substitution', 'In-frame Indel', 'Out-of-frame Indel'],
          datasets: [{
            data: [selectedData.breakdown.no_indel ?? 0, selectedData.breakdown.substitution ?? 0, selectedData.breakdown.in_frame ?? 0, selectedData.breakdown.out_of_frame ?? 0],
            backgroundColor: ['#2ecc71', '#3498db', '#e67e22', '#e74c3c']
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, title: { display: true, text: `Mutation Distribution (${selectedData.target_id})` } } }
      }));
    }

    const donutCtx = document.getElementById('donutChart') as HTMLCanvasElement;
    if (donutCtx && selectedData?.summary) {
      this.state.addChart(new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['Indel edited', 'No indel', 'Substitution'],
          datasets: [{
            data: [selectedData.summary.modified ?? 0, selectedData.summary.unmodified ?? 0, selectedData.breakdown?.substitution ?? selectedData.summary.substitution_reads ?? 0],
            backgroundColor: ['#ff6384', '#cccccc', '#3498db']
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: true, text: `Indel Editing (${selectedData.target_id})` } } }
      }));
    }
  }

  // ── Curation UI Methods ──────────────────────────────────────────────────────

  enterCuratedView() {
    this.state.enterCuratedView();
    this.cdr.detectChanges();
    this.refreshDashboard();
  }

  exitCuratedView() {
    this.state.exitCuratedView();
    this.state.destroyCharts();
    this.cdr.detectChanges();
    this.refreshDashboard();
  }

  /** Original file results from the snapshot (for file-level curation display) */
  get originalFileResults(): string[] {
    if (!this.state.originalSlotSnapshot) return [];
    return this.state.originalSlotSnapshot.allFileResults.map(
      (fr: any) => ((fr.fastq_file as string) || '').split('/').pop() || fr.fastq_file || ''
    );
  }

  /** Original gene names from the snapshot (for excluded gene display) */
  get originalGenes(): string[] {
    if (!this.state.originalSlotSnapshot) return [];
    return this.state.originalSlotSnapshot.mergedGenes.map(g => g.gene);
  }

  /** List of gene names that are currently excluded */
  get excludedGeneNames(): string[] {
    return this.state.curationConfig?.excludedGenes ?? [];
  }

  extractFileName(path: string): string {
    return (path || '').split('/').pop() || path || '';
  }

  // ── File toggle ──
  isFileExcluded(fileResult: any): boolean {
    const path = typeof fileResult === 'string' ? fileResult : (fileResult?.fastq_file || '');
    return this.state.isFileExcluded(this.extractFileName(path));
  }

  toggleFile(fileResult: any) {
    if (!this.state.isCuratedView) return;
    const path = typeof fileResult === 'string' ? fileResult : (fileResult?.fastq_file || '');
    const fileName = this.extractFileName(path);
    this.state.toggleFileExclusion(fileName);
    this.state.destroyCharts();
    this.cdr.detectChanges();
    this.refreshDashboard();
  }

  toggleGene(geneName: string) {
    if (!this.state.isCuratedView) return;
    this.state.toggleGeneExclusion(geneName);
    this.state.destroyCharts();
    this.cdr.detectChanges();
    this.refreshDashboard();
  }

  toggleTarget(geneName: string, targetId: string) {
    if (!this.state.isCuratedView) return;
    this.state.toggleTargetExclusion(geneName, targetId);
    this.state.destroyCharts();
    this.cdr.detectChanges();
    this.refreshDashboard();
  }

  toggleGroup(group: MutationGroup) {
    if (!this.state.isCuratedView) return;
    const gene = this.state.currentGene?.gene;
    const target = this.state.selectedTarget?.target_id;
    if (!gene || !target) return;
    this.state.toggleGroupExclusion(gene, target, group.read_inner);
    this.state.destroyCharts();
    this.cdr.detectChanges();
    this.refreshDashboard();
  }

  isTargetExcluded(geneName: string, targetId: string): boolean {
    return this.state.isTargetExcluded(geneName, targetId);
  }

  isGroupExcludedObj(group: MutationGroup): boolean {
    const gene = this.state.currentGene?.gene;
    const target = this.state.selectedTarget?.target_id;
    if (!gene || !target) return false;
    return this.state.isGroupExcluded(gene, target, group.read_inner);
  }
}
