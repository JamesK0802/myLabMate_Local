import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateService } from './services/app-state.service';
import { AnalysisPageComponent } from './pages/analysis-page/analysis-page.component';
import { ResultViewerPageComponent } from './pages/result-viewer-page/result-viewer-page.component';
import { BenchmarkPageComponent } from './pages/benchmark-page/benchmark-page.component';
import { SequenceWorkspacePageComponent } from './pages/sequence-workspace-page/sequence-workspace-page.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, AnalysisPageComponent, ResultViewerPageComponent, BenchmarkPageComponent, SequenceWorkspacePageComponent],
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
            <button class="nav-tab btn-tab" [class.active]="activeTab === 'workspace'" (click)="activeTab = 'workspace'">
              Sequence Workspace
              <span *ngIf="!workspaceUnlocked" style="font-size: 0.8em; margin-left: 4px;">🔒</span>
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
          <div class="crispr-body" [class.full-width]="activeTab === 'workspace'">
            <app-analysis-page *ngIf="activeTab === 'analysis'"></app-analysis-page>
            <app-result-viewer-page *ngIf="activeTab === 'viewer'"></app-result-viewer-page>
            <app-benchmark-page *ngIf="activeTab === 'benchmark'"></app-benchmark-page>
            
            <ng-container *ngIf="activeTab === 'workspace'">
              <div *ngIf="!workspaceUnlocked" class="lock-screen">
                <div class="lock-box">
                  <h3>Restricted Access 🔒</h3>
                  <p>The Sequence Workspace is currently under development.</p>
                  <div class="lock-input-group">
                    <input type="password" #pwdInput (keyup.enter)="checkWorkspacePwd(pwdInput.value)" placeholder="Enter password" class="lock-input">
                    <button (click)="checkWorkspacePwd(pwdInput.value)" class="lock-btn">Unlock</button>
                  </div>
                </div>
              </div>
              <app-sequence-workspace-page *ngIf="workspaceUnlocked"></app-sequence-workspace-page>
            </ng-container>
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
    
    /* Lock Screen Styles */
    .lock-screen {
      display: flex; align-items: center; justify-content: center; height: 100%; width: 100%; background: var(--color-background);
    }
    .lock-box {
      background: #ffffff; padding: 32px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; border: 1px solid var(--color-border);
    }
    .lock-box h3 { margin: 0 0 12px 0; color: #2c3e50; font-size: 1.25rem; font-weight: 600; }
    .lock-box p { color: #7f8c8d; margin-bottom: 24px; font-size: 0.95rem; }
    .lock-input-group { display: flex; gap: 8px; justify-content: center; }
    .lock-input { padding: 10px 12px; border: 1px solid var(--color-border); border-radius: 4px; font-size: 1rem; width: 200px; outline: none; }
    .lock-input:focus { border-color: var(--color-primary); }
    .lock-btn { padding: 10px 20px; background: var(--color-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; font-weight: 500; transition: 0.2s; }
    .lock-btn:hover { background: #2980b9; }
  `]
})
export class App implements OnInit {
  activeTab: 'analysis' | 'viewer' | 'benchmark' | 'workspace' = 'analysis';
  workspaceUnlocked = false;

  constructor(public state: AppStateService) {}

  checkWorkspacePwd(pwd: string) {
    if (pwd === '1026') {
      this.workspaceUnlocked = true;
    } else {
      alert('Incorrect password.');
    }
  }

  ngOnInit() {
    this.state.activateSlot('analysis');
  }
}
