import { Injectable, NgZone } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { ExcelExportService, ExportParams } from './excel-export.service';
import { CurationService } from './curation.service';
import { LocalAnalysisService, LocalAnalysisEvent } from './local-analysis.service';
import { SequenceWorkspaceService } from './sequence-workspace.service';
import { parseFastqText } from '../utils/parsers.utils';
import { extractWindow, findGrnaCutSite } from '../workers/core/classifier';
import { GeneResult, MultiReferenceResponse, BenchmarkRow, BenchmarkResult, SplitPreview } from '../models/analysis.model';
import { CurationConfig, emptyCurationConfig, targetKey, groupKey } from '../models/curation.model';
import { Chart } from 'chart.js/auto';

/** Independent result data container */
export interface ResultSlot {
  genes: GeneResult[];
  mergedGenes: GeneResult[];
  selectedGeneIndex: number;
  ambiguousReadCount: number;
  totalMergedAmbiguous: number;
  totalRawReads: number;
  totalMergedRawReads: number;
  totalPhredPassed: number;
  totalMergedPhredPassed: number;
  totalAnchorMatched: number;
  totalMergedAnchorMatched: number;
  allFileResults: any[];
  lastRunParams: ExportParams | null;
  selectedScopeIndex: number;
  isMultiReference: boolean;
  multiFileCount: number;
  selectedRowIndex: number;
  selectedTarget: any;
  metrics: { totalReads: number; alignedReads: number; avgOutOfFrame: number; avgInFrame: number; avgNoIndel: number; avgSubstitution: number; };
  isLoading: boolean;
  error: string | null;
  result: any | null;
}

function emptySlot(): ResultSlot {
  return {
    genes: [], mergedGenes: [], selectedGeneIndex: 0, ambiguousReadCount: 0,
    totalMergedAmbiguous: 0, totalRawReads: 0, totalMergedRawReads: 0,
    totalPhredPassed: 0, totalMergedPhredPassed: 0,
    totalAnchorMatched: 0, totalMergedAnchorMatched: 0,
    allFileResults: [], lastRunParams: null, selectedScopeIndex: -1,
    isMultiReference: false, multiFileCount: 0, selectedRowIndex: 0, selectedTarget: null,
    metrics: { totalReads: 0, alignedReads: 0, avgOutOfFrame: 0, avgInFrame: 0, avgNoIndel: 0, avgSubstitution: 0 },
    isLoading: false, error: null, result: null
  };
}

export interface AnalysisTab {
  id: string;
  name: string;
  formValue: any;
  selectedFiles: File[];
  slot: ResultSlot;
}

@Injectable({ providedIn: 'root' })
export class AppStateService {
  analysisForm!: FormGroup;
  selectedFiles: File[] = [];
  isDragging = false;

  // ── Multi-Tab Analysis State ──
  tabs: AnalysisTab[] = [];
  activeTabId: string = '';

  get currentTab(): AnalysisTab | null {
    return this.tabs.find(t => t.id === this.activeTabId) || null;
  }

  // ── Local Mode (Always active in standalone) ──
  isLocalMode = true;
  private localAnalysisSub: Subscription | null = null;

  // ── Separate result slots ──
  analysisSlot: ResultSlot = emptySlot();
  viewerSlot: ResultSlot = emptySlot();
  activeMode: 'analysis' | 'viewer' = 'analysis';

  // ── Curation state ──
  isCuratedView = false;
  curationConfig: CurationConfig | null = null;
  originalSlotSnapshot: ResultSlot | null = null;

  // ── Active display state (points to the active slot) ──
  get slot(): ResultSlot {
    return this.activeMode === 'analysis' ? this.analysisSlot : this.viewerSlot;
  }

  // ── Progress (Reactive) ──
  progress$ = new BehaviorSubject<number>(0);
  progressDisplay$ = new BehaviorSubject<number>(0);
  progressStage$ = new BehaviorSubject<string>('');

  private progressAnimId: any = null;
  debugLogs: string[] = [];
  private charts: Chart[] = [];
  resultsUpdated$ = new Subject<void>();

  fileProgress: { [filename: string]: number } = {};
  get fileProgressKeys(): string[] {
    return Object.keys(this.fileProgress || {});
  }

  // ── Main Shell Tab Switching ──
  activeMainTab$ = new BehaviorSubject<'analysis' | 'viewer' | 'benchmark' | 'workspace'>('analysis');

  switchMainTab(tab: 'analysis' | 'viewer' | 'benchmark' | 'workspace') {
    this.activeMainTab$.next(tab);
  }

  constructor(
    private fb: FormBuilder,
    private excelExportService: ExcelExportService,
    private curationService: CurationService,
    private localAnalysisService: LocalAnalysisService,
    private sequenceWorkspaceService: SequenceWorkspaceService,
    public ngZone: NgZone
  ) {
    this.initForm();
    this.initDefaultTab();
  }

  // ── Slot activation ──
  activateSlot(mode: 'analysis' | 'viewer') {
    this.activeMode = mode;
  }

  // ── Convenience getters (read from active slot) ──
  get genes() { return this.slot.genes; }
  set genes(v) { this.slot.genes = v; }
  get mergedGenes() { return this.slot.mergedGenes; }
  set mergedGenes(v) { this.slot.mergedGenes = v; }
  get selectedGeneIndex() { return this.slot.selectedGeneIndex; }
  set selectedGeneIndex(v) { this.slot.selectedGeneIndex = v; }
  get ambiguousReadCount() { return this.slot.ambiguousReadCount; }
  set ambiguousReadCount(v) { this.slot.ambiguousReadCount = v; }
  get totalMergedAmbiguous() { return this.slot.totalMergedAmbiguous; }
  set totalMergedAmbiguous(v) { this.slot.totalMergedAmbiguous = v; }
  get totalRawReads() { return this.slot.totalRawReads; }
  set totalRawReads(v) { this.slot.totalRawReads = v; }
  get totalMergedRawReads() { return this.slot.totalMergedRawReads; }
  set totalMergedRawReads(v) { this.slot.totalMergedRawReads = v; }
  get totalPhredPassed() { return this.slot.totalPhredPassed; }
  set totalPhredPassed(v) { this.slot.totalPhredPassed = v; }
  get totalMergedPhredPassed() { return this.slot.totalMergedPhredPassed; }
  set totalMergedPhredPassed(v) { this.slot.totalMergedPhredPassed = v; }
  get totalAnchorMatched() { return this.slot.totalAnchorMatched; }
  set totalAnchorMatched(v) { this.slot.totalAnchorMatched = v; }
  get totalMergedAnchorMatched() { return this.slot.totalMergedAnchorMatched; }
  set totalMergedAnchorMatched(v) { this.slot.totalMergedAnchorMatched = v; }
  get allFileResults() { return this.slot.allFileResults; }
  set allFileResults(v) { this.slot.allFileResults = v; }
  get lastRunParams() { return this.slot.lastRunParams; }
  set lastRunParams(v) { this.slot.lastRunParams = v; }
  get selectedScopeIndex() { return this.slot.selectedScopeIndex; }
  set selectedScopeIndex(v) { this.slot.selectedScopeIndex = v; }
  get isMultiReference() { return this.slot.isMultiReference; }
  set isMultiReference(v) { this.slot.isMultiReference = v; }
  get multiFileCount() { return this.slot.multiFileCount; }
  set multiFileCount(v) { this.slot.multiFileCount = v; }
  get selectedRowIndex() { return this.slot.selectedRowIndex; }
  set selectedRowIndex(v) { this.slot.selectedRowIndex = v; }
  get selectedTarget() { return this.slot.selectedTarget; }
  set selectedTarget(v) { this.slot.selectedTarget = v; }
  get metrics() { return this.slot.metrics; }
  set metrics(v) { this.slot.metrics = v; }
  get isLoading() { return this.slot.isLoading; }
  set isLoading(v) { this.slot.isLoading = v; }
  get error() { return this.slot.error; }
  set error(v) { this.slot.error = v; }
  get result() { return this.slot.result; }
  set result(v) { this.slot.result = v; }

