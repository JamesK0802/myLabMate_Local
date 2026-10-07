import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateService } from './services/app-state.service';
import { AnalysisPageComponent } from './pages/analysis-page/analysis-page.component';
import { ResultViewerPageComponent } from './pages/result-viewer-page/result-viewer-page.component';
import { BenchmarkPageComponent } from './pages/benchmark-page/benchmark-page.component';
import { SequenceWorkspacePageComponent } from './pages/sequence-workspace-page/sequence-workspace-page.component';
import { TutorialGuideComponent } from './components/tutorial-guide/tutorial-guide.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AnalysisPageComponent, ResultViewerPageComponent, BenchmarkPageComponent, SequenceWorkspacePageComponent, TutorialGuideComponent],
  template: `
    <div class="app-shell">
      <!-- ── Top Navigation ── -->
      <nav class="top-nav">
        <div class="nav-left">
          <div class="nav-brand" id="guide-brand-logo" [class.locked]="state.isAnalysisRunning && activeTab !== 'analysis'" style="cursor: pointer;" (click)="switchTab('analysis')">
            <img src="casmango-logo.jpg" alt="CasMango" class="nav-brand-logo">
          </div>

          <div class="desktop-nav-links" id="guide-nav-links">
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'analysis'" (click)="switchTab('analysis')">
              CRISPR Analysis
            </button>
            <button class="nav-tab btn-tab" id="guide-viewer-tab-btn" [class.active]="activeTab === 'viewer'" [class.locked]="state.isAnalysisRunning" [disabled]="state.isAnalysisRunning" title="{{ state.isAnalysisRunning ? 'Finish or cancel the current analysis first' : '' }}" (click)="switchTab('viewer')">
              Result Viewer
            </button>
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'benchmark'" [class.locked]="state.isAnalysisRunning" [disabled]="state.isAnalysisRunning" title="{{ state.isAnalysisRunning ? 'Finish or cancel the current analysis first' : '' }}" (click)="switchTab('benchmark')">
              Benchmark
            </button>
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'workspace'" [class.locked]="state.isAnalysisRunning" [disabled]="state.isAnalysisRunning" title="{{ state.isAnalysisRunning ? 'Finish or cancel the current analysis first' : '' }}" (click)="switchTab('workspace')">
              Sequence Viewer
            </button>
          </div>
        </div>

        <div class="nav-right">
          <button type="button" class="btn-guide-trigger" (click)="openGuide()" title="Interactive Tutorial Guide">
            <span class="guide-btn-text">Guide</span>
          </button>
          <span class="version-tag">v1.0.0</span>
        </div>

        <span class="mobile-active-section">{{ activeTabLabel }}</span>
        <button type="button" class="mobile-hamburger-btn" [class.open]="mobileMenuOpen"
          (click)="mobileMenuOpen = !mobileMenuOpen" [attr.aria-expanded]="mobileMenuOpen"
          aria-controls="mobile-navigation" aria-label="Toggle navigation menu">
          <span class="bar bar-1"></span>
          <span class="bar bar-2"></span>
          <span class="bar bar-3"></span>
        </button>
      </nav>

      <button *ngIf="mobileMenuOpen" type="button" class="mobile-drawer-backdrop"
        (click)="mobileMenuOpen = false" aria-label="Close navigation menu"></button>
      <aside *ngIf="mobileMenuOpen" id="mobile-navigation" class="mobile-nav-drawer open">
        <div class="drawer-header">
          <img src="casmango-logo.jpg" alt="CasMango" class="drawer-logo">
          <div class="drawer-header-actions">
            <span class="version-tag">v1.0.0</span>
            <button type="button" class="drawer-close" (click)="mobileMenuOpen = false" aria-label="Close navigation menu">×</button>
          </div>
        </div>
        <div class="drawer-links" aria-label="CasMango tools">
          <span class="drawer-section-title">Tools</span>
          <button type="button" class="drawer-link" [class.active]="activeTab === 'analysis'" (click)="switchTab('analysis')">CRISPR Analysis</button>
          <button type="button" class="drawer-link" [class.active]="activeTab === 'viewer'" [disabled]="state.isAnalysisRunning" (click)="switchTab('viewer')">Result Viewer</button>
          <button type="button" class="drawer-link" [class.active]="activeTab === 'benchmark'" [disabled]="state.isAnalysisRunning" (click)="switchTab('benchmark')">Benchmark</button>
          <button type="button" class="drawer-link" [class.active]="activeTab === 'workspace'" [disabled]="state.isAnalysisRunning" (click)="switchTab('workspace')">Sequence Viewer</button>
          <button type="button" class="drawer-link drawer-guide-btn" (click)="openGuide()">Interactive Guide</button>
        </div>
        <div class="drawer-footer">All analysis stays on this device.</div>
      </aside>

      <!-- ── Main Content ── -->
      <main class="app-content">
        <div class="crispr-shell">
          <div class="crispr-body" [class.full-width]="activeTab === 'workspace'">
            <app-analysis-page *ngIf="activeTab === 'analysis'"></app-analysis-page>
            <app-result-viewer-page *ngIf="activeTab === 'viewer'"></app-result-viewer-page>
            <app-benchmark-page *ngIf="activeTab === 'benchmark'"></app-benchmark-page>
            
            <ng-container *ngIf="activeTab === 'workspace'">
              <app-sequence-workspace-page></app-sequence-workspace-page>
            </ng-container>
          </div>

          <!-- Footer Notice -->
          <footer class="app-footer">
            <div class="footer-content">
              <p>CasMango runs CRISPR analysis entirely in your browser. Sequencing files remain on this device and are never uploaded to a server.</p>
            </div>
          </footer>

          <!-- ── Interactive Mascot Tutorial Guide ── -->
          <app-tutorial-guide *ngIf="isGuideOpen" [initialMode]="guideInitialMode" (close)="isGuideOpen = false" (requestTab)="switchTab($event)"></app-tutorial-guide>
      <!-- ── Global Export Loading Overlay ── -->
      <div class="global-export-overlay" *ngIf="state.exportStatus$ | async as status">
        <div class="export-loading-card">
          <div class="export-spinner-ring"></div>
          <div class="export-loading-content">
            <h4>{{ status.title }}</h4>
            <p>{{ status.stage }}</p>
            <div class="export-progress-track">
              <div class="export-progress-bar" [style.width.%]="status.percent"></div>
            </div>
            <span class="export-percent-num">{{ status.percent }}%</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrl: './app.css',
encapsulation: ViewEncapsulation.None,
styles: [`
  .btn-tab {
    background: none;
    border: none;
    font-size: var(--text-base);
    font-weight: var(--fw-bold);
    color: var(--color-text-secondary);
    cursor: pointer;
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    transition: var(--transition-fast);
  }
  .btn-tab:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-alt);
  }
  .btn-tab.active {
    color: var(--color-primary);
    background: var(--color-primary-light);
  }
  .btn-tab.locked, .btn-tab.locked:hover {
    color: var(--color-text-tertiary);
    background: transparent;
    cursor: not-allowed;
    opacity: .5;
  }
    .crispr-shell {
      display: flex;
      flex-direction: column;
      min-height: calc(100vh - 56px);
    }
    .crispr-body {
      flex: 1;
      padding: 24px 28px;
      background: #f7f8fa;
      max-width: 1100px;
      width: 100%;
      margin: 0 auto;
    }
    .crispr-body.full-width {
      max-width: 100%;
      padding: 0;
    }
    .app-footer {
      background: var(--color-surface);
      border-top: 1px solid var(--color-border);
      padding: var(--space-4) var(--space-6);
      text-align: center;
      margin-top: auto;
    }
    .footer-content p {
      font-size: var(--text-sm);
      color: var(--color-text-secondary);
      margin: 0;
      line-height: 1.5;
    }
    @media (max-width: 760px) {
      .crispr-body {
        padding: 18px 20px;
      }
    }
    
  `]
})
export class App implements OnInit {
  activeTab: 'analysis' | 'viewer' | 'benchmark' | 'workspace' = 'analysis';
  mobileMenuOpen = false;
  isGuideOpen = false;
  guideInitialMode: 'hub' | 'analysis' | 'result' | 'workspace' | 'benchmark' = 'hub';

  constructor(public state: AppStateService) {}

  openGuide(mode: 'hub' | 'analysis' | 'result' | 'workspace' | 'benchmark' = 'hub') {
    this.guideInitialMode = mode;
    if (mode === 'analysis') {
      this.switchTab('analysis');
      this.state.collapseAnalysisPanels();
    } else if (mode === 'result') {
      this.switchTab('viewer');
    } else if (mode === 'workspace') {
      this.switchTab('workspace');
    } else if (mode === 'benchmark') {
      this.switchTab('benchmark');
    }
    this.isGuideOpen = true;
    this.mobileMenuOpen = false;
  }

  switchTab(tab: 'analysis' | 'viewer' | 'benchmark' | 'workspace') {
    if (this.state.isAnalysisRunning && tab !== this.activeTab) return;
    this.state.switchMainTab(tab);
    this.mobileMenuOpen = false;
  }

  get activeTabLabel(): string {
    return {
      analysis: 'Analysis',
      viewer: 'Results',
      benchmark: 'Benchmark',
      workspace: 'Sequences'
    }[this.activeTab];
  }

  ngOnInit() {
    this.state.activateSlot('analysis');
    this.state.activeMainTab$.subscribe(tab => {
      this.activeTab = tab;
    });
  }
}
