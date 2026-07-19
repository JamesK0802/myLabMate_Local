import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { ProjectItem, SequenceDocument } from '../../models/sequence.model';
import { getGCContent } from '../../utils/biology.utils';
import { SearchPanelComponent } from './search-panel.component';

@Component({
  selector: 'app-item-inspector',
  standalone: true,
  imports: [CommonModule, SearchPanelComponent],
  template: `
    <div class="inspector-header">
      <div class="inspector-tabs">
        <button class="tab-btn" [class.active]="activeTab === 'properties'" (click)="activeTab = 'properties'">Properties</button>
        <button class="tab-btn" [class.active]="activeTab === 'search'" (click)="activeTab = 'search'">Search</button>
      </div>
    </div>
    
    <div class="inspector-body" *ngIf="workspace.selectedItemId$ | async as id; else noSelection">
      
      <div class="tab-content" [class.visible]="activeTab === 'properties'">
        <ng-container *ngIf="getSelectedItem() as item">
        
        <div class="prop-group">
          <label>Name</label>
          <input type="text" [value]="item.name" (change)="updateName(item, $event)" class="prop-input">
        </div>
        
        <div class="prop-group">
          <label>Description</label>
          <textarea [value]="item.description || ''" (change)="updateDescription(item, $event)" class="prop-input" rows="3"></textarea>
        </div>

        <ng-container *ngIf="item.type === 'sequence'">
          <div class="prop-group">
            <label>Properties</label>
            <div class="stat-row"><span>Length:</span> <span>{{ item.sequence.length }} bp</span></div>
            <div class="stat-row"><span>Topology:</span> <span>{{ item.topology }}</span></div>
            <div class="stat-row"><span>GC Content:</span> <span>{{ getGC(item.sequence) | number:'1.1-1' }}%</span></div>
          </div>
          
          <div class="prop-group">
            <label>Features ({{ item.features.length }})</label>
            <div class="feature-list">
              <div *ngFor="let feat of item.features" class="feat-row">
                <span class="feat-color" [style.background]="feat.color || '#95a5a6'"></span>
                <span class="feat-name" [title]="feat.name">{{ feat.name }}</span>
                <span class="feat-loc">{{ feat.start + 1 }}..{{ feat.end }}</span>
              </div>
            </div>
          </div>
        </ng-container>
        </ng-container>
      </div>

      <div class="tab-content search-tab-content" [class.visible]="activeTab === 'search'">
        <app-search-panel></app-search-panel>
      </div>
    </div>
    
    <ng-template #noSelection>
      <div class="empty-state">Select an item to view properties.</div>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; }
    .inspector-header {
      border-bottom: 1px solid var(--color-border);
      background: #fdfdfd;
    }
    .inspector-tabs {
      display: flex; padding: 0 8px;
    }
    .tab-btn {
      background: none; border: none; padding: 10px 12px; cursor: pointer; font-size: 0.85rem; font-weight: 500;
      color: #7f8c8d; border-bottom: 2px solid transparent; transition: 0.2s;
    }
    .tab-btn:hover { color: #34495e; }
    .tab-btn.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }
    
    .inspector-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; position: relative; }
    .tab-content { display: none; padding: 16px; }
    .tab-content.visible { display: block; }
    .search-tab-content { padding: 0; display: none; height: 100%; }
    .search-tab-content.visible { display: flex; flex-direction: column; }
    .prop-group { margin-bottom: 20px; }
    .prop-group label {
      display: block; font-size: 0.75rem; font-weight: 600; color: #7f8c8d; text-transform: uppercase; margin-bottom: 8px;
    }
    .prop-input {
      width: 100%; padding: 6px; border: 1px solid var(--color-border); border-radius: 4px; font-size: 0.85rem; font-family: inherit;
    }
    .stat-row { display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px; color: #34495e; }
    .feature-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: 4px; }
    .feat-row {
      display: flex; align-items: center; padding: 4px 8px; font-size: 0.8rem; border-bottom: 1px solid #f1f2f6;
    }
    .feat-row:last-child { border-bottom: none; }
    .feat-color { width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
    .feat-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-right: 8px; }
    .feat-loc { color: #7f8c8d; font-family: monospace; }
    .empty-state { padding: 24px; text-align: center; color: #7f8c8d; font-size: 0.85rem; }
  `]
})
export class ItemInspectorComponent {
  activeTab = 'properties';

  constructor(public workspace: SequenceWorkspaceService) {}

  getSelectedItem(): ProjectItem | null {
    return this.workspace.getSelectedItem();
  }

  getGC(seq: string): number {
    return getGCContent(seq);
  }

  updateName(item: ProjectItem, event: any) {
    item.name = event.target.value;
    this.workspace.saveItem(item);
  }

  updateDescription(item: ProjectItem, event: any) {
    item.description = event.target.value;
    this.workspace.saveItem(item);
  }
}