  get currentGene(): GeneResult | null {
    return this.genes.length > 0 ? this.genes[this.selectedGeneIndex] : null;
  }
  get normalGenes(): GeneResult[] { return this.genes.filter(g => !g.is_ambiguous_derived && !g.is_rescued_derived); }
  get rescuedGenes(): GeneResult[] { return this.genes.filter(g => g.is_rescued_derived); }
  get ambiguousGenes(): GeneResult[] { return this.genes.filter(g => g.is_ambiguous_derived); }

  // ── Tab Management ──
  private initDefaultTab() {
    const tab1: AnalysisTab = {
      id: 'tab_' + Date.now() + '_1',
      name: 'Analysis 1',
      formValue: this.analysisForm ? this.analysisForm.getRawValue() : null,
      selectedFiles: [],
      slot: emptySlot()
    };
    this.tabs = [tab1];
    this.activeTabId = tab1.id;
    this.analysisSlot = tab1.slot;
  }

  saveCurrentTabState() {
    const tab = this.currentTab;
    if (tab) {
      if (this.analysisForm) {
        tab.formValue = this.analysisForm.getRawValue();
      }
      tab.selectedFiles = [...this.selectedFiles];
      tab.slot = this.analysisSlot;
    }
  }

  addTab(name?: string) {
    this.saveCurrentTabState();
    const newTabNumber = this.tabs.length + 1;
    const tabName = name || `Analysis ${newTabNumber}`;
    const currentFormVal = this.analysisForm ? this.analysisForm.getRawValue() : null;
    const currentFiles = [...this.selectedFiles];

    const newTab: AnalysisTab = {
      id: 'tab_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: tabName,
      formValue: currentFormVal,
      selectedFiles: currentFiles,
      slot: emptySlot()
    };

    this.tabs.push(newTab);
    this.selectTab(newTab.id);
  }

  selectTab(tabId: string) {
    if (this.activeTabId === tabId) return;
    this.saveCurrentTabState();

    const targetTab = this.tabs.find(t => t.id === tabId);
    if (!targetTab) return;

    this.activeTabId = tabId;
    this.analysisSlot = targetTab.slot;
    this.selectedFiles = [...targetTab.selectedFiles];

    if (targetTab.formValue && this.analysisForm) {
      this.restoreFormValue(targetTab.formValue);
    }

    this.resultsUpdated$.next();
  }

  closeTab(tabId: string) {
    if (this.tabs.length <= 1) {
      this.analysisSlot = emptySlot();
      this.selectedFiles = [];
      if (this.tabs[0]) {
        this.tabs[0].slot = this.analysisSlot;
        this.tabs[0].selectedFiles = [];
      }
      this.resultsUpdated$.next();
      return;
    }

    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const isActive = (this.activeTabId === tabId);
    this.tabs.splice(idx, 1);

    if (isActive) {
      const nextTabIdx = Math.min(idx, this.tabs.length - 1);
      const nextTab = this.tabs[nextTabIdx];
      this.activeTabId = '';
      this.selectTab(nextTab.id);
    }
  }

  renameTab(tabId: string, newName: string) {
    const target = this.tabs.find(t => t.id === tabId);
    if (target && newName.trim()) {
      target.name = newName.trim();
    }
  }

  private restoreFormValue(val: any) {
    if (!val || !this.analysisForm) return;
    this.analysisForm.patchValue({
      interestRegion: val.interestRegion ?? 90,
      phredThreshold: val.phredThreshold ?? 20,
      rescueThreshold: val.rescueThreshold ?? 20,
      marginPercent: val.marginPercent ?? 10,
      indelPercent: val.indelPercent ?? 2,
      cutSiteDistanceWeight: val.cutSiteDistanceWeight ?? 0,
      cutSiteExclusionFlank: val.cutSiteExclusionFlank ?? 0,
      analyzeAmbiguous: val.analyzeAmbiguous ?? false,
      rescueAmbiguous: val.rescueAmbiguous ?? false
    }, { emitEvent: false });

    if (Array.isArray(val.genes)) {
      while (this.geneBlocks.length > 0) {
        this.geneBlocks.removeAt(0);
      }
      val.genes.forEach((g: any) => {
        const gGroup = this.createGeneGroup();
        gGroup.patchValue({ gene_name: g.gene_name, gene_reference: g.gene_reference }, { emitEvent: false });

        const tArray = gGroup.get('geneTargets') as FormArray;
        while (tArray.length > 0) tArray.removeAt(0);

        if (Array.isArray(g.geneTargets)) {
          g.geneTargets.forEach((t: any) => {
            const tGroup = this.createGeneTargetGroup();
            tGroup.patchValue({ target_id: t.target_id, gRNA: t.gRNA }, { emitEvent: false });
            tArray.push(tGroup);
          });
        } else {
          tArray.push(this.createGeneTargetGroup());
        }
        this.geneBlocks.push(gGroup);
      });

      if (this.geneBlocks.length === 0) {
        this.addGene();
      }
    }
  }

  // ── Form ──
  private initForm() {
    this.analysisForm = this.fb.group({
      interestRegion: [90, [Validators.required, Validators.min(10), Validators.max(500)]],
      phredThreshold: [20, [Validators.required, Validators.min(1), Validators.max(1000)]],
      rescueThreshold: [20, [Validators.required, Validators.min(1), Validators.max(1000)]],
      marginPercent: [10, [Validators.required, Validators.min(0), Validators.max(100)]],
      indelPercent: [2, [Validators.required, Validators.min(0), Validators.max(100)]],
      cutSiteDistanceWeight: [0, [Validators.required, Validators.min(0), Validators.max(10)]],
      cutSiteExclusionFlank: [0, [Validators.required, Validators.min(0), Validators.max(10)]],
      analyzeAmbiguous: [false], rescueAmbiguous: [false],
      genes: this.fb.array([this.createGeneGroup()])
    });
    this.analysisForm.get('analyzeAmbiguous')?.valueChanges.subscribe(val => {
      if (!val) this.analysisForm.get('rescueAmbiguous')?.setValue(false, { emitEvent: false });
    });
  }
  private createGeneGroup(): FormGroup {
    return this.fb.group({ gene_name: [''], gene_reference: ['', Validators.required], geneTargets: this.fb.array([this.createGeneTargetGroup()]) });
  }
  private createGeneTargetGroup(): FormGroup {
    return this.fb.group({ target_id: [''], gRNA: ['', Validators.required] });
  }
  get geneBlocks() { return this.analysisForm.get('genes') as FormArray; }
  addGene() { this.geneBlocks.push(this.createGeneGroup()); }
  removeGene(i: number) { if (this.geneBlocks.length > 1) this.geneBlocks.removeAt(i); }
  getGeneTargets(gi: number): FormArray { return this.geneBlocks.at(gi).get('geneTargets') as FormArray; }
  addGeneTarget(gi: number) { this.getGeneTargets(gi).push(this.createGeneTargetGroup()); }
  removeGeneTarget(gi: number, ti: number) { const a = this.getGeneTargets(gi); if (a.length > 1) a.removeAt(ti); }

