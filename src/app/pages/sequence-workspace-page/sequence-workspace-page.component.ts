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
      <!-- Collapsible Explorer Left Sidebar -->
      <div class="panel explorer-panel" *ngIf="!isSidebarCollapsed">
        <app-project-explorer (collapse)="toggleSidebar()"></app-project-explorer>
      </div>

      <!-- Expand Floating Button when Collapsed -->
      <button type="button" class="btn-expand-sidebar" *ngIf="isSidebarCollapsed" (click)="toggleSidebar()" title="Expand Project Explorer">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>

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
      position: relative;
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
    .btn-expand-sidebar {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 10;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      color: #334155;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: all 0.2s ease;
    }
    .btn-expand-sidebar:hover {
      background: #f1f5f9;
      color: #2563eb;
      border-color: #93c5fd;
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
  isSidebarCollapsed = false;

  constructor(public workspace: SequenceWorkspaceService) {}

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }
}
