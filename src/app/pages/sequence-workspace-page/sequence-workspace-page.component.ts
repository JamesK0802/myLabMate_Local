import { Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { ProjectExplorerComponent } from '../../components/sequence-workspace/project-explorer.component';
import { MainViewerComponent } from '../../components/sequence-workspace/main-viewer.component';
import { ItemInspectorComponent } from '../../components/sequence-workspace/item-inspector.component';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { ProjectItem } from '../../models/sequence.model';

type MobileWorkspacePanel = 'files' | 'viewer' | 'details';

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
    <div class="sequence-workspace-page">
      <nav class="mobile-workspace-tabs" aria-label="Sequence workspace panels">
        <button type="button" [class.active]="mobilePanel === 'files'" (click)="setMobilePanel('files')">Files</button>
        <button type="button" [class.active]="mobilePanel === 'viewer'" [disabled]="!selectedItem"
          [attr.aria-disabled]="!selectedItem" (click)="setMobilePanel('viewer')">Viewer</button>
        <button type="button" [class.active]="mobilePanel === 'details'" [disabled]="!canOpenDetails"
          [attr.aria-disabled]="!canOpenDetails" (click)="setMobilePanel('details')">Details</button>
      </nav>
      <div class="workspace-container">
      <!-- Collapsible Explorer Left Sidebar -->
      <div id="guide-workspace-explorer" class="panel explorer-panel" [class.mobile-panel-hidden]="mobilePanel !== 'files'" *ngIf="!isSidebarCollapsed">
        <app-project-explorer (collapse)="toggleSidebar()"></app-project-explorer>
      </div>

      <!-- Expand Floating Button when Collapsed -->
      <button type="button" class="btn-expand-sidebar" *ngIf="isSidebarCollapsed" (click)="toggleSidebar()" title="Expand Project Explorer">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>

      <div id="guide-workspace-viewer" class="panel viewer-panel" [class.mobile-panel-hidden]="mobilePanel !== 'viewer'">
        <app-main-viewer [isSidebarCollapsed]="isSidebarCollapsed"></app-main-viewer>
      </div>

      <div id="guide-workspace-inspector" class="panel inspector-panel" [class.mobile-panel-hidden]="mobilePanel !== 'details'" *ngIf="canOpenDetails">
        <app-item-inspector></app-item-inspector>
      </div>
      </div>
    </div>
  `,
  styles: [`
    .sequence-workspace-page {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 56px);
      width: 100%;
      background: var(--color-background);
      overflow: hidden;
    }
    .mobile-workspace-tabs { display: none; }
    .workspace-container {
      display: flex;
      flex-direction: row;
      flex: 1;
      min-height: 0;
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
      top: 5px;
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
    @media (max-width: 700px) {
      .sequence-workspace-page { height: calc(100dvh - 56px); }
      .mobile-workspace-tabs {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        flex: 0 0 42px;
        border-bottom: 1px solid var(--color-border);
        background: #fff;
      }
      .mobile-workspace-tabs button {
        border: 0;
        border-bottom: 2px solid transparent;
        background: transparent;
        color: #64748b;
        font: 750 .78rem var(--font-sans);
      }
      .mobile-workspace-tabs button.active { border-bottom-color: var(--color-primary); color: var(--color-primary); }
      .mobile-workspace-tabs button:disabled { color: #cbd5e1; cursor: not-allowed; }
      .mobile-workspace-tabs button:disabled.active { border-bottom-color: transparent; }
      .workspace-container { display: block; overflow: hidden; }
      .panel { width: 100%; height: 100%; min-height: 0; border: 0; }
      .mobile-panel-hidden { display: none; }
      .btn-expand-sidebar { display: none; }
    }
  `]
})
export class SequenceWorkspacePageComponent implements OnDestroy {
  isSidebarCollapsed = false;
  mobilePanel: MobileWorkspacePanel = 'files';
  selectedItem: ProjectItem | null = null;
  private readonly selectionSubscription: Subscription;

  constructor(public workspace: SequenceWorkspaceService) {
    this.selectionSubscription = this.workspace.selectedItem$.subscribe(item => {
      this.selectedItem = item;
      if (!item) {
        this.mobilePanel = 'files';
      } else if (window.innerWidth <= 700) {
        this.mobilePanel = 'viewer';
      } else if (item.type === 'fastq' && this.mobilePanel === 'details') {
        this.mobilePanel = 'viewer';
      }
    });
  }

  ngOnDestroy(): void { this.selectionSubscription.unsubscribe(); }

  get canOpenDetails(): boolean { return !!this.selectedItem && this.selectedItem.type !== 'fastq'; }

  setMobilePanel(panel: MobileWorkspacePanel): void {
    if (panel === 'viewer' && !this.selectedItem) return;
    if (panel === 'details' && !this.canOpenDetails) return;
    this.mobilePanel = panel;
  }

  toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
  }
}
