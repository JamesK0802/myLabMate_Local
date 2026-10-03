import { Component, ChangeDetectorRef, NgZone, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AppStateService } from '../../services/app-state.service';
import { Chart } from 'chart.js/auto';

import { MutationGroup } from '../../models/analysis.model';
import { resolveAnnotationCutSite } from './annotation-cut-site';

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
  resultView: 'standard' | 'homoeolog' = 'standard';
  selectedHomoeologGroup = '';
  selectedHomoeologTarget = '';

  isDraggingScroll = false;
  startX = 0;
  scrollLeft = 0;

  visibleGroupCount = 10;

  get visibleTopGroups(): MutationGroup[] {
    const all = this.state.selectedTarget?.top_groups || [];
    return all.slice(0, this.visibleGroupCount);
  }

  get hasMoreGroups(): boolean {
    const all = this.state.selectedTarget?.top_groups || [];
    return all.length > this.visibleGroupCount;
  }

  get remainingGroupCount(): number {
    const all = this.state.selectedTarget?.top_groups || [];
    return Math.max(0, all.length - this.visibleGroupCount);
  }

  loadMoreGroups(): void {
    this.visibleGroupCount += 10;
    this.cdr.detectChanges();
  }

  get annotationCutSiteIndex(): number | null {
    return resolveAnnotationCutSite(this.state.selectedTarget);
  }

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

  get hasHomoeologResults(): boolean {
    return Boolean(this.state.lastRunParams?.homoeologMode) && this.state.normalGenes.length > 0;
  }

  get homoeologGroupIds(): string[] {
    return [...new Set(this.state.normalGenes.map(gene => gene.homoeolog_group || 'Homoeolog'))];
  }

  get activeHomoeologGroup(): string {
    const groups = this.homoeologGroupIds;
    if (!groups.includes(this.selectedHomoeologGroup)) this.selectedHomoeologGroup = groups[0] || 'Homoeolog';
    return this.selectedHomoeologGroup;
  }

  get homoeologGenes() {
    const group = this.activeHomoeologGroup;
    return this.state.normalGenes.filter(gene => (gene.homoeolog_group || 'Homoeolog') === group);
  }

  get homoeologTargetIds(): string[] {
    return [...new Set(this.homoeologGenes.flatMap(gene => (gene.analysis_result?.targets || []).map(target => target.target_id)))];
  }

  get activeHomoeologTarget(): string {
    return this.homoeologTargetIds.includes(this.selectedHomoeologTarget)
      ? this.selectedHomoeologTarget
      : (this.homoeologTargetIds[0] || '');
  }

  get homoeologRows() {
    const targetFilter = this.activeHomoeologTarget;
    return this.homoeologGenes.flatMap(gene => (gene.analysis_result?.targets || [])
      .filter(target => target.target_id === targetFilter)
      .map(target => ({ gene, target })));
  }

  get homoeologMeanEditing(): number {
    const values = this.homoeologRows.map(row => Number(row.target.summary?.editing_efficiency ?? row.target.summary?.indel_editing_efficiency ?? 0));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  }

  get homoeologEditingSpread(): number {
    const values = this.homoeologRows.map(row => Number(row.target.summary?.editing_efficiency ?? row.target.summary?.indel_editing_efficiency ?? 0));
    return values.length ? Math.max(...values) - Math.min(...values) : 0;
  }

  get homoeologAssignedReads(): number {
    return this.homoeologRows.reduce((sum, row) => sum + Number(row.target.summary?.aligned_reads || 0), 0);
  }

  switchResultView(view: 'standard' | 'homoeolog'): void {
    if (view === 'homoeolog' && !this.hasHomoeologResults) return;
    this.resultView = view;
    this.state.destroyCharts();
    this.cdr.detectChanges();
    setTimeout(() => view === 'homoeolog' ? this.updateHomoeologCharts() : this.refreshDashboard(), 32);
  }

  selectHomoeologGroup(group: string): void {
    this.selectedHomoeologGroup = group;
    this.selectedHomoeologTarget = '';
    this.refreshHomoeologView();
  }

  selectHomoeologTarget(target: string): void {
    this.selectedHomoeologTarget = target;
    this.refreshHomoeologView();
  }

  private refreshHomoeologView(): void {
    this.state.destroyCharts();
    this.cdr.detectChanges();
    setTimeout(() => this.updateHomoeologCharts(), 32);
  }

  homoeologTarget(gene: any, targetId: string): any | null {
    return (gene.analysis_result?.targets || []).find((target: any) => target.target_id === targetId) || null;
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
      if (this.resultView === 'homoeolog' && this.hasHomoeologResults) {
        this.cdr.detectChanges();
        setTimeout(() => this.updateHomoeologCharts(), 32);
        return;
      }
      const gene = this.state.currentGene;
      if (!gene?.analysis_result?.targets?.length) return;
      const targets = gene.analysis_result.targets;
      const idx = Math.min(this.state.selectedRowIndex, targets.length - 1);
      const previousTargetId = this.state.selectedTarget?.target_id;
      this.state.selectedTarget = targets[idx];
      if (previousTargetId !== this.state.selectedTarget?.target_id) {
        this.visibleGroupCount = 10;
      }

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
    const cutIdx = this.annotationCutSiteIndex ?? 0;
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

  private updateHomoeologCharts(): void {
    if (this.resultView !== 'homoeolog') return;
    this.state.destroyCharts();
    const targetId = this.activeHomoeologTarget;
    if (!targetId) return;
    const genes = this.homoeologGenes.filter(gene => this.homoeologTarget(gene, targetId));
    const geneLabels = genes.map(gene => gene.gene);

    const editingCanvas = document.getElementById('homoeologEditingChart') as HTMLCanvasElement | null;
    if (editingCanvas) {
      this.state.addChart(new Chart(editingCanvas, {
        type: 'bar',
        data: {
          labels: geneLabels,
          datasets: [{
            label: 'Indel edit %',
            data: genes.map(gene => {
              const target = this.homoeologTarget(gene, targetId);
              return Number(target?.summary?.editing_efficiency ?? target?.summary?.indel_editing_efficiency ?? 0);
            }),
            backgroundColor: '#7c3aed',
            borderRadius: 5,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: 'Editing (%)' } } },
          plugins: { legend: { display: false }, title: { display: true, text: `${targetId} · editing` } }
        }
      }));
    }

    const coverageCanvas = document.getElementById('homoeologCoverageChart') as HTMLCanvasElement | null;
    if (coverageCanvas) {
      this.state.addChart(new Chart(coverageCanvas, {
        type: 'bar',
        data: {
          labels: geneLabels,
          datasets: [
            { label: 'Unmodified', data: genes.map(gene => {
              const summary = this.homoeologTarget(gene, targetId)?.summary;
              return Math.max(0, Number(summary?.no_indel_pct ?? 0) - Number(summary?.substitution_pct ?? 0));
            }), backgroundColor: '#2ecc71' },
            { label: 'Substitution', data: genes.map(gene => Number(this.homoeologTarget(gene, targetId)?.summary?.substitution_pct ?? 0)), backgroundColor: '#3498db' },
            { label: 'In-frame', data: genes.map(gene => Number(this.homoeologTarget(gene, targetId)?.summary?.in_frame_pct ?? 0)), backgroundColor: '#e67e22' },
            { label: 'Out-of-frame', data: genes.map(gene => Number(this.homoeologTarget(gene, targetId)?.summary?.out_of_frame_pct ?? 0)), backgroundColor: '#e74c3c' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: 'Reads (%)' } } },
          plugins: { legend: { position: 'bottom' }, title: { display: true, text: `${targetId} · profile` } }
        }
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