  setGenesBulk(data: { geneName: string, geneSeq: string, targetName: string, targetSeq: string }[]) {
    this.ngZone.run(() => {
      while (this.geneBlocks.length > 0) { this.geneBlocks.removeAt(0); }
      const geneMap = new Map<string, { seq: string, targets: { name: string, seq: string }[] }>();

      data.forEach(row => {
        const key = row.geneName?.trim() || 'Unknown Gene';
        if (!geneMap.has(key)) {
          geneMap.set(key, { seq: row.geneSeq?.trim() || '', targets: [] });
        }
        geneMap.get(key)!.targets.push({
          name: row.targetName?.trim() || `T${geneMap.get(key)!.targets.length + 1}`,
          seq: row.targetSeq?.trim() || ''
        });
      });

      geneMap.forEach((val, name) => {
        const targetGroups = val.targets.map(t => this.fb.group({
          target_id: [t.name],
          gRNA: [t.seq, Validators.required]
        }));
        const geneGroup = this.fb.group({
          gene_name: [name],
          gene_reference: [val.seq, Validators.required],
          geneTargets: this.fb.array(targetGroups)
        });
        this.geneBlocks.push(geneGroup);
      });

      if (this.geneBlocks.length === 0) {
        this.addGene();
      }
    });
  }

