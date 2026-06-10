import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateService } from './services/app-state.service';
import { AnalysisPageComponent } from './pages/analysis-page/analysis-page.component';
import { ResultViewerPageComponent } from './pages/result-viewer-page/result-viewer-page.component';
import { BenchmarkPageComponent } from './pages/benchmark-page/benchmark-page.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AnalysisPageComponent, ResultViewerPageComponent, BenchmarkPageComponent],
  template: `
    <div class="app-shell">
      <!-- ── Top Navigation ── -->
      <nav class="top-nav">
        <div class="nav-left">
          <div class="nav-brand" style="cursor: pointer;" (click)="activeTab = 'analysis'">
            <img src="logo.png" alt="My Lab Mate" class="nav-brand-logo">
            <span class="brand-local">.local</span>
          </div>

          <div class="desktop-nav-links">
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'analysis'" (click)="activeTab = 'analysis'">
              CRISPR Analysis
            </button>
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'viewer'" (click)="activeTab = 'viewer'">
              Result Viewer
            </button>
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'benchmark'" (click)="activeTab = 'benchmark'">
              Benchmark
            </button>
          </div>
        </div>

        <div class="nav-right">
          <span class="version-tag">v1.0.0</span>
        </div>
      </nav>

      <!-- ── Main Content ── -->
      <main class="app-content">
        <div class="crispr-shell">
          <div class="crispr-body">
            <app-analysis-page *ngIf="activeTab === 'analysis'"></app-analysis-page>
            <app-result-viewer-page *ngIf="activeTab === 'viewer'"></app-result-viewer-page>
            <app-benchmark-page *ngIf="activeTab === 'benchmark'"></app-benchmark-page>
          </div>

          <!-- Footer Notice -->
          <footer class="app-footer">
            <div class="footer-content">
              <p>This page is a part of the mylabmate service, and only the CRISPR analysis tool has been extracted. Server-side execution is not supported here; only local runs are supported.</p>
            </div>
          </footer>
        </div>
      </main>
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
  .brand-local {
    font-family: 'Outfit', 'Inter', sans-serif;
    font-size: 1.15rem;
    font-weight: 500;
    color: #3c4257;
    margin-left: 4px;
    letter-spacing: -0.5px;
    margin-top: -1px;
    display: inline-block;
    vertical-align: middle;
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
  activeTab: 'analysis' | 'viewer' | 'benchmark' = 'analysis';

  constructor(public state: AppStateService) {}

  ngOnInit() {
    this.state.activateSlot('analysis');
  }
}

