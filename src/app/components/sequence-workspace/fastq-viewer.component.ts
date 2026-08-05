import { Component, Input, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FastqDocument } from '../../models/sequence.model';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { isReadUsable, findGrnaCutSite, extractWindow, cutIndexInWindow, reverseComplement } from '../../workers/core/classifier';
import { classifyMutationWithAlignment, AlignmentToken } from '../../workers/core/analyzer';

export interface WindowGridCell {
  char: string;
  type: 'equal' | 'substitute' | 'delete' | 'unobserved';
  insertion?: string;
}

export interface ProcessedRead {
  id: string;
  seq: string;
  qualString?: string;
  isAligned: boolean;
  category?: string;
  netIndel?: number;
  hasSub?: boolean;
  grid?: WindowGridCell[];
  preWinSeq?: string;
  postWinSeq?: string;
  leadPadding?: string;
  isRc?: boolean;
}

@Component({
  selector: 'app-fastq-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fastq-viewer" (scroll)="onViewerScroll($event)">
      <div class="reads-panel">
        <div class="reads-header">
          <div class="header-left">
            <h3>Reads Alignment Workspace</h3>
            <span class="aligned-summary-tag" *ngIf="isAlignedActive">
              Aligned: <strong>{{ alignedStats.alignedCount | number }}</strong> / {{ alignedStats.total | number }} ({{ alignedStats.percentage | number:'1.1-1' }}%)
            </span>
          </div>
          <div class="header-actions">
            <div class="search-box">
              <input type="text" [(ngModel)]="searchQuery" (keyup.enter)="searchReads()" placeholder="Search by ID or sequence...">
              <button (click)="searchReads()">Search</button>
              <button (click)="clearSearch()" *ngIf="searchQuery">Clear</button>
            </div>
            <button type="button" class="btn-align-toggle" [class.active]="showAlignPanel" (click)="toggleAlignPanel()">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
              Align Controls {{ isAlignedActive ? '(Active)' : '' }}
            </button>
          </div>
        </div>

        <!-- Align Config Panel -->
        <div class="align-config-panel" *ngIf="showAlignPanel">
          <div class="align-mode-tabs">
            <button type="button" class="mode-tab-btn" [class.active]="alignMode === 'window'" (click)="alignMode = 'window'">
              Option A: Window Sequence Direct Input
            </button>
            <button type="button" class="mode-tab-btn" [class.active]="alignMode === 'ref_target'" (click)="alignMode = 'ref_target'">
              Option B: Reference + Target (gRNA) Input
            </button>
          </div>

          <!-- Mode A: Direct Window Input -->
          <div class="align-inputs-group" *ngIf="alignMode === 'window'">
            <div class="form-field full-width">
              <label>Target Window Sequence (e.g. 90 bp):</label>
              <textarea class="form-control text-mono" [(ngModel)]="inputWindowSeq" rows="2" placeholder="Paste target window sequence (e.g. 90bp)..."></textarea>
            </div>
          </div>

          <!-- Mode B: Reference + Target gRNA Input -->
          <div class="align-inputs-group" *ngIf="alignMode === 'ref_target'">
            <div class="form-field full-width">
              <label>Reference Sequence:</label>
              <textarea class="form-control text-mono" [(ngModel)]="inputRefSeq" rows="2" placeholder="Paste full gene reference sequence..."></textarea>
            </div>
            <div class="form-row">
              <div class="form-field flex-2">
                <label>Target / gRNA Sequence:</label>
                <input type="text" class="form-control text-mono" [(ngModel)]="inputGrnaSeq" placeholder="e.g. TGGAGTTGTTGAGGATCCGA">
              </div>
              <div class="form-field flex-1">
                <label>Window Size (bp):</label>
                <input type="number" class="form-control" [(ngModel)]="inputWinSize" min="30" max="500">
              </div>
            </div>
          </div>

          <div class="align-panel-actions">
            <button type="button" class="btn-run-align" (click)="runAlign()">Run Alignment & Center Cut Sites</button>
            <button type="button" class="btn-reset-align" (click)="resetAlign()" *ngIf="isAlignedActive">Reset Alignment</button>
          </div>
        </div>

        <!-- ── Unified Multi-Sequence Alignment Block (Group 1: Aligned Reads) ── -->
        <div class="msa-section" *ngIf="isAlignedActive && alignedReadsList.length > 0">
          <div class="msa-section-header">
            <h4>Aligned Reads Block (Centered at Cut Site)</h4>
            <span class="msa-help-text">💡 Drag mouse or scroll horizontally — all reads move together as one block</span>
          </div>

          <div class="msa-wrapper">
            <!-- Left Sticky Read IDs Panel -->
            <div class="msa-ids-column">
              <div class="msa-id-header">READ ID</div>
              <div class="msa-id-row reference-id-row">
                <span class="msa-id-tag ref-tag">REFERENCE ({{ alignedWindowSeq.length }} bp)</span>
              </div>
              <div class="msa-id-row" *ngFor="let read of visibleAlignedReads">
                <span class="msa-id-tag" [title]="'@' + read.id">{{ '@' + read.id }}</span>
              </div>
            </div>

            <!-- Right Single Scrollable Sequence Alignment Canvas -->
            <div class="msa-seq-viewport scrollable-drag" #msaViewport
              (mousedown)="startDragScroll($event, msaViewport)"
              (mouseleave)="stopDragScroll(msaViewport)"
              (mouseup)="stopDragScroll(msaViewport)"
              (mousemove)="onDragScroll($event, msaViewport)">
              
              <div class="msa-seq-rows-container monospaced">
                <!-- Single vertical cut-site guide line down canvas -->
                <div class="cut-site-vertical-guide" [style.left.px]="cutSiteGuideLeftPx"></div>

                <!-- Reference Sequence Header Row -->
                <div class="msa-seq-row reference-seq-row">
                  <span class="pad-spaces">{{ refLeadPadding }}</span>
                  <span class="seq-window-box ref-window-box">
                    <span *ngFor="let char of alignedWindowSeq.split(''); let k = index"
                      class="grid-cell ref-cell"
                      [class.is-cut-col]="k === alignedCutSiteInWindow"
                      [title]="'Ref Pos ' + (k + 1) + (k === alignedCutSiteInWindow ? ' (Cut Site ✂)' : '')">
                      {{ char }}
                      <span class="ref-cut-badge" *ngIf="k === alignedCutSiteInWindow" title="Cut Site ✂">✂</span>
                    </span>
                  </span>
                </div>

                <!-- Aligned Read Rows -->
                <div class="msa-seq-row" *ngFor="let read of visibleAlignedReads">
                  <span class="pad-spaces">{{ read.leadPadding }}</span>
                  <span class="seq-flank pre-flank">{{ read.preWinSeq }}</span>
                  <span class="seq-window-box">
                    <ng-container *ngFor="let cell of read.grid; let k = index">
                      <span [class]="'grid-cell cell-' + cell.type" [class.is-cut-col]="k === alignedCutSiteInWindow">
                        {{ cell.char }}
                      </span>
                      <span class="ins-badge" *ngIf="cell.insertion" [title]="'Insertion (+' + cell.insertion.length + ' bp): ' + cell.insertion">
                        +{{ cell.insertion.length }}bp
                      </span>
                    </ng-container>
                  </span>
                  <span class="seq-flank post-flank">{{ read.postWinSeq }}</span>
                  <span class="rc-tag" *ngIf="read.isRc" title="Reverse Complement Strand (Re-oriented 5'->3')">3'←5'</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Unaligned Reads List (Group 2: Unaligned Reads) ── -->
        <div class="unaligned-section" *ngIf="unalignedReadsList.length > 0">
          <h4 class="unaligned-title">Unaligned Reads ({{ unalignedReadsList.length | number }})</h4>
          <div class="unaligned-list">
            <div class="read-card unaligned-card" *ngFor="let read of visibleUnalignedReads">
              <div class="read-header">
                <span class="read-id">{{ '@' + read.id }}</span>
                <span class="read-len">{{ read.seq.length }} bp</span>
              </div>
              <div class="read-seq-box monospaced">
                <span class="raw-seq-text">{{ read.seq }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <div class="load-more" *ngIf="hasMore">
          <button (click)="loadMore()">Showing {{ visibleReads.length | number }} of {{ filteredReads.length | number }} (Scroll down to auto-load)</button>
        </div>

        <div class="empty-state" *ngIf="visibleReads.length === 0">
          No reads found matching "{{ searchQuery }}"
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; }
    .fastq-viewer {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: #f8f9fa;
    }
    .reads-panel {
      background: white;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .reads-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .reads-header h3 { margin: 0; font-size: 1.15rem; color: #1e293b; }
    .aligned-summary-tag {
      font-size: 0.85rem;
      color: #15803d;
      background: #dcfce7;
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid #86efac;
    }
    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .search-box {
      display: flex;
      gap: 8px;
    }
    .search-box input {
      padding: 6px 12px;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 4px;
      width: 220px;
    }
    .search-box button {
      padding: 6px 12px;
      background: #f1f5f9;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 4px;
      cursor: pointer;
    }
    .btn-align-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-align-toggle:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }
    .btn-align-toggle.active {
      background: #eff6ff;
      border-color: #3b82f6;
      color: #2563eb;
    }

    .align-config-panel {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .align-mode-tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
    }
    .mode-tab-btn {
      padding: 6px 14px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-size: 0.82rem;
      font-weight: 600;
      color: #475569;
      cursor: pointer;
    }
    .mode-tab-btn.active {
      background: #2563eb;
      color: #ffffff;
    }
    .align-inputs-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .form-row {
      display: flex;
      gap: 12px;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .form-field.full-width { width: 100%; }
    .form-field.flex-1 { flex: 1; }
    .form-field.flex-2 { flex: 2; }
    .form-field label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #475569;
    }
    .text-mono {
      font-family: 'Courier New', Courier, monospace !important;
      font-size: 0.85rem !important;
    }
    .form-control {
      padding: 8px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
    }
    .align-panel-actions {
      display: flex;
      gap: 10px;
    }
    .btn-run-align {
      padding: 8px 16px;
      background: #16a34a;
      color: #ffffff;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-run-align:hover { background: #15803d; }
    .btn-reset-align {
      padding: 8px 16px;
      background: #ef4444;
      color: #ffffff;
      font-weight: 600;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .btn-reset-align:hover { background: #dc2626; }

    /* ── Unified Multi-Sequence Alignment Block ── */
    .msa-section {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .msa-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .msa-section-header h4 {
      margin: 0;
      color: #1e293b;
      font-size: 1.05rem;
    }
    .msa-help-text {
      font-size: 0.78rem;
      color: #16a34a;
      background: #f0fdf4;
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid #bbf7d0;
      font-weight: 600;
    }
    .msa-wrapper {
      display: flex;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
      background: #ffffff;
      position: relative;
    }
    .msa-ids-column {
      flex-shrink: 0;
      width: 260px;
      background: #f8fafc;
      border-right: 2px solid #cbd5e1;
      user-select: none;
      z-index: 3;
    }
    .msa-id-header {
      height: 32px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 0.75rem;
      font-weight: 700;
      color: #64748b;
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
    }
    .msa-id-row {
      height: 32px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    .reference-id-row {
      background: #f1f5f9;
      border-bottom: 2px solid #cbd5e1;
    }
    .ref-tag {
      color: #2563eb;
      font-weight: 700;
    }
    .msa-id-tag {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.8rem;
      font-weight: bold;
      color: #334155;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .msa-seq-viewport {
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
      cursor: grab;
      scrollbar-width: thin;
      background: #ffffff;
    }
    .msa-seq-viewport.dragging {
      cursor: grabbing;
      user-select: none;
    }
    .msa-seq-rows-container {
      display: inline-flex;
      flex-direction: column;
      min-width: 100%;
      position: relative;
    }

    /* Single vertical red cut site line extending down canvas */
    .cut-site-vertical-guide {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #ef4444;
      z-index: 4;
      pointer-events: none;
      box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
    }

    .msa-seq-row {
      height: 32px;
      display: flex;
      align-items: center;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      white-space: pre !important;
      border-bottom: 1px solid #f1f5f9;
      padding: 0 12px;
    }
    .msa-seq-row:hover {
      background: #f8fafc;
    }
    .reference-seq-row {
      background: #f1f5f9;
      border-bottom: 2px solid #cbd5e1;
      font-weight: bold;
    }

    .pad-spaces { white-space: pre; }
    .seq-flank { color: #94a3b8; }

    .seq-window-box {
      display: inline-flex;
      align-items: center;
      background: #ffffff;
      padding: 0 2px;
    }

    .grid-cell {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1ch;
      text-align: center;
      font-family: 'Courier New', Courier, monospace;
      position: relative;
    }
    .grid-cell.ref-cell {
      color: #0f172a;
      font-weight: bold;
    }
    .grid-cell.cell-equal {
      color: #1e293b;
    }
    .grid-cell.cell-substitute {
      background: #fef3c7;
      color: #d97706;
      font-weight: bold;
      border-radius: 2px;
    }
    .grid-cell.cell-delete {
      background: #fee2e2;
      color: #dc2626;
      font-weight: bold;
      border-radius: 2px;
    }
    .grid-cell.cell-unobserved {
      color: #cbd5e1;
    }
    .grid-cell.is-cut-col {
      border-left: 1px solid rgba(239, 68, 68, 0.4);
    }

    .ref-cut-badge {
      position: absolute;
      top: -12px;
      font-size: 10px;
      color: #dc2626;
      font-weight: bold;
    }

    .ins-badge {
      display: inline-flex;
      align-items: center;
      background: #f3e8ff;
      color: #7e22ce;
      border: 1px solid #d8b4fe;
      border-radius: 3px;
      font-size: 10px;
      padding: 0 3px;
      font-weight: bold;
      margin: 0 1px;
      user-select: none;
    }

    .rc-tag {
      font-size: 10px;
      background: #f1f5f9;
      color: #64748b;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 8px;
      font-weight: 600;
      border: 1px solid #e2e8f0;
    }

    /* Unaligned Section */
    .unaligned-section {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 16px;
    }
    .unaligned-title {
      margin: 0 0 12px 0;
      color: #64748b;
      font-size: 0.95rem;
    }
    .unaligned-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .read-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px;
    }
    .read-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 0.8rem;
    }
    .read-id { font-weight: 600; color: #334155; }
    .read-len { color: #7f8c8d; }
    .read-seq-box {
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      white-space: nowrap;
      overflow-x: auto;
      background: #ffffff;
      padding: 6px 10px;
      border: 1px solid #edf2f7;
      border-radius: 4px;
    }
    .raw-seq-text { color: #1e293b; }

    .load-more {
      text-align: center;
      margin-top: 16px;
    }
    .load-more button {
      padding: 8px 16px;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }
    .load-more button:hover { background: #2980b9; }
    .empty-state {
      text-align: center;
      padding: 32px;
      color: #7f8c8d;
    }
  `]
})
export class FastqViewerComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() document!: FastqDocument;
  @ViewChild('msaViewport') msaViewportRef!: ElementRef;

  processedReads: ProcessedRead[] = [];
  filteredReads: ProcessedRead[] = [];
  visibleReads: ProcessedRead[] = [];
  searchQuery = '';
  chunkSize = 100;
  hasMore = false;
  maxPreCutLen = 0;
  refLeadPadding = '';
  cutSiteGuideLeftPx = 0;
  isLoadingMore = false;

  onViewerScroll(event: Event) {
    const el = event.target as HTMLElement;
    if (!el || !this.hasMore || this.isLoadingMore) return;

    const threshold = 350;
    const position = el.scrollTop + el.clientHeight;
    const height = el.scrollHeight;

    if (height - position < threshold) {
      this.isLoadingMore = true;
      this.loadMore();
      setTimeout(() => {
        this.isLoadingMore = false;
      }, 100);
    }
  }

  // Alignment State
  showAlignPanel = false;
  alignMode: 'window' | 'ref_target' = 'window';
  
  inputWindowSeq = '';
  inputRefSeq = '';
  inputGrnaSeq = '';
  inputWinSize = 90;

  isAlignedActive = false;
  alignedWindowSeq = '';
  alignedCutSiteInWindow = -1;
  alignedStats = { total: 0, alignedCount: 0, unalignedCount: 0, percentage: 0 };

  // Mouse drag scroll state
  isDragging = false;
  startX = 0;
  scrollLeft = 0;

  private currentDocId: string | null = null;

  constructor(private sequenceWorkspaceService: SequenceWorkspaceService) {}

  ngOnInit() {
    this.sequenceWorkspaceService.pendingAutoAlign$.subscribe(pending => {
      if (pending && this.document) {
        this.checkPendingAutoAlign();
      }
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['document']) {
      const prevId = changes['document'].previousValue?.id;
      const currId = changes['document'].currentValue?.id;

      if (prevId !== currId) {
        this.currentDocId = currId || null;
        this.isAlignedActive = false;
        this.alignedWindowSeq = '';
        this.alignedCutSiteInWindow = -1;
      }
    }

    const pending = this.sequenceWorkspaceService.getPendingAutoAlign() || (this.document as any)?.autoAlign;
    if (pending) {
      this.checkPendingAutoAlign();
    } else {
      this.initProcessedReads();
    }
  }

  ngAfterViewInit() {
    this.checkPendingAutoAlign();
  }

  get alignedReadsList(): ProcessedRead[] {
    return this.processedReads.filter(r => r.isAligned);
  }

  get unalignedReadsList(): ProcessedRead[] {
    return this.processedReads.filter(r => !r.isAligned);
  }

  get visibleAlignedReads(): ProcessedRead[] {
    return this.visibleReads.filter(r => r.isAligned);
  }

  get visibleUnalignedReads(): ProcessedRead[] {
    return this.visibleReads.filter(r => !r.isAligned);
  }

  private checkPendingAutoAlign() {
    if (!this.document) return;
    const pending = this.sequenceWorkspaceService.getPendingAutoAlign() || (this.document as any)?.autoAlign;
    if (pending) {
      this.inputWindowSeq = pending.windowSeq || '';
      this.inputRefSeq = pending.refSeq || '';
      this.inputGrnaSeq = pending.grnaSeq || '';
      this.inputWinSize = pending.winSize || 90;
      if (pending.refSeq && pending.grnaSeq) {
        this.alignMode = 'ref_target';
      } else {
        this.alignMode = 'window';
      }
      if (this.sequenceWorkspaceService.getPendingAutoAlign()) {
        this.sequenceWorkspaceService.clearPendingAutoAlign();
      }
      this.runAlign();
    }
  }

  private initProcessedReads() {
    if (!this.document || !this.document.reads) {
      this.processedReads = [];
      this.filteredReads = [];
      this.visibleReads = [];
      return;
    }

    if (this.isAlignedActive) {
      this.reprocessAlignment();
    } else {
      this.processedReads = this.document.reads.map(r => ({
        id: r.id,
        seq: r.seq,
        qualString: r.qualString,
        isAligned: false
      }));
      this.applyFilterAndPagination();
    }
  }

  toggleAlignPanel() {
    this.showAlignPanel = !this.showAlignPanel;
  }

  runAlign() {
    let targetWin = '';
    let cutSiteInWin = -1;

    if (this.alignMode === 'window') {
      targetWin = this.inputWindowSeq.trim().toUpperCase();
      cutSiteInWin = Math.floor(targetWin.length / 2);
    } else {
      const refSeq = this.inputRefSeq.trim().toUpperCase();
      const grnaSeq = this.inputGrnaSeq.trim().toUpperCase();
      if (!refSeq || !grnaSeq) return;

      const cutInfo = findGrnaCutSite(refSeq, grnaSeq);
      let cutSite = cutInfo.cut_site;
      if (cutSite < 0 || cutSite >= refSeq.length) {
        cutSite = Math.floor(refSeq.length / 2);
      }

      targetWin = extractWindow(refSeq, cutSite, this.inputWinSize);
      cutSiteInWin = cutInfo.grna_start !== -1 ? cutIndexInWindow(refSeq, cutSite, this.inputWinSize) : Math.floor(targetWin.length / 2);
    }

    if (!targetWin) return;

    this.alignedWindowSeq = targetWin;
    this.alignedCutSiteInWindow = cutSiteInWin;
    this.isAlignedActive = true;

    this.reprocessAlignment();
  }

  private reprocessAlignment() {
    const targetWin = this.alignedWindowSeq;
    const cutSiteInWin = this.alignedCutSiteInWindow;
    const grna = this.inputGrnaSeq.trim().toUpperCase();

    let alignedCount = 0;

    const list: ProcessedRead[] = this.document.reads.map(r => {
      const res = this.findAlignmentInRead(r.seq, targetWin, cutSiteInWin, grna);
      if (res.isAligned) alignedCount++;
      return {
        id: r.id,
        seq: r.seq,
        qualString: r.qualString,
        isAligned: res.isAligned,
        category: res.category,
        netIndel: res.netIndel,
        hasSub: res.hasSub,
        grid: res.grid,
        preWinSeq: res.preWinSeq,
        postWinSeq: res.postWinSeq,
        isRc: res.isRc,
        leadPadding: ''
      };
    });

    const alignedList = list.filter(r => r.isAligned);
    let maxPreFlankLen = 0;
    for (const r of alignedList) {
      const preLen = r.preWinSeq?.length || 0;
      if (preLen > maxPreFlankLen) maxPreFlankLen = preLen;
    }
    this.maxPreCutLen = maxPreFlankLen;
    this.refLeadPadding = ' '.repeat(maxPreFlankLen);

    for (const r of alignedList) {
      const preLen = r.preWinSeq?.length || 0;
      const padCount = Math.max(0, maxPreFlankLen - preLen);
      r.leadPadding = ' '.repeat(padCount);
    }

    // Single vertical red guide line position in pixels
    const cutSiteColChar = maxPreFlankLen + (this.alignedCutSiteInWindow >= 0 ? this.alignedCutSiteInWindow : Math.floor(targetWin.length / 2));
    this.cutSiteGuideLeftPx = (cutSiteColChar * 7.8) + 12;

    list.sort((a, b) => {
      if (a.isAligned && !b.isAligned) return -1;
      if (!a.isAligned && b.isAligned) return 1;
      return 0;
    });

    const total = list.length;
    this.alignedStats = {
      total,
      alignedCount,
      unalignedCount: total - alignedCount,
      percentage: total > 0 ? (alignedCount / total) * 100 : 0
    };

    this.processedReads = list;
    this.applyFilterAndPagination();
    this.centerCutSiteScroll();
  }

  centerCutSiteScroll() {
    setTimeout(() => {
      if (!this.msaViewportRef) return;
      const el = this.msaViewportRef.nativeElement as HTMLElement;
      const targetScrollLeft = Math.max(0, this.cutSiteGuideLeftPx - (el.clientWidth / 2));
      el.scrollLeft = targetScrollLeft;
    }, 60);
  }

  // Mouse Drag Scroll Handlers
  startDragScroll(e: MouseEvent, element: HTMLElement) {
    this.isDragging = true;
    element.classList.add('dragging');
    this.startX = e.pageX - element.offsetLeft;
    this.scrollLeft = element.scrollLeft;
  }

  stopDragScroll(element: HTMLElement) {
    this.isDragging = false;
    element.classList.remove('dragging');
  }

  onDragScroll(e: MouseEvent, element: HTMLElement) {
    if (!this.isDragging) return;
    e.preventDefault();
    const x = e.pageX - element.offsetLeft;
    const walk = (x - this.startX) * 1.5;
    element.scrollLeft = this.scrollLeft - walk;
  }

  resetAlign() {
    this.isAlignedActive = false;
    this.alignedWindowSeq = '';
    this.alignedCutSiteInWindow = -1;
    this.initProcessedReads();
  }

  private findAlignmentInRead(readSeq: string, targetWin: string, cutIdxInWin: number, sgrnaSeq?: string) {
    const [usable, , bestRes] = isReadUsable(readSeq, null, targetWin, 0, sgrnaSeq || '', cutIdxInWin);

    if (!usable || !bestRes) {
      return {
        isAligned: false,
        preWinSeq: readSeq,
        grid: [],
        postWinSeq: '',
        isRc: false
      };
    }

    const isRc = bestRes.is_rc;
    const alignedSeq = isRc ? reverseComplement(readSeq) : readSeq;
    const cutPos = cutIdxInWin >= 0 ? cutIdxInWin : Math.floor(targetWin.length / 2);

    const mutRes = classifyMutationWithAlignment(targetWin, bestRes.read_window, bestRes.left_x, bestRes.right_x);

    const obsRead = bestRes.observed_read || alignedSeq;
    const seqUp = alignedSeq.toUpperCase();
    const obsPos = seqUp.indexOf(obsRead.toUpperCase());

    let preWinSeq = '';
    let postWinSeq = '';
    if (obsPos !== -1) {
      preWinSeq = alignedSeq.substring(0, obsPos);
      postWinSeq = alignedSeq.substring(obsPos + obsRead.length);
    } else {
      const approxStart = Math.max(0, Math.floor(alignedSeq.length / 2) - cutPos);
      preWinSeq = alignedSeq.substring(0, approxStart);
      postWinSeq = alignedSeq.substring(Math.min(alignedSeq.length, approxStart + targetWin.length));
    }

    const grid = this.buildWindowGrid(mutRes.tokens, targetWin.length);

    return {
      isAligned: true,
      category: mutRes.category,
      netIndel: mutRes.net_indel,
      hasSub: mutRes.has_sub,
      grid,
      preWinSeq,
      postWinSeq,
      isRc
    };
  }

  private buildWindowGrid(tokens: AlignmentToken[], winLen: number): WindowGridCell[] {
    const grid: WindowGridCell[] = [];
    let refIdx = 0;

    for (const t of tokens) {
      if (t.type === 'insert') {
        if (grid.length > 0) {
          const prevCell = grid[grid.length - 1];
          prevCell.insertion = (prevCell.insertion || '') + t.val;
        } else {
          grid.push({
            char: 'X',
            type: 'unobserved',
            insertion: t.val
          });
          refIdx++;
        }
      } else {
        for (const char of t.val.split('')) {
          if (refIdx < winLen) {
            if (t.type === 'delete') {
              grid.push({ char: '-', type: 'delete' });
            } else if (t.type === 'substitute') {
              grid.push({ char, type: 'substitute' });
            } else if (t.type === 'unobserved') {
              grid.push({ char: 'X', type: 'unobserved' });
            } else {
              grid.push({ char, type: 'equal' });
            }
            refIdx++;
          }
        }
      }
    }

    while (grid.length < winLen) {
      grid.push({ char: 'X', type: 'unobserved' });
    }

    return grid;
  }

  searchReads() {
    this.applyFilterAndPagination();
  }

  clearSearch() {
    this.searchQuery = '';
    this.applyFilterAndPagination();
  }

  private applyFilterAndPagination() {
    if (!this.searchQuery.trim()) {
      this.filteredReads = [...this.processedReads];
    } else {
      const q = this.searchQuery.toLowerCase();
      this.filteredReads = this.processedReads.filter(r =>
        r.id.toLowerCase().includes(q) || r.seq.toLowerCase().includes(q)
      );
    }
    this.visibleReads = this.filteredReads.slice(0, this.chunkSize);
    this.hasMore = this.filteredReads.length > this.visibleReads.length;
  }

  loadMore() {
    const currLen = this.visibleReads.length;
    const nextChunk = this.filteredReads.slice(currLen, currLen + this.chunkSize);
    this.visibleReads = [...this.visibleReads, ...nextChunk];
    this.hasMore = this.filteredReads.length > this.visibleReads.length;
  }
}