  // ── Logging ──
  addLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    this.debugLogs.unshift(`[${ts}] ${msg}`);
    if (this.debugLogs.length > 25) this.debugLogs.pop();
  }

  // ── Progress ──
  setProgress(target: number, stage: string) {
    this.ngZone.run(() => {
      this.progress$.next(target);
      this.progressStage$.next(stage);

      if (this.progressAnimId) { clearInterval(this.progressAnimId); this.progressAnimId = null; }

      this.progressAnimId = setInterval(() => {
        this.ngZone.run(() => {
          const current = this.progressDisplay$.value;
          const goal = this.progress$.value;
          if (current < goal) {
            this.progressDisplay$.next(Math.min(goal, current + 2));
          } else if (current > goal) {
            this.progressDisplay$.next(goal);
          } else if (current === 100 && goal === 100) {
            clearInterval(this.progressAnimId);
            this.progressAnimId = null;
          }
        });
      }, 15);
    });
  }

  // ── Local Mode Analysis ──
  runLocalAnalysis(files: File[], genesPayload: any[], params: any) {
    this.saveCurrentTabState();
    this.activateSlot('analysis');
    this.isLoading = true;
    this.fileProgress = {};
    this.setProgress(0, 'Preparing local analysis…');

    const analysisParams = {
      phredThreshold: params.phredThreshold,
      indelThreshold: params.indelThreshold,
      marginThreshold: params.marginThreshold,
      windowSize: params.windowSize,
      analyzeAmbiguous: params.analyzeAmbiguous,
      rescueAmbiguous: params.rescueAmbiguous,
      rescueThreshold: params.rescueThreshold,
      cutSiteDistanceWeight: params.cutSiteDistanceWeight ?? 0,
      cutSiteExclusionFlank: params.cutSiteExclusionFlank ?? 0,
    };

    this.localAnalysisSub = this.localAnalysisService.startAnalysis(
      files, genesPayload, analysisParams
    ).subscribe({
      next: (event: LocalAnalysisEvent) => {
        this.ngZone.run(() => {
          if (event.type === 'progress') {
            this.setProgress(event.percent, event.stage);
            this.fileProgress = event.fileProgress || {};
          } else if (event.type === 'result') {
            this.handleAnalysisComplete(event.payload, () => {
              this.setProgress(100, 'Local Analysis Complete ✓');
              setTimeout(() => {
                this.ngZone.run(() => { this.isLoading = false; });
              }, 800);
            });
          } else if (event.type === 'error') {
            this.error = event.message;
            this.isLoading = false;
          }
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.error = err?.message || 'Local analysis failed.';
          this.isLoading = false;
        });
      },
    });
  }

  cancelAnalysis() {
    if (this.localAnalysisSub) {
      this.localAnalysisSub.unsubscribe();
      this.localAnalysisSub = null;
    }
    this.localAnalysisService.cancelAnalysis();
    this.isLoading = false;
    this.setProgress(0, 'Analysis cancelled.');
  }

  // ── Handle completed response ──
  handleAnalysisComplete(res: any, callback?: () => void) {
    const allResults: any[] = res?.results ?? [];
    this.isMultiReference = true; this.result = null; this.multiFileCount = allResults.length;
    const geneMap = new Map<string, GeneResult>();
    let totalAmb = 0, totalRaw = 0, totalPhred = 0, totalAnchor = 0;
    for (const fileResult of allResults) {
      const mrd: MultiReferenceResponse | undefined = fileResult?.multi_reference_result;
      if (!mrd) continue;
      totalAmb += mrd.ambiguous_read_count ?? 0;
      totalRaw += mrd.debug?.total_reads_parsed ?? 0;
      totalPhred += mrd.debug?.phred_passed_count ?? 0;
      totalAnchor += mrd.debug?.usable_for_assignment_count ?? mrd.debug?.anchor_matched_count ?? 0;
      for (const geneRes of (mrd.genes ?? [])) {
        if (geneMap.has(geneRes.gene)) {
          const ex = geneMap.get(geneRes.gene)!;
          ex.assigned_read_count += geneRes.assigned_read_count;
          if (ex.analysis_result?.targets && geneRes.analysis_result?.targets) {
            ex.analysis_result.targets.forEach((extT: any, tidx: number) => {
              const newT = geneRes.analysis_result.targets[tidx]; if (!newT) return;
              const s1 = extT.summary, s2 = newT.summary;
              const b1 = extT.breakdown || { out_of_frame: 0, in_frame: 0, no_indel: 0, substitution: 0, failed: 0 };
              const b2 = newT.breakdown || { out_of_frame: 0, in_frame: 0, no_indel: 0, substitution: 0, failed: 0 };
              b1.out_of_frame += b2.out_of_frame || 0; b1.in_frame += b2.in_frame || 0;
              b1.no_indel += b2.no_indel || 0; b1.substitution += b2.substitution || 0;
              b1.failed = (b1.failed || 0) + (b2.failed || b2.ambiguous || 0);
              b1.ambiguous = b1.failed;
              extT.breakdown = b1;
              s1.total_reads += s2.total_reads; s1.matched_reads += s2.matched_reads; s1.aligned_reads += s2.aligned_reads;
              const ta = s1.aligned_reads || 1;
              const pct = (v: number) => Math.round((v / ta) * 10000) / 100;
              s1.out_of_frame_pct = pct(b1.out_of_frame); s1.in_frame_pct = pct(b1.in_frame);
              s1.no_indel_pct = pct(b1.no_indel); s1.substitution_pct = pct(b1.substitution);
              s1.modified = b1.out_of_frame + b1.in_frame; s1.unmodified = b1.no_indel;
              s1.substitution_reads = b1.substitution;
              s1.editing_efficiency = pct(s1.modified);
              s1.indel_editing_efficiency = pct(s1.modified);
              s1.substitution_policy = 'separate_category_indel_editing_excludes_substitutions';
              s1.failed_reads = b1.failed;
              if (newT.top_groups && extT.top_groups) {
                const gm = new Map<string, any>();
                [...extT.top_groups, ...newT.top_groups].forEach(g => { if (gm.has(g.read_inner)) { gm.get(g.read_inner).read_count += g.read_count; } else { gm.set(g.read_inner, { ...g }); } });
                const mg = Array.from(gm.values()).sort((a, b) => b.read_count - a.read_count);
                mg.forEach((g, i) => { g.group_rank = i + 1; g.read_pct = pct(g.read_count); });
                extT.top_groups = mg;
              }
            });
          }
        } else { geneMap.set(geneRes.gene, JSON.parse(JSON.stringify(geneRes))); }
      }
    }
    this.mergedGenes = Array.from(geneMap.values());
    this.totalMergedAmbiguous = totalAmb; this.totalMergedRawReads = totalRaw;
    this.totalMergedPhredPassed = totalPhred; this.totalMergedAnchorMatched = totalAnchor;
    this.allFileResults = allResults; this.selectedScopeIndex = -1;
    this.updateVisibleGenes();
    this.resultsUpdated$.next();
    if (callback) callback();
  }

  updateVisibleGenes() {
    const prev = this.currentGene?.gene;
    if (this.selectedScopeIndex === -1) {
      this.genes = this.mergedGenes; this.ambiguousReadCount = this.totalMergedAmbiguous;
      this.totalRawReads = this.totalMergedRawReads; this.totalPhredPassed = this.totalMergedPhredPassed;
      this.totalAnchorMatched = this.totalMergedAnchorMatched;
    } else {
      const mrd = this.allFileResults[this.selectedScopeIndex].multi_reference_result;
      this.genes = mrd.genes || []; this.ambiguousReadCount = mrd.ambiguous_read_count || 0;
      this.totalRawReads = mrd.debug?.total_reads_parsed || 0;
      this.totalPhredPassed = mrd.debug?.phred_passed_count || 0;
      this.totalAnchorMatched = mrd.debug?.anchor_matched_count || 0;
    }
    if (prev) { const ni = this.genes.findIndex((g: GeneResult) => g.gene === prev); this.selectedGeneIndex = ni !== -1 ? ni : 0; }
    else { this.selectedGeneIndex = 0; }
    this.selectedRowIndex = 0;
  }

  loadResultData(data: { params: any, scopes: any[] }) {
    this.ngZone.run(() => {
      this.lastRunParams = data.params;
      this.allFileResults = [];
      
      const mergedScope = data.scopes.find(s => s.sheetName === 'Merged');
      if (mergedScope) {
        this.mergedGenes = mergedScope.genes;
        this.totalMergedRawReads = mergedScope.readFlow.rawReads;
        this.totalMergedPhredPassed = mergedScope.readFlow.phredPassed;
        this.totalMergedAnchorMatched = mergedScope.readFlow.anchorMatched;
        this.totalMergedAmbiguous = mergedScope.readFlow.ambiguousReads;
      } else {
        this.mergedGenes = [];
      }

      const fileScopes = data.scopes.filter(s => s.sheetName !== 'Merged');
      for (const scope of fileScopes) {
        this.allFileResults.push({
          fastq_file: scope.sheetName,
          multi_reference_result: {
            debug: {
              total_reads_parsed: scope.readFlow.rawReads,
              phred_passed_count: scope.readFlow.phredPassed,
              anchor_matched_count: scope.readFlow.anchorMatched,
              usable_for_assignment_count: scope.readFlow.usableForAssignment ?? scope.readFlow.anchorMatched
            },
            ambiguous_read_count: scope.readFlow.ambiguousReads,
            genes: scope.genes
          }
        });
      }

      this.isMultiReference = true;
      this.multiFileCount = fileScopes.length;
      this.selectedScopeIndex = -1;
      this.updateVisibleGenes();
      this.resultsUpdated$.next();
    });
  }

  destroyCharts() { this.charts.forEach(c => c.destroy()); this.charts = []; }
  addChart(chart: Chart) { this.charts.push(chart); }
  getScopeName(i: number): string { if (i === -1) return 'All'; const p = this.allFileResults[i].fastq_file; return p.split('/').pop() || p; }
  
  editScopeName(i: number) {
    if (i === -1) return;
    const currentName = this.getScopeName(i);
    const newName = prompt('Enter a new name for this file:', currentName);
    if (newName && newName.trim() !== '') {
      this.allFileResults[i].fastq_file = newName.trim();
      this.resultsUpdated$.next();
    }
  }

  clearProgress() {
    this.progress$.next(0);
    this.progressDisplay$.next(0);
    this.progressStage$.next('');
    if (this.progressAnimId) { clearInterval(this.progressAnimId); this.progressAnimId = null; }
  }

  newAnalysis() {
    this.activateSlot('analysis');
    this.analysisSlot = emptySlot();
    this.destroyCharts();
    this.clearProgress();
    this.debugLogs = [];
    this.selectedFiles = [];
  }

  newViewer() {
    this.exitCuratedView();
    this.activateSlot('viewer');
    this.viewerSlot = emptySlot();
    this.destroyCharts();
    this.clearProgress();
  }

  // ── Curation / Filter ──
  enterCuratedView(name?: string) {
    if (this.isCuratedView) return;
    this.originalSlotSnapshot = JSON.parse(JSON.stringify(this.slot));
    this.curationConfig = emptyCurationConfig();
    this.curationConfig.sourceResultTitle = this.lastRunParams?.dataType || 'Analysis';
    this.curationConfig.curatedViewName = name || `Curated — ${new Date().toLocaleDateString()}`;
    this.isCuratedView = true;
    this.recalculateCuratedView();
  }

  exitCuratedView() {
    if (!this.isCuratedView || !this.originalSlotSnapshot) return;
    const snap = this.originalSlotSnapshot;
    this.genes = snap.genes;
    this.mergedGenes = snap.mergedGenes;
    this.ambiguousReadCount = snap.ambiguousReadCount;
    this.totalMergedAmbiguous = snap.totalMergedAmbiguous;
    this.totalRawReads = snap.totalRawReads;
    this.totalMergedRawReads = snap.totalMergedRawReads;
    this.totalPhredPassed = snap.totalPhredPassed;
    this.totalMergedPhredPassed = snap.totalMergedPhredPassed;
    this.totalAnchorMatched = snap.totalAnchorMatched;
    this.totalMergedAnchorMatched = snap.totalMergedAnchorMatched;
    this.allFileResults = snap.allFileResults;
    this.curationConfig = null;
    this.originalSlotSnapshot = null;
    this.isCuratedView = false;
    this.updateVisibleGenes();
    this.resultsUpdated$.next();
  }

  resetAnalysis() {
    this.genes = [];
    this.isMultiReference = false;
    this.destroyCharts();
    this.clearProgress();
    this.isLoading = false;
    this.error = null;
  }

  toggleFileExclusion(fileName: string) {
    if (!this.curationConfig) return;
    const idx = this.curationConfig.excludedFiles.indexOf(fileName);
    if (idx >= 0) this.curationConfig.excludedFiles.splice(idx, 1);
    else this.curationConfig.excludedFiles.push(fileName);
    this.recalculateCuratedView();
  }

  toggleGeneExclusion(geneName: string) {
    if (!this.curationConfig) return;
    const idx = this.curationConfig.excludedGenes.indexOf(geneName);
    if (idx >= 0) this.curationConfig.excludedGenes.splice(idx, 1);
    else this.curationConfig.excludedGenes.push(geneName);
    this.recalculateCuratedView();
  }

  toggleTargetExclusion(geneName: string, tgtId: string) {
    if (!this.curationConfig) return;
    const key = targetKey(geneName, tgtId);
    const idx = this.curationConfig.excludedTargets.indexOf(key);
    if (idx >= 0) this.curationConfig.excludedTargets.splice(idx, 1);
    else this.curationConfig.excludedTargets.push(key);
    this.recalculateCuratedView();
  }

  toggleGroupExclusion(geneName: string, tgtId: string, readInner: string) {
    if (!this.curationConfig) return;
    const key = groupKey(geneName, tgtId, readInner);
    const idx = this.curationConfig.excludedGroups.indexOf(key);
    if (idx >= 0) this.curationConfig.excludedGroups.splice(idx, 1);
    else this.curationConfig.excludedGroups.push(key);
    this.recalculateCuratedView();
  }

  recalculateCuratedView() {
    if (!this.originalSlotSnapshot || !this.curationConfig) return;
    const snap = this.originalSlotSnapshot;
    const out = this.curationService.computeCuratedResult(
      snap.allFileResults,
      snap.mergedGenes,
      snap.totalMergedAmbiguous,
      snap.totalMergedRawReads,
      snap.totalMergedPhredPassed,
      snap.totalMergedAnchorMatched,
      this.curationConfig
    );
    this.mergedGenes = out.mergedGenes;
    this.totalMergedAmbiguous = out.totalMergedAmbiguous;
    this.totalMergedRawReads = out.totalMergedRawReads;
    this.totalMergedPhredPassed = out.totalMergedPhredPassed;
    this.totalMergedAnchorMatched = out.totalMergedAnchorMatched;
    this.allFileResults = out.allFileResults;
    this.multiFileCount = out.multiFileCount;
    this.selectedScopeIndex = -1;
    this.updateVisibleGenes();
    this.resultsUpdated$.next();
  }

  isFileExcluded(fileName: string): boolean {
    return this.curationConfig?.excludedFiles.includes(fileName) ?? false;
  }

  isGeneExcluded(geneName: string): boolean {
    return this.curationConfig?.excludedGenes.includes(geneName) ?? false;
  }

  isTargetExcluded(geneName: string, tgtId: string): boolean {
    return this.curationConfig?.excludedTargets.includes(targetKey(geneName, tgtId)) ?? false;
  }

  isGroupExcluded(geneName: string, tgtId: string, readInner: string): boolean {
    return this.curationConfig?.excludedGroups.includes(groupKey(geneName, tgtId, readInner)) ?? false;
  }

  // ── Excel Export Functions ──
  getExportData() {
    if (!this.lastRunParams || this.mergedGenes.length === 0) return null;

    const scopes: any[] = [];
    const totalAssigned = this.mergedGenes
      .filter(g => !g.is_ambiguous_derived && !g.is_rescued_derived)
      .reduce((s, g) => s + g.assigned_read_count, 0);

    const cleanMergedGenes = JSON.parse(JSON.stringify(this.mergedGenes));
    if (this.isCuratedView && this.curationConfig) {
      this.stripExcludedGroups(cleanMergedGenes);
    }

    scopes.push({
      sheetName: 'Merged',
      readFlow: {
        rawReads: this.totalMergedRawReads,
        phredPassed: this.totalMergedPhredPassed,
        anchorMatched: this.totalMergedAnchorMatched,
        usableForAssignment: this.totalMergedAnchorMatched,
        assignedReads: totalAssigned,
        ambiguousReads: this.totalMergedAmbiguous
      },
      genes: cleanMergedGenes
    });

    for (let i = 0; i < this.allFileResults.length; i++) {
      const fr = this.allFileResults[i];
      const fn = (fr.fastq_file as string || '').split('/').pop() || `File${i + 1}`;
      
      if (this.isCuratedView && this.curationConfig && this.curationConfig.excludedFiles.includes(fn)) {
        continue;
      }

      const mrd = fr?.multi_reference_result;
      if (!mrd) continue;
      
      const fg = JSON.parse(JSON.stringify(mrd.genes || []));
      if (this.isCuratedView && this.curationConfig) {
        this.stripExcludedGroups(fg);
      }

      const fa = fg.filter((g: any) => !g.is_ambiguous_derived && !g.is_rescued_derived)
                   .reduce((s: number, g: any) => s + g.assigned_read_count, 0);

      scopes.push({
        sheetName: fn,
        readFlow: {
          rawReads: mrd.debug?.total_reads_parsed ?? 0,
          phredPassed: mrd.debug?.phred_passed_count ?? 0,
          anchorMatched: mrd.debug?.anchor_matched_count ?? 0,
          usableForAssignment: mrd.debug?.usable_for_assignment_count ?? mrd.debug?.anchor_matched_count ?? 0,
          assignedReads: fa,
          ambiguousReads: mrd.ambiguous_read_count ?? 0
        },
        genes: fg
      });
    }

    return { params: this.lastRunParams, scopes };
  }

  getOriginalExportData() {
    if (!this.originalSlotSnapshot) return null;
    const snap = this.originalSlotSnapshot;
    if (!snap.lastRunParams || snap.mergedGenes.length === 0) return null;

    const scopes: any[] = [];
    const totalAssigned = snap.mergedGenes
      .filter(g => !g.is_ambiguous_derived && !g.is_rescued_derived)
      .reduce((s, g) => s + g.assigned_read_count, 0);

    scopes.push({
      sheetName: 'Merged',
      readFlow: {
        rawReads: snap.totalMergedRawReads,
        phredPassed: snap.totalMergedPhredPassed,
        anchorMatched: snap.totalMergedAnchorMatched,
        usableForAssignment: snap.totalMergedAnchorMatched,
        assignedReads: totalAssigned,
        ambiguousReads: snap.totalMergedAmbiguous
      },
      genes: snap.mergedGenes
    });

    for (let i = 0; i < snap.allFileResults.length; i++) {
      const fr = snap.allFileResults[i];
      const mrd = fr?.multi_reference_result;
      if (!mrd) continue;
      const fn = (fr.fastq_file as string || '').split('/').pop() || `File${i + 1}`;
      const fg = mrd.genes || [];
      const fa = fg.filter((g: any) => !g.is_ambiguous_derived && !g.is_rescued_derived)
                   .reduce((s: number, g: any) => s + g.assigned_read_count, 0);
      scopes.push({
        sheetName: fn,
        readFlow: {
          rawReads: mrd.debug?.total_reads_parsed ?? 0,
          phredPassed: mrd.debug?.phred_passed_count ?? 0,
          anchorMatched: mrd.debug?.anchor_matched_count ?? 0,
          usableForAssignment: mrd.debug?.usable_for_assignment_count ?? mrd.debug?.anchor_matched_count ?? 0,
          assignedReads: fa,
          ambiguousReads: mrd.ambiguous_read_count ?? 0
        },
        genes: fg
      });
    }
    return { params: snap.lastRunParams, scopes };
  }

  private stripExcludedGroups(genes: GeneResult[]) {
    if (!this.curationConfig) return;
    for (const g of genes) {
      if (!g.analysis_result?.targets) continue;
      for (const t of g.analysis_result.targets) {
        if (!t.top_groups) continue;
        t.top_groups = t.top_groups.filter((grp: any) => {
          const k = groupKey(g.gene, t.target_id, grp.read_inner);
          return !this.curationConfig!.excludedGroups.includes(k);
        });
      }
    }
  }

  private async generateChartImagesForExport(scopes: any[]): Promise<{ [scopeName: string]: { [targetId: string]: { [chartName: string]: string } } }> {
    const allImages: { [scopeName: string]: { [targetId: string]: { [chartName: string]: string } } } = {};
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) return {};

    for (const scope of scopes) {
      allImages[scope.sheetName] = {};
      
      // 1. Generate Summary Bar Chart
      const barLabels = scope.genes.flatMap((g: any) => g.analysis_result?.targets?.map((t: any) => `${g.gene} (${t.target_id})`) || []);
      const barDataNoIndel = scope.genes.flatMap((g: any) => g.analysis_result?.targets?.map((t: any) => t.summary?.no_indel_pct ?? 0) || []);
      const barDataSub = scope.genes.flatMap((g: any) => g.analysis_result?.targets?.map((t: any) => t.summary?.substitution_pct ?? 0) || []);
      const barDataIn = scope.genes.flatMap((g: any) => g.analysis_result?.targets?.map((t: any) => t.summary?.in_frame_pct ?? 0) || []);
      const barDataOut = scope.genes.flatMap((g: any) => g.analysis_result?.targets?.map((t: any) => t.summary?.out_of_frame_pct ?? 0) || []);

      const barChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: barLabels,
          datasets: [
            { label: 'No Indel %', data: barDataNoIndel, backgroundColor: '#2ecc71' },
            { label: 'Substitution %', data: barDataSub, backgroundColor: '#3498db' },
            { label: 'In-frame %', data: barDataIn, backgroundColor: '#e67e22' },
            { label: 'Out-of-frame %', data: barDataOut, backgroundColor: '#e74c3c' },
          ]
        },
        options: { animation: false, responsive: false, scales: { x: { stacked: true }, y: { stacked: true, max: 100 } } }
      } as any);
      allImages[scope.sheetName]['SUMMARY'] = { 'bar': canvas.toDataURL('image/png') };
      barChart.destroy();

      // 2. Generate Pie and Donut for each target
      for (const gene of scope.genes) {
        const targets = gene.analysis_result?.targets || [];
        for (const target of targets) {
          const s = target.summary;
          if (!s) continue;

          // Pie Chart
          const pieChart = new Chart(ctx, {
            type: 'pie',
            data: {
              labels: ['Unmodified', 'Substitution', 'In-frame', 'Out-of-frame'],
              datasets: [{
                data: [s.no_indel_pct, s.substitution_pct, s.in_frame_pct, s.out_of_frame_pct],
                backgroundColor: ['#2ecc71', '#3498db', '#e67e22', '#e74c3c']
              }]
            },
            options: { animation: false, responsive: false, plugins: { title: { display: true, text: `Mutation Distribution (${gene.gene} - ${target.target_id})` } } }
          } as any);
          const chartKey = `${gene.gene}::${target.target_id}`;
          if (!allImages[scope.sheetName][chartKey]) allImages[scope.sheetName][chartKey] = {};
          allImages[scope.sheetName][chartKey]['pie'] = canvas.toDataURL('image/png');
          pieChart.destroy();

          // Donut Chart
          const edited = (s.out_of_frame_pct ?? 0) + (s.in_frame_pct ?? 0);
          const unedited = s.no_indel_pct ?? Math.max(0, 100 - edited - (s.substitution_pct ?? 0));
          const substitution = s.substitution_pct ?? 0;
          const donutChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: ['Indel edited', 'No indel', 'Substitution'],
              datasets: [{
                data: [edited, unedited, substitution],
                backgroundColor: ['#f85a7e', '#d1d1d1', '#3498db']
              }]
            },
            options: { animation: false, responsive: false, plugins: { title: { display: true, text: `Indel Editing (${gene.gene} - ${target.target_id})` } } }
          } as any);
          allImages[scope.sheetName][chartKey]['donut'] = canvas.toDataURL('image/png');
          donutChart.destroy();
        }
      }
    }
    return allImages;
  }

  async exportToExcel() {
    const data = this.getExportData();
    if (!data) return;

    try {
      this.addLog('Generating chart images for export...');
      const images = await this.generateChartImagesForExport(data.scopes);
      await this.excelExportService.exportToExcel(data.params as any, data.scopes, images);
      this.addLog('Excel exported with all diagrams.');
    } catch (e: any) {
      console.error('Excel export failed:', e);
      this.addLog(`Excel export failed: ${e.message}`);
    }
  }

  async exportOriginalToExcel() {
    const data = this.getOriginalExportData();
    if (!data) {
      return this.exportToExcel();
    }
    try {
      this.addLog('Generating original result export...');
      const images = await this.generateChartImagesForExport(data.scopes);
      await this.excelExportService.exportToExcel(data.params as any, data.scopes, images);
      this.addLog('Original result Excel exported.');
    } catch (e: any) {
      console.error('Original export failed:', e);
      this.addLog(`Original export failed: ${e.message}`);
    }
  }

  async exportCuratedToExcel() {
    const data = this.getExportData();
    if (!data) return;
    try {
      this.addLog('Generating curated result export...');
      const images = await this.generateChartImagesForExport(data.scopes);
      await this.excelExportService.exportToExcel(
        data.params as any, data.scopes, images, this.curationConfig ?? undefined
      );
      this.addLog('Curated result Excel exported.');
    } catch (e: any) {
      console.error('Curated export failed:', e);
      this.addLog(`Curated export failed: ${e.message}`);
    }
  }

  isExportingFastq = false;
  exportStatus$ = new BehaviorSubject<{ active: boolean; percent: number; stage: string; title: string } | null>(null);

  async downloadGroupFastq(group: any) {
    if (!this.selectedTarget || !this.selectedFiles.length) return;
    this.isExportingFastq = true;
    this.exportStatus$.next({ active: true, percent: 10, stage: 'Reading FASTQ file...', title: `Exporting Group ${group.group_rank} FASTQ` });

    try {
      let filesToProcess: File[] = [];
      if (this.selectedScopeIndex === -1) {
        filesToProcess = this.selectedFiles;
      } else {
        filesToProcess = [this.selectedFiles[this.selectedScopeIndex]];
      }

      const blobs: Blob[] = [];
      const target = this.selectedTarget;
      const readInner = group.read_inner;
      const params = this.lastRunParams || { phredThreshold: 10 };

      for (const file of filesToProcess) {
        if (!file) continue;
        const blob = await new Promise<Blob>((resolve, reject) => {
          this.localAnalysisService.exportGroupFastq(file, target, readInner, params).subscribe({
            next: (event: any) => {
              if (event.type === 'progress') {
                this.exportStatus$.next({ active: true, percent: event.percent, stage: event.stage, title: `Exporting Group ${group.group_rank} FASTQ` });
              } else if (event.type === 'export-group-fastq-result') {
                resolve(event.payload);
              } else if (event.type === 'error') {
                reject(new Error(event.message));
              }
            },
            error: (err: any) => reject(err)
          });
        });
        blobs.push(blob);
      }

      if (blobs.length > 0) {
        const combinedBlob = new Blob(blobs, { type: 'text/plain' });
        const url = window.URL.createObjectURL(combinedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${target.target_id}_group_${group.group_rank}_reads.fastq`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.addLog(`Successfully exported FASTQ for group ${group.group_rank}.`);
      } else {
        this.addLog('No FASTQ data generated.');
      }
    } catch (e: any) {
       console.error("Export failed:", e);
       this.addLog("Failed to export FASTQ: " + e.message);
       alert("Failed to export FASTQ: " + e.message);
    } finally {
       this.isExportingFastq = false;
       this.exportStatus$.next(null);
    }
  }

  async downloadAllTargetFastq(target: any) {
    if (!target || !this.selectedFiles.length) return;
    this.isExportingFastq = true;
    this.exportStatus$.next({ active: true, percent: 10, stage: 'Reading FASTQ file...', title: `Exporting All Reads (${target.target_id})` });

    try {
      let filesToProcess: File[] = [];
      if (this.selectedScopeIndex === -1) {
        filesToProcess = this.selectedFiles;
      } else {
        filesToProcess = [this.selectedFiles[this.selectedScopeIndex]];
      }

      const blobs: Blob[] = [];
      const params = this.lastRunParams || { phredThreshold: 10 };

      for (const file of filesToProcess) {
        if (!file) continue;
        const blob = await new Promise<Blob>((resolve, reject) => {
          this.localAnalysisService.exportGroupFastq(file, target, '', params).subscribe({
            next: (event: any) => {
              if (event.type === 'progress') {
                this.exportStatus$.next({ active: true, percent: event.percent, stage: event.stage, title: `Exporting All Reads (${target.target_id})` });
              } else if (event.type === 'export-group-fastq-result') {
                resolve(event.payload);
              } else if (event.type === 'error') {
                reject(new Error(event.message));
              }
            },
            error: (err: any) => reject(err)
          });
        });
        blobs.push(blob);
      }

      if (blobs.length > 0) {
        const combinedBlob = new Blob(blobs, { type: 'text/plain' });
        const url = window.URL.createObjectURL(combinedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${target.target_id}_all_reads.fastq`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.addLog(`Successfully exported all FASTQ reads for target ${target.target_id}.`);
      }
    } catch (e: any) {
      console.error('All target FASTQ export failed:', e);
      alert('Failed to export target FASTQ: ' + e.message);
    } finally {
      this.isExportingFastq = false;
      this.exportStatus$.next(null);
    }
  }

  async openGroupInSequenceWorkspace(group: any, target: any) {
    if (!target || !group || !this.selectedFiles.length) return;
    this.isExportingFastq = true;
    this.exportStatus$.next({ active: true, percent: 10, stage: 'Preparing Sequence Workspace...', title: `Opening Group ${group.group_rank} in Workspace` });
    this.switchMainTab('workspace');

    try {
      let filesToProcess: File[] = [];
      if (this.selectedScopeIndex === -1) {
        filesToProcess = this.selectedFiles;
      } else {
        filesToProcess = [this.selectedFiles[this.selectedScopeIndex]];
      }

      const blobs: Blob[] = [];
      const readInner = group.read_inner;
      const params = this.lastRunParams || { phredThreshold: 10 };

      for (const file of filesToProcess) {
        if (!file) continue;
        const blob = await new Promise<Blob>((resolve, reject) => {
          this.localAnalysisService.exportGroupFastq(file, target, readInner, params).subscribe({
            next: (event: any) => {
              if (event.type === 'progress') {
                this.exportStatus$.next({ active: true, percent: event.percent, stage: event.stage, title: `Opening Group ${group.group_rank} in Workspace` });
              } else if (event.type === 'export-group-fastq-result') {
                resolve(event.payload);
              } else if (event.type === 'error') {
                reject(new Error(event.message));
              }
            },
            error: (err: any) => reject(err)
          });
        });
        blobs.push(blob);
      }

      if (blobs.length > 0) {
        const text = await new Blob(blobs, { type: 'text/plain' }).text();
        const filename = `${target.target_id}_Group_${group.group_rank}.fastq`;
        const fastqDoc = parseFastqText(text, filename);

        const refSeq = target.ref_sequence || target.reference_seq || '';
        const grnaSeq = target.sgrna_seq || '';
        const winSize = target.window_size || 90;
        let windowSeq = target.ref_window || '';
        if (!windowSeq && refSeq) {
          const cutInfo = findGrnaCutSite(refSeq, grnaSeq);
          windowSeq = extractWindow(refSeq, cutInfo.cut_site, winSize);
        }

        const autoAlign = { windowSeq, refSeq, grnaSeq, winSize };
        fastqDoc.autoAlign = autoAlign;

        await this.sequenceWorkspaceService.saveItem(fastqDoc);
        this.sequenceWorkspaceService.selectItem(fastqDoc.id);
        this.sequenceWorkspaceService.setPendingAutoAlign(autoAlign);
      }
    } catch (e: any) {
      console.error('Open group in workspace failed:', e);
      alert('Failed to open group in workspace: ' + e.message);
    } finally {
      this.isExportingFastq = false;
      this.exportStatus$.next(null);
    }
  }

  async openAllTargetInSequenceWorkspace(target: any) {
    if (!target || !this.selectedFiles.length) return;
    this.isExportingFastq = true;
    this.exportStatus$.next({ active: true, percent: 10, stage: 'Preparing Sequence Workspace...', title: `Opening All Reads (${target.target_id}) in Workspace` });
    this.switchMainTab('workspace');

    try {
      let filesToProcess: File[] = [];
      if (this.selectedScopeIndex === -1) {
        filesToProcess = this.selectedFiles;
      } else {
        filesToProcess = [this.selectedFiles[this.selectedScopeIndex]];
      }

      const blobs: Blob[] = [];
      const params = this.lastRunParams || { phredThreshold: 10 };

      for (const file of filesToProcess) {
        if (!file) continue;
        const blob = await new Promise<Blob>((resolve, reject) => {
          this.localAnalysisService.exportGroupFastq(file, target, '', params).subscribe({
            next: (event: any) => {
              if (event.type === 'progress') {
                this.exportStatus$.next({ active: true, percent: event.percent, stage: event.stage, title: `Opening All Reads (${target.target_id}) in Workspace` });
              } else if (event.type === 'export-group-fastq-result') {
                resolve(event.payload);
              } else if (event.type === 'error') {
                reject(new Error(event.message));
              }
            },
            error: (err: any) => reject(err)
          });
        });
        blobs.push(blob);
      }

      if (blobs.length > 0) {
        const text = await new Blob(blobs, { type: 'text/plain' }).text();
        const filename = `${target.target_id}_All_Reads.fastq`;
        const fastqDoc = parseFastqText(text, filename);

        const refSeq = target.ref_sequence || target.reference_seq || '';
        const grnaSeq = target.sgrna_seq || '';
        const winSize = target.window_size || 90;
        let windowSeq = target.ref_window || '';
        if (!windowSeq && refSeq) {
          const cutInfo = findGrnaCutSite(refSeq, grnaSeq);
          windowSeq = extractWindow(refSeq, cutInfo.cut_site, winSize);
        }

        const autoAlign = { windowSeq, refSeq, grnaSeq, winSize };
        fastqDoc.autoAlign = autoAlign;

        await this.sequenceWorkspaceService.saveItem(fastqDoc);
        this.sequenceWorkspaceService.selectItem(fastqDoc.id);
        this.sequenceWorkspaceService.setPendingAutoAlign(autoAlign);
      }
    } catch (e: any) {
      console.error('Open all target in workspace failed:', e);
      alert('Failed to open target in workspace: ' + e.message);
    } finally {
      this.isExportingFastq = false;
      this.exportStatus$.next(null);
    }
  }

  // ── Benchmark ──────────────────────────────────────────────────────────────
  benchPhred = 10;
  benchWindow = 90;
  benchMargin = 3;
  benchRows: BenchmarkRow[] = [{ file: null, geneName: '', targetName: '', referenceSequence: '', grnaSequence: '' }];
  benchIsLoading = false;
  benchProgress$ = new BehaviorSubject<number>(0);
  benchProgressDisplay$ = new BehaviorSubject<number>(0);
  benchStage$ = new BehaviorSubject<string>('');
  benchError: string | null = null;
  splitPreview: SplitPreview | null = null;
  trainResult: BenchmarkResult | null = null;
  testResult: BenchmarkResult | null = null;
  private benchDestroy$ = new Subject<void>();
  private benchProgressAnimId: any = null;
  private localBenchSub: Subscription | null = null;

  addBenchRow() {
    this.benchRows.push({ file: null, geneName: '', targetName: '', referenceSequence: '', grnaSequence: '' });
  }

  removeBenchRow(i: number) {
    if (this.benchRows.length > 1) this.benchRows.splice(i, 1);
  }

  clearBenchProgress() {
    this.benchProgress$.next(0);
    this.benchProgressDisplay$.next(0);
    this.benchStage$.next('');
    if (this.benchProgressAnimId) {
      clearInterval(this.benchProgressAnimId);
      this.benchProgressAnimId = null;
    }
  }

  setBenchProgress(target: number, stage: string) {
    this.ngZone.run(() => {
      this.benchProgress$.next(target);
      this.benchStage$.next(stage);

      if (this.benchProgressAnimId) {
        clearInterval(this.benchProgressAnimId);
        this.benchProgressAnimId = null;
      }

      this.benchProgressAnimId = setInterval(() => {
        this.ngZone.run(() => {
          const current = this.benchProgressDisplay$.value;
          const goal = this.benchProgress$.value;
          const diff = goal - current;
          if (Math.abs(diff) < 0.5) {
            this.benchProgressDisplay$.next(goal);
            if (this.benchProgressAnimId) {
              clearInterval(this.benchProgressAnimId);
              this.benchProgressAnimId = null;
            }
          } else {
            this.benchProgressDisplay$.next(current + diff * 0.25);
          }
        });
      }, 15);
    });
  }

  buildSplitPreviewLocal() {
    this.benchIsLoading = true;
    this.splitPreview = null;
    this.benchError = null;
    this.clearBenchProgress();
    this.setBenchProgress(10, 'Preparing split preview dataset…');

    const dataset = this.benchRows.map((r, idx) => ({
      file: r.file!,
      gene: r.geneName?.trim() || `G${idx + 1}`,
      target: r.targetName?.trim() || `T${idx + 1}`,
      reference: r.referenceSequence,
      grna: r.grnaSequence
    }));

    if (this.localBenchSub) {
      this.localBenchSub.unsubscribe();
    }

    this.localBenchSub = this.localAnalysisService.startBenchmarkSplit(dataset).subscribe({
      next: (event: any) => {
        this.ngZone.run(() => {
          if (event.type === 'benchmark-split-result') {
            this.splitPreview = event.payload;
            this.setBenchProgress(100, 'Split preview ready ✓');
            setTimeout(() => {
              this.ngZone.run(() => { this.benchIsLoading = false; });
            }, 800);
          } else if (event.type === 'error') {
            this.benchError = event.message;
            this.benchIsLoading = false;
            this.clearBenchProgress();
          }
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.benchError = err?.message || 'Split preview calculation failed.';
          this.benchIsLoading = false;
          this.clearBenchProgress();
        });
      }
    });
  }

  runBenchmarkLocal(subset: 'train' | 'test') {
    this.benchIsLoading = true;
    this.benchError = null;
    this.clearBenchProgress();
    this.setBenchProgress(0, `Starting ${subset} benchmark…`);

    const dataset = this.benchRows.map((r, idx) => ({
      file: r.file!,
      gene: r.geneName?.trim() || `G${idx + 1}`,
      target: r.targetName?.trim() || `T${idx + 1}`,
      reference: r.referenceSequence,
      grna: r.grnaSequence
    }));

    const params = {
      phredThreshold: this.benchPhred,
      windowSize: this.benchWindow,
      marginThreshold: this.benchMargin / 100
    };

    if (this.localBenchSub) {
      this.localBenchSub.unsubscribe();
    }

    this.localBenchSub = this.localAnalysisService.startBenchmarkRun(dataset, params, subset).subscribe({
      next: (event: any) => {
        this.ngZone.run(() => {
          if (event.type === 'progress') {
            this.setBenchProgress(event.percent, event.stage);
          } else if (event.type === 'benchmark-result') {
            if (subset === 'train') {
              this.trainResult = event.payload;
            } else {
              this.testResult = event.payload;
            }
            this.setBenchProgress(100, `${subset.toUpperCase()} Benchmark Complete ✓`);
            setTimeout(() => {
              this.ngZone.run(() => { this.benchIsLoading = false; });
            }, 800);
          } else if (event.type === 'error') {
            this.benchError = event.message;
            this.benchIsLoading = false;
            this.clearBenchProgress();
          }
        });
      },
      error: (err) => {
        this.ngZone.run(() => {
          this.benchError = err?.message || `${subset} benchmark calculation failed.`;
          this.benchIsLoading = false;
          this.clearBenchProgress();
        });
      }
    });
  }

  cancelBenchmark() {
    if (this.localBenchSub) {
      this.localBenchSub.unsubscribe();
      this.localBenchSub = null;
    }
    this.localAnalysisService.cancelAnalysis();
    this.benchIsLoading = false;
    this.clearBenchProgress();
    this.setBenchProgress(0, 'Benchmark cancelled.');
  }
}
