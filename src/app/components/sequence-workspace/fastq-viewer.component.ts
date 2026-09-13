import { Component, Input, OnInit, OnChanges, SimpleChanges, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
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
  alignmentFailureReason?: string;
}

function buildMotifRegex(query: string): RegExp | null {
  const q = query.trim().toUpperCase();
  if (!q) return null;

  const iupacMap: { [key: string]: string } = {
    'A': 'A', 'C': 'C', 'G': 'G', 'T': 'T', 'U': 'T',
    'N': '[ACGT]',
    'R': '[GA]',
    'Y': '[CT]',
    'S': '[GC]',
    'W': '[AT]',
    'K': '[GT]',
    'M': '[AC]',
    'B': '[CGT]',
    'D': '[AGT]',
    'H': '[ACT]',
    'V': '[ACG]'
  };

  let regexStr = '';
  for (const char of q) {
    if (iupacMap[char]) {
      regexStr += iupacMap[char];
    } else {
      regexStr += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }

  try {
    return new RegExp(regexStr, 'gi');
  } catch (e) {
    return null;
  }
}

@Component({
  selector: 'app-fastq-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fastq-viewer" (scroll)="onViewerScroll($event)">
      <div class="reads-panel">
        
        <!-- Compact Top Workspace Bar -->
        <div class="workspace-top-bar">
          <div class="top-bar-left">
            <span class="workspace-title">Reads Workspace</span>
            <span class="aligned-summary-tag" *ngIf="isAlignedActive">
              Aligned: <strong>{{ alignedStats.alignedCount | number }}</strong> / {{ alignedStats.total | number }} ({{ alignedStats.percentage | number:'1.1-1' }}%)
            </span>
            <span class="unaligned-summary-tag" *ngIf="!isAlignedActive">
              Total Reads: <strong>{{ processedReads.length | number }}</strong>
            </span>
            <span class="filter-count-tag" *ngIf="searchQuery.trim()">
              Filtered: <strong>{{ filteredReads.length | number }}</strong> matches
            </span>
            <div class="read-order-toggle" *ngIf="isAlignedActive && alignedStats.unalignedCount > 0" aria-label="Read display order">
              <button type="button" [class.active]="alignmentReadOrder === 'aligned'" (click)="setAlignmentReadOrder('aligned')">
                Aligned first ({{ alignedStats.alignedCount | number }})
              </button>
              <button type="button" [class.active]="alignmentReadOrder === 'unaligned'" (click)="setAlignmentReadOrder('unaligned')">
                Unaligned first ({{ alignedStats.unalignedCount | number }})
              </button>
            </div>
          </div>

          <div class="top-bar-right">
            <div class="search-box">
              <input type="text" [(ngModel)]="searchQuery" (ngModelChange)="searchReads()" (keyup.enter)="searchReads()" placeholder="Search ID or motif (e.g. NGG)...">
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

        <div class="alignment-results" [class.unaligned-first]="isAlignedActive && alignmentReadOrder === 'unaligned'">
        <!-- ── Aligned Reads Split Table (Group 1: Aligned Reads) ── -->
        <div class="msa-section aligned-result-section" *ngIf="isAlignedActive && visibleAlignedReads.length > 0">
          <div class="msa-wrapper">
            <!-- Left Sticky Read IDs Panel -->
            <div class="msa-ids-column">
              <div class="msa-id-header"><span class="desktop-label">READ ID</span><span class="mobile-label">READ</span></div>
              <div class="msa-id-row reference-id-row">
                <span class="mobile-reference-label">REF</span>
                <span class="msa-id-tag ref-tag">REFERENCE ({{ alignedWindowSeq.length }} bp)</span>
              </div>
              <div class="msa-id-row" *ngFor="let read of visibleAlignedReads; let readIndex = index">
                <button type="button" class="mobile-read-index" (click)="showReadInfo(read)">#{{ readIndex + 1 }}</button>
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

                <!-- Top Sequence Header matched to READ ID header -->
                <div class="msa-seq-header">
                  <span class="msa-seq-header-title">ALIGNMENT CANVAS (Cut Site Centered ✂)</span>
                </div>

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
                        <span class="ins-indicator" *ngIf="cell.insertion"
                          [attr.data-tooltip]="'Insertion (+' + cell.insertion.length + ' bp): ' + cell.insertion"
                          [title]="'Insertion (+' + cell.insertion.length + ' bp): ' + cell.insertion">
                          +{{ cell.insertion.length }}
                        </span>
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

        <!-- ── Compact Split Table for Unaligned Reads (Group 2 or Default View) ── -->
        <div class="unaligned-section unaligned-result-section" *ngIf="!isAlignedActive || visibleUnalignedReads.length > 0">
          <div class="unaligned-section-title" *ngIf="isAlignedActive">
            <h4>Unaligned Reads ({{ unalignedReadsList.length | number }})</h4>
          </div>

          <div class="raw-table-wrapper">
            <!-- Left Sticky Read IDs Column -->
            <div class="raw-ids-column">
              <div class="raw-id-header"><span class="desktop-label">READ ID</span><span class="mobile-label">READ</span></div>
              <div class="raw-id-row" *ngFor="let read of (isAlignedActive ? visibleUnalignedReads : visibleReads); let readIndex = index">
                <button type="button" class="mobile-read-index" (click)="showReadInfo(read)">#{{ readIndex + 1 }}</button>
                <span class="raw-id-tag" [title]="'@' + read.id">{{ '@' + read.id }}</span>
                <span
                  class="alignment-failure-badge"
                  *ngIf="isAlignedActive && read.alignmentFailureReason"
                  [title]="alignmentFailureDetail(read.alignmentFailureReason)">
                  {{ alignmentFailureLabel(read.alignmentFailureReason) }}
                </span>
                <span class="raw-len-badge">{{ read.seq.length }} bp</span>
              </div>
            </div>

            <!-- Right Scrollable Raw Sequence Viewport -->
            <div class="raw-seq-viewport">
              <div class="raw-seq-container monospaced">
                <div class="raw-seq-header">RAW SEQUENCE (5' → 3')</div>
                <div class="raw-seq-row" *ngFor="let read of (isAlignedActive ? visibleUnalignedReads : visibleReads)">
                  <span class="raw-seq-text" [innerHTML]="highlightSeq(read.seq)"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
        
        <div #loadSentinel class="load-sentinel" *ngIf="hasMore" aria-live="polite">
          <span class="read-loading-spinner" *ngIf="isLoadingMore"></span>
          <span>{{ isLoadingMore ? 'Loading more reads…' : 'Scroll for more reads' }}</span>
        </div>

        <div class="empty-state" *ngIf="visibleReads.length === 0">
          No reads found matching "{{ searchQuery }}"
        </div>
      </div>

      <div class="mobile-read-info" *ngIf="selectedReadInfo" role="dialog" aria-label="Read information">
        <button type="button" class="read-info-close" (click)="selectedReadInfo = null" aria-label="Close read information">×</button>
        <span class="read-info-label">READ INFORMATION</span>
        <strong>{{ selectedReadInfo.id }}</strong>
        <span>{{ selectedReadInfo.seq.length | number }} bp</span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; }
    .fastq-viewer {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: #f8fafc;
    }
    .reads-panel {
      background: white;
      border: 1px solid var(--color-border, #cbd5e1);
      border-radius: 6px;
      padding: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Top Compact Workspace Bar */
    .workspace-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
      gap: 10px;
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 8px;
    }
    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .workspace-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #0f172a;
    }
    .aligned-summary-tag {
      font-size: 0.78rem;
      color: #15803d;
      background: #dcfce7;
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid #86efac;
    }
    .unaligned-summary-tag {
      font-size: 0.78rem;
      color: #475569;
      background: #f1f5f9;
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
    }
    .filter-count-tag {
      font-size: 0.78rem;
      color: #0369a1;
      background: #e0f2fe;
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid #bae6fd;
    }
    .read-order-toggle {
      display: inline-flex;
      padding: 2px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #f8fafc;
    }
    .read-order-toggle button {
      border: 0;
      border-radius: 4px;
      padding: 3px 8px;
      background: transparent;
      color: #64748b;
      font-size: 0.72rem;
      font-weight: 600;
      cursor: pointer;
    }
    .read-order-toggle button.active {
      background: #ffffff;
      color: #0f172a;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
    }
    .top-bar-right {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .search-box {
      display: flex;
      gap: 6px;
    }
    .search-box input {
      padding: 5px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      width: 240px;
      font-size: 0.82rem;
    }
    .search-box button {
      padding: 5px 10px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .btn-align-toggle {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 5px;
      font-size: 0.8rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
    }
    .btn-align-toggle.active {
      background: #eff6ff;
      border-color: #3b82f6;
      color: #2563eb;
    }

    .align-config-panel {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .align-mode-tabs {
      display: flex;
      gap: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 8px;
    }
    .mode-tab-btn {
      padding: 5px 12px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-size: 0.8rem;
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
      gap: 8px;
    }
    .form-row { display: flex; gap: 10px; }
    .form-field { display: flex; flex-direction: column; gap: 3px; }
    .form-field.full-width { width: 100%; }
    .form-field.flex-1 { flex: 1; }
    .form-field.flex-2 { flex: 2; }
    .form-field label { font-size: 0.78rem; font-weight: 600; color: #475569; }
    .text-mono { font-family: 'Courier New', Courier, monospace !important; font-size: 0.82rem !important; }
    .form-control { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 4px; }
    .align-panel-actions { display: flex; gap: 8px; }
    .btn-run-align {
      padding: 6px 14px; background: #16a34a; color: #ffffff; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; font-size: 0.8rem;
    }
    .btn-reset-align {
      padding: 6px 14px; background: #ef4444; color: #ffffff; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; font-size: 0.8rem;
    }

    /* ── Unified Multi-Sequence Alignment Block ── */
    .alignment-results {
      display: flex;
      flex-direction: column;
    }
    .aligned-result-section { order: 1; }
    .unaligned-result-section { order: 2; }
    .alignment-results.unaligned-first .unaligned-result-section { order: 1; }
    .alignment-results.unaligned-first .aligned-result-section { order: 2; }
    .msa-section {
      background: #ffffff;
      border-radius: 6px;
      margin-bottom: 12px;
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
      padding: 0 10px;
      font-size: 0.73rem;
      font-weight: 700;
      color: #64748b;
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      box-sizing: border-box;
    }
    .msa-id-row {
      height: 32px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      border-bottom: 1px solid #f1f5f9;
      box-sizing: border-box;
    }
    .reference-id-row {
      background: #f1f5f9;
      border-bottom: 2px solid #cbd5e1;
    }
    .ref-tag { color: #2563eb; font-weight: 700; }
    .msa-id-tag {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.78rem;
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
    .msa-seq-viewport.dragging { cursor: grabbing; user-select: none; }
    .msa-seq-rows-container {
      display: inline-flex;
      flex-direction: column;
      min-width: 100%;
      position: relative;
    }

    .msa-seq-header {
      height: 32px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.73rem;
      font-weight: 700;
      color: #64748b;
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      box-sizing: border-box;
    }
    .msa-seq-header-title { color: #475569; }

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
      padding: 0 10px;
      box-sizing: border-box;
    }
    .msa-seq-row:hover { background: #f8fafc; }
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
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1ch;
      text-align: center;
      font-family: 'Courier New', Courier, monospace;
    }
    .grid-cell.ref-cell { color: #0f172a; font-weight: bold; }
    .grid-cell.cell-equal { color: #1e293b; }
    .grid-cell.cell-substitute { background: #fef3c7; color: #d97706; font-weight: bold; border-radius: 2px; }
    .grid-cell.cell-delete { background: #fee2e2; color: #dc2626; font-weight: bold; border-radius: 2px; }
    .grid-cell.cell-unobserved { color: #cbd5e1; }
    .grid-cell.is-cut-col { border-left: 1px solid rgba(239, 68, 68, 0.4); }

    .ref-cut-badge { position: absolute; top: -11px; font-size: 10px; color: #dc2626; font-weight: bold; }

    /* Zero-width absolute superscript badge for insertions */
    .ins-indicator {
      position: absolute;
      top: -11px;
      right: -4px;
      background: #7e22ce;
      color: #ffffff;
      font-size: 8px;
      font-weight: bold;
      padding: 0 2px;
      border-radius: 2px;
      line-height: 1.1;
      z-index: 6;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    .ins-indicator:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #1e1b4b;
      color: #f3e8ff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: bold;
      white-space: nowrap;
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      pointer-events: none;
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

    /* ── Split Table UI for Unaligned / Raw Reads ── */
    .unaligned-section {
      margin-top: 4px;
    }
    .unaligned-section-title h4 {
      margin: 0 0 8px 0;
      color: #64748b;
      font-size: 0.88rem;
    }
    .raw-table-wrapper {
      display: flex;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
      background: #ffffff;
    }
    .raw-ids-column {
      flex-shrink: 0;
      width: 280px;
      background: #f8fafc;
      border-right: 2px solid #cbd5e1;
      user-select: none;
    }
    .raw-id-header {
      height: 32px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.73rem;
      font-weight: 700;
      color: #64748b;
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      box-sizing: border-box;
    }
    .raw-id-row {
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      border-bottom: 1px solid #f1f5f9;
      box-sizing: border-box;
      gap: 6px;
    }
    .raw-id-tag {
      font-family: 'Courier New', Courier, monospace;
      font-size: 0.78rem;
      font-weight: bold;
      color: #334155;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }
    .raw-len-badge {
      font-size: 0.7rem;
      color: #64748b;
      background: #e2e8f0;
      padding: 1px 5px;
      border-radius: 3px;
      white-space: nowrap;
      font-weight: 600;
    }
    .alignment-failure-badge {
      font-size: 0.68rem;
      color: #9a3412;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      padding: 1px 5px;
      border-radius: 999px;
      white-space: nowrap;
      font-weight: 600;
      cursor: help;
    }
    .raw-seq-viewport {
      flex: 1;
      overflow-x: auto;
      overflow-y: hidden;
      background: #ffffff;
      scrollbar-width: thin;
    }
    .raw-seq-container {
      display: inline-flex;
      flex-direction: column;
      min-width: 100%;
    }
    .raw-seq-header {
      height: 32px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      font-size: 0.73rem;
      font-weight: 700;
      color: #64748b;
      background: #f1f5f9;
      border-bottom: 1px solid #cbd5e1;
      box-sizing: border-box;
    }
    .raw-seq-row {
      height: 32px;
      display: flex;
      align-items: center;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      white-space: nowrap;
      border-bottom: 1px solid #f1f5f9;
      padding: 0 10px;
      box-sizing: border-box;
    }
    .raw-seq-row:hover { background: #f8fafc; }
    .raw-seq-text { color: #1e293b; }
    
    /* Search Highlight Style */
    ::ng-deep mark.search-hi {
      background: #fef08a !important;
      color: #854d0e !important;
      font-weight: bold !important;
      border-radius: 2px;
      padding: 0 2px;
      box-shadow: 0 0 3px rgba(234, 179, 8, 0.5);
    }

    .load-sentinel { min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 8px; color: #64748b; font-size: .76rem; font-weight: 700; }
    .read-loading-spinner { width: 16px; height: 16px; border: 2px solid #cbd5e1; border-top-color: #16a34a; border-radius: 50%; animation: read-spin .7s linear infinite; }
    @keyframes read-spin { to { transform: rotate(360deg); } }
    .empty-state { text-align: center; padding: 24px; color: #64748b; }
    .mobile-read-info,
    .mobile-label,
    .mobile-read-index,
    .mobile-reference-label { display: none; }

    @media (max-width: 700px) {
      .fastq-viewer { padding: 0; gap: 6px; }
      .reads-panel { padding: 8px 0; border-left: 0; border-right: 0; border-radius: 0; }
      .workspace-top-bar { align-items: stretch; gap: 8px; padding: 0 8px 8px; }
      .top-bar-left { width: 100%; flex-wrap: wrap; gap: 6px; }
      .workspace-title { font-size: .86rem; }
      .unaligned-summary-tag,
      .aligned-summary-tag,
      .filter-count-tag { font-size: .7rem; padding: 2px 7px; }
      .top-bar-right { width: 100%; min-width: 0; gap: 6px; }
      .search-box { flex: 1; min-width: 0; gap: 4px; }
      .search-box input { width: 0; min-width: 0; flex: 1; padding: 7px 8px; }
      .search-box button { padding: 7px 9px; }
      .btn-align-toggle { flex: 0 0 auto; padding: 7px 9px; font-size: .72rem; }
      .align-config-panel { margin: 0 8px 8px; padding: 9px; }
      .align-mode-tabs,
      .form-row { flex-direction: column; }
      .mode-tab-btn { width: 100%; }
      .alignment-results { width: 100%; min-width: 0; }
      .msa-section,
      .unaligned-section { margin-left: 0; margin-right: 0; }
      .msa-wrapper,
      .raw-table-wrapper { width: 100%; min-width: 0; border-radius: 0; border-left: 0; border-right: 0; }
      .msa-ids-column,
      .raw-ids-column { width: 58px; }
      .msa-id-header,
      .raw-id-header,
      .msa-id-row,
      .raw-id-row { padding-left: 7px; padding-right: 7px; }
      .desktop-label,
      .msa-id-tag,
      .raw-id-tag { display: none; }
      .mobile-label,
      .mobile-read-index,
      .mobile-reference-label { display: inline; }
      .mobile-read-index { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 28px; padding: 3px 5px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #2563eb; font: 800 .7rem/1 system-ui, sans-serif; }
      .mobile-reference-label { color: #2563eb; font: 800 .68rem/1 system-ui, sans-serif; }
      .raw-len-badge,
      .alignment-failure-badge { display: none; }
      .raw-seq-viewport,
      .msa-seq-viewport { min-width: 0; }
      .raw-seq-header,
      .msa-seq-header { padding-left: 8px; font-size: .68rem; }
      .raw-seq-row,
      .msa-seq-row { padding-left: 8px; padding-right: 8px; }
      .load-sentinel { padding: 0 8px; }
      .mobile-read-info { position: fixed; left: 12px; right: 12px; bottom: max(14px, env(safe-area-inset-bottom)); z-index: 1200; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 12px; padding: 15px 46px 15px 16px; border: 1px solid #93c5fd; border-radius: 12px; background: #fff; box-shadow: 0 14px 38px rgba(15,23,42,.24); }
      .mobile-read-info strong { grid-column: 1 / -1; overflow-wrap: anywhere; color: #0f172a; font: 700 .78rem/1.35 ui-monospace, monospace; }
      .mobile-read-info > span:last-child { color: #475569; font-size: .76rem; font-weight: 750; }
      .read-info-label { color: #2563eb; font-size: .64rem; font-weight: 850; letter-spacing: .08em; }
      .read-info-close { position: absolute; top: 8px; right: 9px; width: 30px; height: 30px; border: 0; border-radius: 50%; background: #f1f5f9; color: #64748b; font-size: 1.2rem; }
    }
  `]
})
export class FastqViewerComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() document!: FastqDocument;
  @ViewChild('msaViewport') msaViewportRef!: ElementRef;
  @ViewChild('loadSentinel') set loadSentinel(ref: ElementRef<HTMLElement> | undefined) {
    this.loadSentinelRef = ref;
    this.observeLoadSentinel();
  }

  processedReads: ProcessedRead[] = [];
  filteredReads: ProcessedRead[] = [];
  visibleReads: ProcessedRead[] = [];
  searchQuery = '';
  chunkSize = 10;
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
      this.requestMoreReads();
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
  alignmentReadOrder: 'aligned' | 'unaligned' = 'aligned';

  // Mouse drag scroll state
  isDragging = false;
  startX = 0;
  scrollLeft = 0;

  private currentDocId: string | null = null;
  selectedReadInfo: ProcessedRead | null = null;
  private loadSentinelRef?: ElementRef<HTMLElement>;
  private loadObserver?: IntersectionObserver;

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
        this.alignmentReadOrder = 'aligned';
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
    this.observeLoadSentinel();
  }

  ngOnDestroy() {
    this.loadObserver?.disconnect();
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
        alignmentFailureReason: res.alignmentFailureReason,
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

    // Exact pixel offset calculation for vertical cut-site red line
    const charWidth = 7.8;
    const paddingLeftPx = 10;
    const cutSiteColChar = maxPreFlankLen + (this.alignedCutSiteInWindow >= 0 ? this.alignedCutSiteInWindow : Math.floor(targetWin.length / 2));
    this.cutSiteGuideLeftPx = (cutSiteColChar * charWidth) + paddingLeftPx;

    const total = list.length;
    this.alignedStats = {
      total,
      alignedCount,
      unalignedCount: total - alignedCount,
      percentage: total > 0 ? (alignedCount / total) * 100 : 0
    };

    this.processedReads = list;
    this.sortProcessedReadsByAlignment();
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

  setAlignmentReadOrder(order: 'aligned' | 'unaligned') {
    if (this.alignmentReadOrder === order) return;
    this.alignmentReadOrder = order;
    this.sortProcessedReadsByAlignment();
    this.applyFilterAndPagination();
    if (order === 'aligned') this.centerCutSiteScroll();
  }

  private sortProcessedReadsByAlignment() {
    const alignedFirst = this.alignmentReadOrder === 'aligned';
    this.processedReads.sort((a, b) => {
      if (a.isAligned === b.isAligned) return 0;
      if (alignedFirst) return a.isAligned ? -1 : 1;
      return a.isAligned ? 1 : -1;
    });
  }

  private findAlignmentInRead(readSeq: string, targetWin: string, cutIdxInWin: number, sgrnaSeq?: string) {
    const [usable, failureReason, bestRes] = isReadUsable(readSeq, null, targetWin, 0, sgrnaSeq || '', cutIdxInWin);

    if (!usable || !bestRes) {
      return {
        isAligned: false,
        preWinSeq: readSeq,
        grid: [],
        postWinSeq: '',
        isRc: false,
        alignmentFailureReason: failureReason
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
      isRc,
      alignmentFailureReason: undefined
    };
  }

  alignmentFailureLabel(reason: string): string {
    switch (reason) {
      case 'no_anchor': return 'No anchor';
      case 'no_coverage': return 'Low coverage';
      case 'quality': return 'Low quality';
      default: return 'No alignment';
    }
  }

  alignmentFailureDetail(reason: string): string {
    switch (reason) {
      case 'no_anchor': return 'A candidate window was found, but the required anchor check did not pass.';
      case 'no_coverage': return 'The read does not cover enough of the requested reference window.';
      case 'quality': return 'Observed bases did not pass the configured quality threshold.';
      default: return 'No compatible alignment to the requested reference window was found.';
    }
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

  highlightSeq(seq: string): string {
    if (!seq) return '';
    const q = this.searchQuery ? this.searchQuery.trim() : '';
    if (!q) return seq;

    const regex = buildMotifRegex(q);
    if (!regex) return seq;

    return seq.replace(regex, match => `<mark class="search-hi">${match}</mark>`);
  }

  searchReads() {
    this.applyFilterAndPagination();
  }

  clearSearch() {
    this.searchQuery = '';
    this.applyFilterAndPagination();
  }

  showReadInfo(read: ProcessedRead) {
    this.selectedReadInfo = read;
  }

  private applyFilterAndPagination() {
    const q = this.searchQuery ? this.searchQuery.trim().toLowerCase() : '';
    if (!q) {
      this.filteredReads = [...this.processedReads];
    } else {
      const regex = buildMotifRegex(q);
      this.filteredReads = this.processedReads.filter(r => {
        const matchId = r.id ? r.id.toLowerCase().includes(q) : false;
        const matchCat = r.category ? r.category.toLowerCase().includes(q) : false;

        let matchSeq = false;
        if (regex) {
          regex.lastIndex = 0;
          matchSeq = r.seq ? regex.test(r.seq) : false;
          if (!matchSeq && r.preWinSeq) {
            regex.lastIndex = 0;
            matchSeq = regex.test(r.preWinSeq);
          }
          if (!matchSeq && r.postWinSeq) {
            regex.lastIndex = 0;
            matchSeq = regex.test(r.postWinSeq);
          }
        } else {
          matchSeq = r.seq ? r.seq.toLowerCase().includes(q) : false;
        }

        return matchId || matchSeq || matchCat;
      });
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

  private requestMoreReads() {
    if (this.isLoadingMore || !this.hasMore) return;
    this.isLoadingMore = true;
    window.setTimeout(() => {
      this.loadMore();
      this.isLoadingMore = false;
      this.observeLoadSentinel();
    }, 80);
  }

  private observeLoadSentinel() {
    this.loadObserver?.disconnect();
    const sentinel = this.loadSentinelRef?.nativeElement;
    if (!sentinel || !this.hasMore || typeof IntersectionObserver === 'undefined') return;
    const root = sentinel.closest('.fastq-viewer');
    this.loadObserver = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) this.requestMoreReads();
    }, { root, rootMargin: '240px 0px' });
    this.loadObserver.observe(sentinel);
  }
}
