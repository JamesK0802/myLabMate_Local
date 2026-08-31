import { Component, Input, OnChanges, ElementRef, OnDestroy, AfterViewInit, ChangeDetectorRef, HostListener, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SequenceDocument, SequenceFeature } from '../../models/sequence.model';
import { complement, reverseComplement } from '../../utils/biology.utils';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { FeatureEditorComponent } from './feature-editor.component';

interface SequenceRow {
  startPos: number;
  fwdSeq: string;
  revSeq: string;
  features: { feat: SequenceFeature, colStart: number, colEnd: number, level: number }[];
}

@Component({
  selector: 'app-sequence-view',
  standalone: true,
  imports: [CommonModule, FormsModule, FeatureEditorComponent],
  template: `
    <div class="seq-container">
      <div class="controls">
        <label><input type="checkbox" [(ngModel)]="showRevComp" (change)="buildRows()"> Show Reverse Complement</label>
        <span>Length: {{ document.sequence.length }} bp</span>
      </div>
      
      <div class="seq-body">
        <div *ngFor="let row of rows" class="seq-row">
          
          <div class="pos-label">{{ row.startPos + 1 }}</div>
          
          <div class="seq-content"
               (mousedown)="onMouseDown($event, row.startPos)" 
               (mousemove)="onMouseMove($event, row.startPos)"
               (contextmenu)="onContextMenu($event, row.startPos)">
               
            <!-- Unified Selection Box -->
            <div class="selection-box" *ngIf="hasSelection(row.startPos)"
                 [style.left.ch]="getSelStartOffset(row.startPos)"
                 [style.width.ch]="getSelWidth(row.startPos)"
                 [class.sel-start]="isSelStartInRow(row.startPos)"
                 [class.sel-end]="isSelEndInRow(row.startPos)">
            </div>

            <!-- Features (above sequence) -->
            <div class="feature-track" *ngIf="row.features.length > 0"
                 [style.height.px]="getTrackHeight(row.features)">
              <div class="feat-box" 
                   *ngFor="let fr of row.features"
                   [style.top.px]="fr.level * 16"
                   [style.left.ch]="fr.colStart"
                   [style.width.ch]="(fr.colEnd - fr.colStart)"
                   [style.background]="fr.feat.color || '#3498db'"
                   [title]="fr.feat.name"
                   (click)="onFeatureClick($event, fr.feat)"
                   (dblclick)="editFeature(fr.feat); $event.stopPropagation()">
                <span class="feat-label">{{ fr.feat.name }}</span>
              </div>
            </div>

            <!-- Forward Strand -->
            <div class="dna-strand fwd-strand">{{ row.fwdSeq }}</div>
            
            <!-- Reverse Strand -->
            <div class="dna-strand rev-strand" *ngIf="showRevComp">{{ row.revSeq }}</div>
          </div>
          
        </div>
      </div>

      <!-- Context Menu -->
      <div class="ctx-menu" *ngIf="ctxMenuVisible" [style.left.px]="ctxMenuX" [style.top.px]="ctxMenuY">
        <ng-container *ngIf="ctxMenuMode === 'sequence'">
          <div class="ctx-item" (click)="copySelection()">Copy (Ctrl+C)</div>
          <div class="ctx-item" (click)="deleteSelection()">Delete (Del)</div>
          <div class="ctx-item" (click)="addFeature()">Add Feature</div>
          <div class="ctx-separator"></div>
          <div class="ctx-item" (click)="undo()">Undo (Ctrl+Z)</div>
          <div class="ctx-item" (click)="redo()">Redo (Ctrl+Shift+Z)</div>
        </ng-container>
        
        <ng-container *ngIf="ctxMenuMode === 'feature'">
          <div class="ctx-header">{{ activeFeature?.name }}</div>
          <div class="ctx-item" (click)="triggerEditFeature()">Edit Feature</div>
          <div class="ctx-item" (click)="copyFeatureSeq()">Copy Sequence</div>
          <div class="ctx-separator"></div>
          <div class="ctx-item" style="color: #e74c3c" (click)="triggerDeleteFeature()">Delete Feature</div>
        </ng-container>
      </div>

      <!-- Feature Editor -->
      <app-feature-editor 
        *ngIf="showFeatureEditor" 
        [initialFeature]="editingFeature"
        (save)="onSaveFeature($event)"
        (delete)="onDeleteFeature($event)"
        (cancel)="closeFeatureEditor()">
      </app-feature-editor>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .seq-container { font-family: 'Courier New', Courier, 'SFMono-Regular', Consolas, monospace !important; display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .controls { padding: 8px 0; border-bottom: 1px solid var(--color-border); margin-bottom: 16px; font-family: sans-serif; font-size: 0.85rem; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; }
    .controls label { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .controls label input { margin: 0; flex: 0 0 auto; }
    .controls > span { white-space: nowrap; }
    .seq-body { flex: 1; overflow-y: auto; white-space: pre; position: relative; }
    .seq-row { display: flex; margin-bottom: 24px; font-size: 14px; line-height: 1.2; }
    .pos-label { flex: 0 0 60px; width: 60px; color: #95a5a6; text-align: right; margin-right: 16px; padding-top: 14px; user-select: none; font-family: 'Courier New', Courier, 'SFMono-Regular', Consolas, monospace !important; }
    .seq-content { position: relative; display: flex; flex-direction: column; }
    .feature-track { position: relative; height: 14px; margin-bottom: 2px; }
    .feat-box {
      position: absolute; height: 12px; border-radius: 2px; opacity: 0.8; 
      display: flex; align-items: center; justify-content: center; overflow: hidden;
      cursor: pointer; transition: opacity 0.15s, filter 0.15s, transform 0.1s;
    }
    .feat-box:hover {
      opacity: 1; filter: brightness(1.1); box-shadow: 0 1px 3px rgba(0,0,0,0.4); transform: scaleY(1.1); z-index: 10;
    }
    .feat-label { font-size: 9px; color: white; font-family: sans-serif; font-weight: bold; padding: 0 4px; }
    .dna-strand { letter-spacing: 0; font-family: 'Courier New', Courier, 'SFMono-Regular', Consolas, monospace !important; cursor: text; user-select: none; position: relative; z-index: 1; }
    .fwd-strand { color: #2c3e50; }
    .rev-strand { color: #7f8c8d; }
    
    .selection-box {
      position: absolute;
      top: 0;
      bottom: 0;
      background-color: rgba(149, 165, 166, 0.25);
      pointer-events: none;
      z-index: 0;
      border-radius: 1px;
    }
    .selection-box.sel-start { border-left: 2px solid #34495e; }
    .selection-box.sel-end { border-right: 2px solid #34495e; }
    
    .ctx-menu {
      position: fixed;
      background: white;
      border: 1px solid #cbd5e0;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      border-radius: 4px;
      padding: 4px 0;
      z-index: 1000;
      min-width: 150px;
    }
    .ctx-item {
      padding: 8px 16px;
      font-size: 13px;
      cursor: pointer;
      color: #2d3748;
    }
    .ctx-item:hover {
      background: #f7fafc;
    }
    .ctx-header {
      padding: 6px 16px;
      font-size: 11px;
      font-weight: bold;
      color: #7f8c8d;
      text-transform: uppercase;
      background: #f8f9fa;
      border-bottom: 1px solid #e2e8f0;
      margin-top: -4px;
      margin-bottom: 4px;
      border-radius: 4px 4px 0 0;
    }
    .ctx-separator {
      height: 1px;
      background: #e2e8f0;
      margin: 4px 0;
    }
  `]
})
export class SequenceViewComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() document!: SequenceDocument;
  
  showRevComp = true;
  rows: SequenceRow[] = [];
  basesPerLine = 80;
  private resizeObserver!: ResizeObserver;
  private sub: Subscription | null = null;

  isDragging = false;
  selStart = -1;
  selEnd = -1;

  ctxMenuVisible = false;
  ctxMenuMode: 'sequence' | 'feature' = 'sequence';
  ctxMenuX = 0;
  ctxMenuY = 0;

  activeFeature: SequenceFeature | null = null;
  showFeatureEditor = false;
  editingFeature: SequenceFeature | null = null;

  constructor(
    private el: ElementRef, 
    private cdr: ChangeDetectorRef,
    private workspace: SequenceWorkspaceService
  ) {}

  ngOnInit() {
    this.sub = this.workspace.selectedRegion$.subscribe(region => {
      if (this.isDragging) return; // Ignore updates while actively dragging

      if (region) {
        if (this.selStart !== region.start || this.selEnd !== region.end) {
          this.selStart = region.start;
          this.selEnd = region.end;
          this.cdr.detectChanges();
          this.scrollToSelection();
        }
      } else {
        if (this.selStart !== -1) {
          this.selStart = -1;
          this.selEnd = -1;
          this.cdr.detectChanges();
        }
      }
    });
  }

  ngAfterViewInit() {
    const container = this.el.nativeElement.querySelector('.seq-body');
    if (!container) return;
    
    this.resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0) {
          this.calculateBasesPerLine(entry.contentRect.width);
        }
      }
    });
    this.resizeObserver.observe(container);
  }

  ngOnDestroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.sub) {
      this.sub.unsubscribe();
    }
  }

  calculateBasesPerLine(containerWidth: number) {
    // Estimated character width for 14px monospace is ~8.4px
    // Label takes ~60px, margin 16px, plus padding/scrollbars ~24px = ~100px total subtracted
    const charWidth = 8.4;
    const availableWidth = containerWidth - 100;
    
    let newBases = Math.floor(availableWidth / charWidth);
    if (newBases < 30) newBases = 30;
    if (newBases > 150) newBases = 150;
    
    // Round down to nearest 10 for a cleaner look
    newBases = Math.floor(newBases / 10) * 10;
    
    if (this.basesPerLine !== newBases) {
      this.basesPerLine = newBases;
      this.buildRows();
      this.cdr.detectChanges();
    }
  }

  ngOnChanges() {
    this.buildRows();
  }

  buildRows() {
    this.rows = [];
    if (!this.document || !this.document.sequence) return;

    const seq = this.document.sequence;
    const len = seq.length;

    for (let i = 0; i < len; i += this.basesPerLine) {
      const chunkFwd = seq.substring(i, Math.min(i + this.basesPerLine, len));
      const chunkRev = this.showRevComp ? complement(chunkFwd) : '';
      
      let rowFeatures = this.document.features
        .filter(f => f.start < i + this.basesPerLine && f.end > i)
        .sort((a, b) => a.start - b.start)
        .map(f => {
          const startInRow = Math.max(0, f.start - i);
          const endInRow = Math.min(this.basesPerLine, f.end - i);
          return { feat: f, colStart: startInRow, colEnd: endInRow, level: 0 };
        });

      // Calculate stacking levels to prevent overlap
      for (let j = 0; j < rowFeatures.length; j++) {
        let level = 0;
        let overlap = true;
        while (overlap) {
          overlap = false;
          for (let k = 0; k < j; k++) {
            if (rowFeatures[k].level === level && 
                rowFeatures[k].colStart < rowFeatures[j].colEnd && 
                rowFeatures[k].colEnd > rowFeatures[j].colStart) {
              overlap = true;
              level++;
              break;
            }
          }
        }
        rowFeatures[j].level = level;
      }

      this.rows.push({
        startPos: i,
        fwdSeq: chunkFwd,
        revSeq: chunkRev,
        features: rowFeatures
      });
    }
  }

  scrollToSelection() {
    if (this.selStart === -1) return;
    const container = this.el.nativeElement.querySelector('.seq-body');
    if (!container) return;
    
    // Find the row containing the start of the selection
    const s = Math.min(this.selStart, this.selEnd);
    const rowIndex = Math.floor(s / this.basesPerLine);
    const rows = container.querySelectorAll('.seq-row');
    if (rowIndex >= 0 && rowIndex < rows.length) {
      const rowEl = rows[rowIndex] as HTMLElement;
      // Check if it's currently visible
      const containerRect = container.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      
      if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  getTrackHeight(features: {level: number}[]): number {
    if (!features || features.length === 0) return 0;
    const maxLevel = Math.max(...features.map(f => f.level));
    return (maxLevel + 1) * 16;
  }

  // Selection Logic
  getCharIndex(event: MouseEvent): number {
    const target = event.target as HTMLElement;
    const rowEl = target.closest('.seq-content');
    if (!rowEl) return -1;
    const strandEl = rowEl.querySelector('.dna-strand');
    if (!strandEl) return -1;
    const rect = strandEl.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const charWidth = 8.4;
    return Math.floor(offsetX / charWidth);
  }

  onMouseDown(event: MouseEvent, rowStartPos: number) {
    if (event.button !== 0) return; // Only left click
    const idx = this.getCharIndex(event);
    if (idx >= 0) {
      this.isDragging = true;
      this.selStart = rowStartPos + idx;
      this.selEnd = this.selStart;
      this.workspace.clearRegion();
      this.cdr.detectChanges();
    }
  }

  onMouseMove(event: MouseEvent, rowStartPos: number) {
    if (this.isDragging) {
      const idx = this.getCharIndex(event);
      if (idx >= 0) {
        // Clamp to string length
        const maxIdx = Math.min(idx, this.document.sequence.length - rowStartPos);
        this.selEnd = rowStartPos + maxIdx;
        this.cdr.detectChanges();
      }
    }
  }

  @HostListener('window:mouseup')
  onMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      if (this.selStart !== -1 && this.selEnd !== -1 && this.selStart !== this.selEnd) {
        const s = Math.min(this.selStart, this.selEnd);
        const e = Math.max(this.selStart, this.selEnd);
        this.workspace.selectRegion(s, e);
      } else {
        this.selStart = -1;
        this.selEnd = -1;
        this.workspace.clearRegion();
      }
      this.cdr.detectChanges();
    }
  }

  @HostListener('window:click')
  closeContextMenu() {
    if (this.ctxMenuVisible) {
      this.ctxMenuVisible = false;
      this.cdr.detectChanges();
    }
  }

  onContextMenu(event: MouseEvent, rowStartPos: number) {
    event.preventDefault();
    this.ctxMenuMode = 'sequence';
    if (this.selStart === -1) {
      const idx = this.getCharIndex(event);
      if (idx >= 0) {
        this.selStart = rowStartPos + idx;
        this.selEnd = rowStartPos + idx + 1;
        this.workspace.selectRegion(this.selStart, this.selEnd);
      }
    }
    this.ctxMenuX = event.clientX;
    this.ctxMenuY = event.clientY;
    this.ctxMenuVisible = true;
    this.cdr.detectChanges();
  }

  onFeatureClick(event: MouseEvent, feat: SequenceFeature) {
    event.stopPropagation();
    this.activeFeature = feat;
    this.ctxMenuMode = 'feature';
    this.ctxMenuX = event.clientX;
    this.ctxMenuY = event.clientY;
    this.ctxMenuVisible = true;
    this.cdr.detectChanges();
  }

  // Keyboard Shortcuts
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    // Delete
    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.deleteSelection();
    }
    
    // Ctrl/Cmd + C
    if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
      this.copySelection();
    }
    
    // Ctrl/Cmd + Z
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
      if (event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
    }
  }

  copySelection() {
    if (this.selStart !== -1 && this.selEnd !== -1) {
      const s = Math.min(this.selStart, this.selEnd);
      const e = Math.max(this.selStart, this.selEnd);
      const selectedText = this.document.sequence.substring(s, e);
      navigator.clipboard.writeText(selectedText);
    }
  }

  deleteSelection() {
    if (this.selStart !== -1 && this.selEnd !== -1) {
      const s = Math.min(this.selStart, this.selEnd);
      const e = Math.max(this.selStart, this.selEnd);
      this.workspace.deleteBases(this.document.id!, s, e - s);
      this.selStart = -1;
      this.selEnd = -1;
      this.workspace.clearRegion();
      this.cdr.detectChanges();
    }
  }

  undo() {
    this.workspace.undo(this.document.id!);
  }

  redo() {
    this.workspace.redo(this.document.id!);
  }

  addFeature() {
    let s = 0;
    let e = 1;
    if (this.selStart !== -1 && this.selEnd !== -1) {
      s = Math.min(this.selStart, this.selEnd);
      e = Math.max(this.selStart, this.selEnd);
    }
    this.editingFeature = {
      id: Math.random().toString(36).substring(2, 9),
      name: 'New Feature',
      type: 'misc_feature',
      start: s,
      end: e,
      strand: 1,
      color: '#95a5a6'
    };
    this.showFeatureEditor = true;
    this.ctxMenuVisible = false;
  }

  editFeature(feat: SequenceFeature) {
    this.editingFeature = { ...feat };
    this.showFeatureEditor = true;
  }

  onSaveFeature(feat: SequenceFeature) {
    this.workspace.updateFeature(this.document.id!, feat);
    this.closeFeatureEditor();
  }

  onDeleteFeature(featId: string) {
    this.workspace.deleteFeature(this.document.id!, featId);
    this.closeFeatureEditor();
  }

  closeFeatureEditor() {
    this.showFeatureEditor = false;
    this.editingFeature = null;
  }

  // Feature Context Menu Handlers
  triggerEditFeature() {
    if (this.activeFeature) {
      this.editFeature(this.activeFeature);
    }
    this.ctxMenuVisible = false;
  }

  triggerDeleteFeature() {
    if (this.activeFeature) {
      this.workspace.deleteFeature(this.document.id!, this.activeFeature.id);
    }
    this.ctxMenuVisible = false;
  }

  copyFeatureSeq() {
    if (this.activeFeature) {
      const s = Math.min(this.activeFeature.start, this.activeFeature.end);
      const e = Math.max(this.activeFeature.start, this.activeFeature.end);
      let seq = this.document.sequence.substring(s, e);
      if (this.activeFeature.strand === -1) {
        seq = reverseComplement(seq);
      }
      navigator.clipboard.writeText(seq);
    }
    this.ctxMenuVisible = false;
  }

  hasSelection(rowStartPos: number): boolean {
    if (this.selStart === -1 || this.selEnd === -1) return false;
    const s = Math.min(this.selStart, this.selEnd);
    const e = Math.max(this.selStart, this.selEnd);
    if (s === e) {
      // Cursor only
      return s >= rowStartPos && s < rowStartPos + this.basesPerLine;
    }
    return (s < rowStartPos + this.basesPerLine && e > rowStartPos);
  }

  getSelStartOffset(rowStartPos: number): number {
    const s = Math.min(this.selStart, this.selEnd);
    return Math.max(0, s - rowStartPos);
  }

  getSelWidth(rowStartPos: number): number {
    const s = Math.min(this.selStart, this.selEnd);
    const e = Math.max(this.selStart, this.selEnd);
    const startIdx = Math.max(0, s - rowStartPos);
    const endIdx = Math.min(this.basesPerLine, e - rowStartPos);
    return Math.max(0, endIdx - startIdx);
  }

  isSelStartInRow(rowStartPos: number): boolean {
    if (this.selStart === -1 || this.selEnd === -1) return false;
    const s = Math.min(this.selStart, this.selEnd);
    return s >= rowStartPos && s < rowStartPos + this.basesPerLine;
  }

  isSelEndInRow(rowStartPos: number): boolean {
    if (this.selStart === -1 || this.selEnd === -1) return false;
    const s = Math.min(this.selStart, this.selEnd);
    const e = Math.max(this.selStart, this.selEnd);
    if (s === e) return false; // Show only one side for cursor
    return e > rowStartPos && e <= rowStartPos + this.basesPerLine;
  }
}
