import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { SequenceViewComponent } from './sequence-view.component';
import { PlasmidMapComponent } from './plasmid-map.component';
import { LinearMapComponent } from './linear-map.component';
import { FastqViewerComponent } from './fastq-viewer.component';

@Component({
  selector: 'app-main-viewer',
  standalone: true,
  imports: [CommonModule, SequenceViewComponent, PlasmidMapComponent, LinearMapComponent, FastqViewerComponent],
  template: `
    <div class="viewer-container" *ngIf="workspace.selectedItem$ | async as item; else noSelection">
        
        <!-- Compact 1-line Header Bar -->
        <div class="compact-doc-header">
          <div class="doc-title-group">
            <span class="doc-name" [title]="item.name">{{ item.name }}</span>
            <span class="doc-badge fastq-badge" *ngIf="item.type === 'fastq'">FASTQ</span>
            <span class="doc-badge seq-badge" *ngIf="item.type === 'sequence'">SEQ</span>
            <span class="doc-meta-text" *ngIf="item.type === 'fastq'">{{ item.stats.readCount | number }} reads</span>
            <span class="doc-meta-text" *ngIf="item.type === 'sequence'">{{ item.topology }} • {{ item.sequence.length }} bp</span>
          </div>

          <div class="viewer-tabs" *ngIf="item.type === 'sequence'">
            <button class="tab-btn" [class.active]="activeTab === 'sequence'" (click)="activeTab = 'sequence'">Sequence</button>
            <button class="tab-btn" [class.active]="activeTab === 'map'" (click)="activeTab = 'map'">Map</button>
            <button class="tab-btn" [class.active]="activeTab === 'features'" (click)="activeTab = 'features'">Features</button>
            <button class="tab-btn" [class.active]="activeTab === 'restriction'" (click)="activeTab = 'restriction'">Restriction Sites</button>
          </div>
        </div>

        <div class="viewer-content">
          <ng-container *ngIf="item.type === 'sequence'">
            <div *ngIf="activeTab === 'sequence'" class="tab-pane">
              <app-sequence-view [document]="item"></app-sequence-view>
            </div>
            
            <div *ngIf="activeTab === 'map'" class="tab-pane map-pane">
              <app-plasmid-map *ngIf="item.topology === 'circular'" [document]="item"></app-plasmid-map>
              <app-linear-map *ngIf="item.topology === 'linear'" [document]="item"></app-linear-map>
            </div>

            <div *ngIf="activeTab === 'features'" class="tab-pane feature-pane">
              <table class="feature-table">
                <thead><tr><th>Name</th><th>Type</th><th>Start</th><th>End</th><th>Strand</th></tr></thead>
                <tbody>
                  <tr *ngFor="let f of item.features">
                    <td>
                      <div class="color-box" [style.background]="f.color || '#ccc'"></div>
                      {{ f.name }}
                    </td>
                    <td>{{ f.type }}</td>
                    <td>{{ f.start + 1 }}</td>
                    <td>{{ f.end }}</td>
                    <td>{{ f.strand === 1 ? '+' : '-' }}</td>
                  </tr>
                  <tr *ngIf="item.features.length === 0">
                    <td colspan="5" style="text-align: center; color: #7f8c8d;">No features</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div *ngIf="activeTab === 'restriction'" class="tab-pane restriction-pane">
              <p style="color: #7f8c8d;">Restriction enzyme analysis will be displayed here.</p>
            </div>
          </ng-container>

          <ng-container *ngIf="item.type === 'fastq'">
            <div class="tab-pane active" style="padding:0">
              <app-fastq-viewer [document]="item"></app-fastq-viewer>
            </div>
          </ng-container>
        </div>
    </div>

    <ng-template #noSelection>
      <div class="empty-state">
        <h2>No Item Selected</h2>
        <p>Select a sequence from the project explorer to view it here.</p>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; width: 100%; }
    .viewer-container { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    
    .compact-doc-header {
      height: 38px;
      padding: 0 14px;
      background: #ffffff;
      border-bottom: 1px solid #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .doc-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;
    }
    .doc-name {
      font-size: 0.92rem;
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .doc-badge {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .fastq-badge {
      background: #eff6ff;
      color: #2563eb;
      border: 1px solid #bfdbfe;
    }
    .seq-badge {
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bbf7d0;
    }
    .doc-meta-text {
      font-size: 0.8rem;
      color: #64748b;
      font-weight: 500;
      white-space: nowrap;
    }

    .viewer-tabs {
      display: flex; gap: 4px;
    }
    .tab-btn {
      background: none; border: none; padding: 6px 12px; cursor: pointer; font-size: 0.8rem; font-weight: 600;
      color: #64748b; border-bottom: 2px solid transparent; transition: 0.2s;
    }
    .tab-btn:hover { color: #1e293b; }
    .tab-btn.active { color: #2563eb; border-bottom-color: #2563eb; }
    
    .viewer-content { flex: 1; overflow: hidden; position: relative; display: flex; flex-direction: column; }
    .tab-pane { flex: 1; overflow: hidden; padding: 12px; display: flex; flex-direction: column; }
    .map-pane { display: flex; justify-content: center; align-items: center; background: #fafafa; }
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;
      color: #95a5a6; text-align: center;
    }
    .empty-state h2 { margin: 0 0 8px 0; font-weight: 500; }
    
    .feature-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .feature-table th, .feature-table td { padding: 8px 12px; border-bottom: 1px solid var(--color-border); text-align: left; }
    .feature-table th { background: #f8f9fa; font-weight: 600; color: #34495e; }
    .color-box { display: inline-block; width: 12px; height: 12px; border-radius: 2px; margin-right: 8px; vertical-align: middle; }
  `]
})
export class MainViewerComponent {
  activeTab = 'sequence';
  constructor(public workspace: SequenceWorkspaceService) {}
}
