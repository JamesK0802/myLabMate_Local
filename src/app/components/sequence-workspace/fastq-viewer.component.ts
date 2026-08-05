import { Component, Input, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FastqDocument } from '../../models/sequence.model';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { isReadUsable, findGrnaCutSite, extractWindow, cutIndexInWindow, reverseComplement } from '../../workers/core/classifier';
import { classifyMutationWithAlignment, AlignmentToken } from '../../workers/core/analyzer';

export interface AlignmentTokenWithCut {
  type: 'equal' | 'substitute' | 'delete' | 'insert' | 'unobserved' | 'cut_site';
  val: string;
}

export interface ProcessedRead {
  id: string;
  seq: string;
  qualString?: string;
  isAligned: boolean;
  category?: string;
  netIndel?: number;
  hasSub?: boolean;
  tokens?: AlignmentTokenWithCut[];
  preWinSeq?: string;
  postWinSeq?: string;
  preCutRefChars?: number;
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
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="21" y1="18" x2="3" y2="18"/></svg>
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
                <div class="msa-seq-header-spacer"></div>
                <div class="msa-seq-row" *ngFor="let read of visibleAlignedReads">
                  <span class="pad-spaces">{{ read.leadPadding }}</span>
                  <span class="seq-flank pre-flank">{{ read.preWinSeq }}</span>
                  <span class="seq-window-box" title="Extracted Target Window Alignment">
                    <ng-container *ngFor="let t of read.tokens">
                      <ng-container *ngIf="t.type === 'equal'">
                        <span class="tok-equal" *ngFor="let char of t.val.split('')">{{ char }}</span>
                      </ng-container>
                      <ng-container *ngIf="t.type === 'substitute'">
                        <span class="tok-sub" *ngFor="let char of t.val.split('')" [title]="'Substitution: ' + char">{{ char }}</span>
                      </ng-container>
                      <ng-container *ngIf="t.type === 'delete'">
                        <span class="tok-del" *ngFor="let char of t.val.split('')" title="Deletion">-</span>
                      </ng-container>
                      <ng-container *ngIf="t.type === 'insert'">
                        <span class="tok-ins" [title]="'Insertion (+' + t.val.length + ' bp): ' + t.val">+{{ t.val.length }}</span>
                      </ng-container>
                      <ng-container *ngIf="t.type === 'unobserved'">
                        <span class="tok-unobserved" *ngFor="let char of t.val.split('')">-</span>
                      </ng-container>
                      <span class="cut-site-badge" *ngIf="t.type === 'cut_site'" title="gRNA Cut Site ✂">✂</span>
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
      height: 34px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid #f1f2f6;
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
    }
    .msa-seq-header-spacer {
      height: 32px;
      background: #f8fafc;
      border-bottom: 1px solid #cbd5e1;
    }
    .msa-seq-row {
      height: 34px;
      display: flex;
      align-items: center;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      white-space: pre !important;
      border-bottom: 1px solid #f1f2f6;
      padding: 0 12px;
      transition: background 0.1s ease;
    }
    .msa-seq-row:hover {
      background: #f0fdf4;
    }

    /* Sequence formatting inside row */
    .pad-spaces { white-space: pre; }
    .seq-flank { color: #64748b; }
    .seq-window-box {
      display: inline-flex;
      align-items: center;
      background: #fff7ed;
      border: 1.5px solid #f97316;
      border-radius: 4px;
      padding: 1px 6px;
      font-weight: bold;
    }
    .tok-equal { color: #1e293b; }
    .tok-sub {
      background: #3b82f6;
      color: #ffffff;
      padding: 0 2px;
      border-radius: 2px;
      font-weight: bold;
      margin: 0 1px;
    }
    .tok-del {
      background: #ef4444;
      color: #ffffff;
      padding: 0 2px;
      border-radius: 2px;
      font-weight: bold;
      margin: 0 1px;
    }
    .tok-ins {
      background: #8b5cf6;
      color: #ffffff;
      padding: 0 4px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
      margin: 0 2px;
    }
    .tok-unobserved { color: #cbd5e1; }
    .cut-site-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #dc2626;
      color: #ffffff;
      font-size: 11px;
      padding: 0 4px;
      border-radius: 3px;
      font-weight: bold;
      margin: 0 3px;
      box-shadow: 0 0 4px rgba(220, 38, 38, 0.6);
      user-select: none;
    }
    .rc-tag {
      font-size: 10px;
      background: #e2e8f0;
      color: #475569;
      padding: 1px 4px;
      border-radius: 3px;
      margin-left: 8px;
      font-weight: bold;
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
        tokens: res.tokens,
        preWinSeq: res.preWinSeq,
        postWinSeq: res.postWinSeq,
        preCutRefChars: res.preCutRefChars,
        isRc: res.isRc,
        leadPadding: ''
      };
    });

    // Calculate maximum pre-cut length for vertical cut-site centering
    const alignedList = list.filter(r => r.isAligned);
    let maxPreCutLen = 0;
    for (const r of alignedList) {
      const preLen = r.preCutRefChars || 0;
      if (preLen > maxPreCutLen) maxPreCutLen = preLen;
    }
    this.maxPreCutLen = maxPreCutLen;

    for (const r of alignedList) {
      const preLen = r.preCutRefChars || 0;
      const padCount = Math.max(0, maxPreCutLen - preLen);
      r.leadPadding = ' '.repeat(padCount);
    }

    // Group 1 (Aligned reads) at the top, Group 2 (Unaligned reads) at the bottom
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
      const charWidth = 8.5; // pixel width per character in 13px monospace font
      const cutSiteColChar = this.maxPreCutLen + 4;
      const cutSitePixelX = cutSiteColChar * charWidth;
      const viewportWidth = el.clientWidth;
      const targetScrollLeft = Math.max(0, cutSitePixelX - (viewportWidth / 2));
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
        tokens: [],
        postWinSeq: '',
        preCutRefChars: readSeq.length,
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

    const tokensWithCut = this.insertCutSiteIntoTokens(mutRes.tokens, cutPos);

    let preCutRefChars = preWinSeq.length;
    for (const t of tokensWithCut) {
      if (t.type === 'cut_site') break;
      if (t.type === 'insert') continue;
      preCutRefChars += t.val.length;
    }

    return {
      isAligned: true,
      category: mutRes.category,
      netIndel: mutRes.net_indel,
      hasSub: mutRes.has_sub,
      tokens: tokensWithCut,
      preWinSeq,
      postWinSeq,
      preCutRefChars,
      isRc
    };
  }

  private insertCutSiteIntoTokens(tokens: AlignmentToken[], cutIdx: number): AlignmentTokenWithCut[] {
    if (cutIdx < 0) return tokens as AlignmentTokenWithCut[];

    const result: AlignmentTokenWithCut[] = [];
    let refPos = 0;
    let cutInserted = false;

    for (const t of tokens) {
      const refLen = (t.type === 'insert') ? 0 : t.val.length;

      if (!cutInserted && refPos <= cutIdx && (refPos + refLen >= cutIdx)) {
        const offset = cutIdx - refPos;
        if (offset === 0) {
          result.push({ type: 'cut_site', val: '✂' });
          cutInserted = true;
          result.push({ ...t });
        } else {
          const valBefore = t.val.substring(0, offset);
          const valAfter = t.val.substring(offset);
          if (valBefore) result.push({ type: t.type, val: valBefore });
          result.push({ type: 'cut_site', val: '✂' });
          cutInserted = true;
          if (valAfter) result.push({ type: t.type, val: valAfter });
        }
      } else {
        result.push({ ...t });
      }
      refPos += refLen;
    }

    if (!cutInserted) {
      result.push({ type: 'cut_site', val: '✂' });
    }

    return result;
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
