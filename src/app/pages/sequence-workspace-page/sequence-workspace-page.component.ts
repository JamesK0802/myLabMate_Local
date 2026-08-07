import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectExplorerComponent } from '../../components/sequence-workspace/project-explorer.component';
import { MainViewerComponent } from '../../components/sequence-workspace/main-viewer.component';
import { ItemInspectorComponent } from '../../components/sequence-workspace/item-inspector.component';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';

@Component({
  selector: 'app-sequence-workspace-page',
  standalone: true,
  imports: [
    CommonModule, 
    ProjectExplorerComponent, 
    MainViewerComponent, 
    ItemInspectorComponent
  ],
  template: `
    <div class="workspace-container">
      <div class="panel explorer-panel">
        <app-project-explorer></app-project-explorer>
      </div>
      <div class="panel viewer-panel">
        <app-main-viewer></app-main-viewer>
      </div>
      <div class="panel inspector-panel" *ngIf="(workspace.selectedItem$ | async)?.type !== 'fastq'">
        <app-item-inspector></app-item-inspector>
      </div>
    </div>
  `,
  styles: [`
    .workspace-container {
      display: flex;
      flex-direction: row;
      height: calc(100vh - 56px);
      width: 100%;
      background: var(--color-background);
      overflow: hidden;
    }
    .panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    app-project-explorer, app-main-viewer, app-item-inspector {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .explorer-panel {
      flex: 0 0 250px;
      border-right: 1px solid var(--color-border);
      background: var(--color-surface);
    }
    .viewer-panel {
      flex: 1;
      background: #ffffff;
      min-width: 0;
    }
    .inspector-panel {
      flex: 0 0 300px;
      border-left: 1px solid var(--color-border);
      background: var(--color-surface);
    }
  `]
})
export class SequenceWorkspacePageComponent {
  constructor(public workspace: SequenceWorkspaceService) {}
}
