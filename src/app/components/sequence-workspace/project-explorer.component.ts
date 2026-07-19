import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { ProjectItem } from '../../models/sequence.model';

@Component({
  selector: 'app-project-explorer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="explorer-header">
      <h3>Project Items</h3>
      <div class="actions">
        <button class="btn-action" (click)="workspace.openLocalDirectory()" title="Open Local Folder">📂 Folder</button>
        <label class="btn-import" title="Import Files">
          Import
          <input type="file" multiple accept=".fasta,.fa,.gb,.gbk,.txt,.fastq,.fq,.fastq.gz,.fq.gz" (change)="onFileSelected($event)" style="display:none">
        </label>
        <button class="btn-clear" (click)="workspace.clearWorkspace()">Clear</button>
      </div>
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
          <div class="item-name" [title]="item.name">{{ item.name }}</div>
          <div class="item-meta" *ngIf="item.type === 'sequence'">{{ item.sequence.length }} bp</div>
          <div class="item-meta" *ngIf="item.type === 'fastq'">{{ item.stats.readCount | number }} reads</div>
        </div>
        <div class="item-actions">
          <button *ngIf="item.type === 'sequence'" class="icon-btn save-btn" (click)="workspace.saveToDisk(item); $event.stopPropagation()" title="Save to disk">💾</button>
          <button class="icon-btn delete-btn" (click)="deleteItem(item.id, $event)" title="Delete">✕</button>
        </div>
      </div>
      
      <div *ngIf="(workspace.items$ | async)?.length === 0" class="empty-state">
        No sequences imported.<br>Use "Import" to add FASTA, GenBank, or raw text.
      </div>
    </div>
  `,
  styles: [`
    .explorer-header {
      padding: 12px;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .explorer-header h3 { margin: 0; font-size: 0.9rem; color: #34495e; }
    .actions { display: flex; gap: 4px; flex-wrap: wrap; }
    .btn-import, .btn-clear, .btn-action {
      background: #f1f2f6; border: 1px solid var(--color-border); padding: 4px 8px; border-radius: 4px;
      font-size: 0.75rem; cursor: pointer; color: #2c3e50; transition: 0.2s;
    }
    .btn-import:hover, .btn-action:hover { background: #e0e6ed; }
    .item-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .item-row {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      border-bottom: 1px solid #f1f2f6;
    }
    .item-row:hover { background: #f8f9fa; }
    .item-row.selected { background: #e8f4fd; }
    .item-icon { margin-right: 8px; color: #7f8c8d; }
    .item-details { flex: 1; overflow: hidden; }
    .item-name { font-size: 0.85rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .item-meta { font-size: 0.75rem; color: #95a5a6; }
    .item-actions { display: flex; opacity: 0; transition: opacity 0.2s; }
    .item-row:hover .item-actions { opacity: 1; }
    .icon-btn { 
      background: none; border: none; font-size: 1rem; cursor: pointer; padding: 4px;
      color: #bdc3c7; border-radius: 4px; margin-left: 2px;
    }
    .icon-btn:hover { background: #ecf0f1; color: #34495e; }
    .delete-btn:hover { color: #e74c3c; background: #fadbd8; }
    .save-btn:hover { color: #27ae60; background: #d5f5e3; }
    
    .empty-state { padding: 16px; text-align: center; color: #7f8c8d; font-size: 0.8rem; }
  `]
})
export class ProjectExplorerComponent {
  constructor(public workspace: SequenceWorkspaceService) {}

  onFileSelected(event: any) {
    const files: FileList = event.target.files;
    for (let i = 0; i < files.length; i++) {
      this.workspace.importFile(files[i]);
    }
    event.target.value = ''; // Reset
  }

  deleteItem(id: string, event: Event) {
    event.stopPropagation();
    this.workspace.deleteItem(id);
  }
}
