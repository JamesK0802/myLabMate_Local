import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';

@Component({
  selector: 'app-project-explorer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="explorer-header">
      <label class="btn-import-primary" title="Import Files">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        IMPORT
        <input type="file" multiple accept=".fasta,.fa,.gb,.gbk,.txt,.fastq,.fq,.fastq.gz,.fq.gz" (change)="onFileSelected($event)" style="display:none">
      </label>

      <button type="button" class="btn-collapse" (click)="collapse.emit()" title="Collapse Explorer Panel">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
    </div>
    
    <div class="item-list">
      <div 
        *ngFor="let item of workspace.items$ | async" 
        class="item-row"
        [class.selected]="(workspace.selectedItemId$ | async) === item.id"
        (click)="workspace.selectItem(item.id)">
        <div class="item-icon">
          <!-- Sequence Icon -->
          <svg *ngIf="item.type === 'sequence'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          <!-- FASTQ Icon -->
          <svg *ngIf="item.type === 'fastq'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
            <line x1="15" y1="3" x2="15" y2="21"></line>
          </svg>
        </div>
        <div class="item-details">
          <div class="item-name" [title]="item.name" (dblclick)="renameItem(item, $event)">{{ item.name }}</div>
          <div class="item-meta" *ngIf="item.type === 'sequence'">{{ item.sequence.length }} bp</div>
          <div class="item-meta" *ngIf="item.type === 'fastq'">{{ item.stats.readCount | number }} reads</div>
        </div>
        <div class="item-actions">
          <button class="icon-btn rename-btn" (click)="renameItem(item, $event)" title="Rename file" aria-label="Rename file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn download-btn" (click)="workspace.downloadItem(item); $event.stopPropagation()" title="Download file" aria-label="Download file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
          </button>
          <button class="icon-btn delete-btn" (click)="deleteItem(item.id, $event)" title="Delete" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 6-12 12M6 6l12 12"/></svg>
          </button>
        </div>
      </div>
      
      <div *ngIf="(workspace.items$ | async)?.length === 0" class="empty-state">
        No items imported.<br>Click "IMPORT" above to add files.
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; }
    .explorer-header {
      height: 38px;
      padding: 0 10px;
      border-bottom: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      box-sizing: border-box;
    }
    .btn-import-primary {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #2563eb;
      color: #ffffff;
      padding: 5px 12px;
      border-radius: 5px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.5px;
      transition: background 0.2s;
      box-shadow: 0 1px 2px rgba(0,0,0,0.05);
    }
    .btn-import-primary:hover {
      background: #1d4ed8;
    }
    .btn-collapse {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      background: transparent;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      color: #64748b;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-collapse:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    .item-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }
    .item-row {
      display: flex;
      align-items: center;
      padding: 8px 10px;
      cursor: pointer;
      border-bottom: 1px solid #f1f5f9;
    }
    .item-row:hover { background: #f8fafc; }
    .item-row.selected { background: #eff6ff; }
    .item-icon { margin-right: 8px; color: #64748b; display: flex; align-items: center; }
    .item-details { flex: 1; overflow: hidden; }
    .item-name { font-size: 0.83rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #1e293b; }
    .item-meta { font-size: 0.73rem; color: #64748b; }
    .item-actions { display: flex; opacity: 0; transition: opacity 0.2s; }
    .item-row:hover .item-actions { opacity: 1; }
    .icon-btn { 
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; background: none; border: none; cursor: pointer; padding: 4px;
      color: #94a3b8; border-radius: 4px; margin-left: 2px;
    }
    .icon-btn svg { width: 16px; height: 16px; }
    .icon-btn:hover { background: #e2e8f0; color: #1e293b; }
    .delete-btn:hover { color: #dc2626; background: #fee2e2; }
    .download-btn:hover { color: #2563eb; background: #dbeafe; }
    .rename-btn:hover { color: #7c3aed; background: #ede9fe; }
    
    .empty-state { padding: 16px; text-align: center; color: #64748b; font-size: 0.78rem; line-height: 1.4; }
  `]
})
export class ProjectExplorerComponent {
  @Output() collapse = new EventEmitter<void>();

  constructor(public workspace: SequenceWorkspaceService) {}

  async onFileSelected(event: any) {
    const files: FileList = event.target.files;
    for (let i = 0; i < files.length; i++) {
      await this.workspace.importFile(files[i]);
    }
    event.target.value = ''; // Reset
  }

  deleteItem(id: string, event: Event) {
    event.stopPropagation();
    this.workspace.deleteItem(id);
  }

  async renameItem(item: any, event: Event) {
    event.stopPropagation();
    const name = prompt('Rename file:', item.name);
    if (name !== null) await this.workspace.renameItem(item, name);
  }
}
