import { Component, EventEmitter, Output, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface GuideCalloutItem {
  id: string;
  targetSelector: string;
  tag: string;
  title: string;
  highlight: string;
  details: string;
  subnote?: string;
  accentColor: string;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  offsetX?: number;
  offsetY?: number;

  // Computed layout state
  targetRect?: DOMRect;
  cardRect?: { top: number; left: number; width: number; height: number };
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  pathD?: string;
  arrowMarkerId?: string;
}

export interface GuideStep {
  id: string;
  stepNum: string;
  stepCategory: string;
  headline: string;
  hint: string;
  primaryScrollTarget?: string;
  isIntro?: boolean;
  introPillars?: Array<{
    tag: string;
    title: string;
    highlight: string;
    details: string;
    subnote?: string;
    color: string;
  }>;
  callouts?: GuideCalloutItem[];
}

@Component({
  selector: 'app-tutorial-guide',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tutorial-overlay" (keydown.escape)="closeGuide()" tabindex="0">

      <!-- ── SVG Curved Dashed Arrows Layer ── -->
      <svg class="arrows-svg-layer" *ngIf="!currentStep.isIntro">
        <defs>
          <ng-container *ngFor="let item of activeCallouts; let i = index">
            <marker [id]="'arrow-marker-' + i"
                    viewBox="0 0 12 12"
                    refX="10"
                    refY="6"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse">
              <polygon points="0 1, 10 6, 0 11" [attr.fill]="item.accentColor" />
            </marker>
          </ng-container>
        </defs>

        <!-- Dynamic Curved Paths & Anchors -->
        <ng-container *ngFor="let item of activeCallouts; let i = index">
          <g *ngIf="item.pathD">
            <!-- Pulsing Origin Anchor Dot on the UI Element -->
            <circle [attr.cx]="item.startX" [attr.cy]="item.startY" r="10"
                    fill="none" [attr.stroke]="item.accentColor" stroke-width="1.5" class="pulse-ring" />
            <circle [attr.cx]="item.startX" [attr.cy]="item.startY" r="4.5"
                    [attr.fill]="item.accentColor" />

            <!-- Curved Dashed Connector Arrow -->
            <path [attr.d]="item.pathD"
                  [attr.stroke]="item.accentColor"
                  stroke-width="2.5"
                  stroke-dasharray="7,5"
                  fill="none"
                  class="curved-dashed-arrow"
                  [attr.marker-end]="'url(#arrow-marker-' + i + ')'" />
          </g>
        </ng-container>
      </svg>

      <!-- ── Highlight Frames over Real UI Elements ── -->
      <ng-container *ngIf="!currentStep.isIntro">
        <div class="element-spotlight"
             *ngFor="let item of activeCallouts"
             [style.display]="item.targetRect ? 'block' : 'none'"
             [style.top.px]="(item.targetRect?.top || 0) - 5"
             [style.left.px]="(item.targetRect?.left || 0) - 5"
             [style.width.px]="(item.targetRect?.width || 0) + 10"
             [style.height.px]="(item.targetRect?.height || 0) + 10"
             [style.borderColor]="item.accentColor"
             [style.boxShadow]="'0 0 18px ' + item.accentColor + '88'">
          <span class="spotlight-badge" [style.background]="item.accentColor">
            {{ item.tag }}
          </span>
        </div>
      </ng-container>

      <!-- ── Direct Annotation Callout Popups ── -->
      <ng-container *ngIf="!currentStep.isIntro">
        <div class="callout-card"
             *ngFor="let item of activeCallouts; let ci = index"
             [style.display]="item.cardRect ? 'flex' : 'none'"
             [style.top.px]="item.cardRect?.top"
             [style.left.px]="item.cardRect?.left"
             [style.width.px]="item.cardRect?.width"
             [style.borderTopColor]="item.accentColor"
             (click)="nextStep()">
          <div class="callout-accent-bar" [style.background]="item.accentColor"></div>

          <div class="callout-header">
            <span class="callout-tag" [style.color]="item.accentColor" [style.borderColor]="item.accentColor">
              {{ item.tag }}
            </span>
            <span class="callout-target-label">CONNECTED UI</span>
          </div>

          <h3 class="callout-title">{{ item.title }}</h3>
          <div class="callout-highlight" [style.color]="item.accentColor">{{ item.highlight }}</div>

          <div class="callout-divider"></div>

          <p class="callout-details">{{ item.details }}</p>

          <div class="callout-subnote" *ngIf="item.subnote">
            <span class="subnote-bullet" [style.color]="item.accentColor">›</span>
            <span class="subnote-text">{{ item.subnote }}</span>
          </div>

          <div class="callout-footer-action">
            <span>CLICK TO ADVANCE</span>
            <span class="action-arrow">→</span>
          </div>
        </div>
      </ng-container>

      <!-- ── Intro / Welcome Briefing Card (Centered) ── -->
      <div class="intro-modal-card" *ngIf="currentStep.isIntro">
        <div class="intro-header">
          <div class="intro-mascot-pill">
            <img src="casmango-logo.jpg" alt="CasMANGO" class="intro-logo-thumb" />
            <div class="intro-mascot-meta">
              <span class="intro-mascot-badge">SYSTEM INITIALIZATION</span>
              <strong class="intro-mascot-title">CasMANGO CRISPR Engine</strong>
            </div>
          </div>
          <button type="button" class="btn-intro-close" (click)="closeGuide()" title="Close Tutorial">✕</button>
        </div>

        <h1 class="intro-headline">{{ currentStep.headline }}</h1>
        <p class="intro-subhead">
          High-precision, client-side amplicon analysis built specifically for polyploid crops and modern CRISPR workflows.
        </p>

        <div class="intro-pillars-grid">
          <div class="pillar-card" *ngFor="let pillar of currentStep.introPillars">
            <div class="pillar-top" [style.borderColor]="pillar.color">
              <span class="pillar-tag" [style.color]="pillar.color">{{ pillar.tag }}</span>
            </div>
            <h4 class="pillar-title">{{ pillar.title }}</h4>
            <p class="pillar-highlight" [style.color]="pillar.color">{{ pillar.highlight }}</p>
            <p class="pillar-details">{{ pillar.details }}</p>
            <div class="pillar-subnote" *ngIf="pillar.subnote">
              <span>› {{ pillar.subnote }}</span>
            </div>
          </div>
        </div>

        <div class="intro-actions">
          <div class="intro-prereq-note">
            <span class="prereq-label">REQUIRED INPUTS:</span>
            <span class="prereq-items">FASTQ Reads (.fq / .gz) · Wild-Type Reference Sequence · gRNA Spacer Target</span>
          </div>
          <button type="button" class="btn-start-tour" (click)="nextStep()">
            <span>START INTERACTIVE TOUR</span>
            <span class="btn-tour-arrow">▶</span>
          </button>
        </div>
      </div>

      <!-- ── Top Stage Bar ── -->
      <header class="top-stage-bar" *ngIf="!currentStep.isIntro">
        <div class="stage-info">
          <span class="stage-number">{{ currentStep.stepNum }}</span>
          <span class="stage-divider">/</span>
          <span class="stage-total">STAGE 6</span>
          <span class="stage-category">{{ currentStep.stepCategory }}</span>
        </div>

        <h2 class="stage-headline">{{ currentStep.headline }}</h2>

        <button type="button" class="btn-stage-exit" (click)="closeGuide()" title="Exit Guide (Esc)">
          EXIT ✕
        </button>
      </header>

      <!-- ── Bottom HUD Controller Bar ── -->
      <footer class="bottom-hud-bar">
        <!-- Left: Mascot Identity -->
        <div class="hud-mascot-section">
          <div class="hud-mascot-avatar">
            <img src="casmango-logo.jpg" alt="CasMANGO" class="hud-avatar-img" />
            <span class="hud-online-dot"></span>
          </div>
          <div class="hud-mascot-info">
            <span class="hud-mascot-role">INTERACTIVE TOUR</span>
            <strong class="hud-mascot-name">CasMANGO Walkthrough</strong>
          </div>
        </div>

        <!-- Center: Step Progress Pills & Operation Hint -->
        <div class="hud-center-section">
          <div class="hud-step-pills">
            <button type="button"
                    *ngFor="let s of steps; let i = index"
                    class="hud-pill"
                    [class.active]="i === currentStepIndex"
                    [class.completed]="i < currentStepIndex"
                    [title]="s.headline"
                    (click)="goToStep(i)">
              <span class="pill-number">{{ i }}</span>
            </button>
          </div>
          <div class="hud-hint-text">
            <span class="hint-bullet">●</span>
            <span>{{ currentStep.hint }}</span>
          </div>
        </div>

        <!-- Right: Prev / Next Navigation Buttons -->
        <div class="hud-actions-section">
          <button type="button"
                  class="btn-hud-nav btn-hud-prev"
                  [disabled]="currentStepIndex === 0"
                  (click)="prevStep()">
            ◀ PREV
          </button>

          <button type="button"
                  class="btn-hud-nav btn-hud-next"
                  (click)="nextStep()">
            <span>{{ isLastStep ? 'FINISH TOUR ⚔️' : 'NEXT STAGE ▶' }}</span>
            <span class="hud-key-pill" *ngIf="!isLastStep">ENTER</span>
          </button>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    /* ── Main Fullscreen Overlay (NO BLUR, Crisp Transparency) ── */
    .tutorial-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(8, 14, 26, 0.68);
      backdrop-filter: none; /* No blur! Target UI is completely sharp */
      outline: none;
      pointer-events: auto;
      user-select: none;
      animation: overlayFade 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes overlayFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── SVG Curved Dashed Arrows Layer ── */
    .arrows-svg-layer {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 10002;
    }

    .curved-dashed-arrow {
      animation: dashFlow 1.2s linear infinite;
      filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.7));
    }

    @keyframes dashFlow {
      from { stroke-dashoffset: 0; }
      to { stroke-dashoffset: -24; }
    }

    .pulse-ring {
      animation: pulseRipple 1.6s ease-out infinite;
      transform-origin: center;
    }

    @keyframes pulseRipple {
      0% { r: 4; opacity: 1; }
      100% { r: 16; opacity: 0; }
    }

    /* ── Spotlight Box around Actual UI Elements ── */
    .element-spotlight {
      position: fixed;
      z-index: 10001;
      border: 2.5px solid #38bdf8;
      border-radius: 10px;
      pointer-events: none;
      transition: all 0.25s cubic-bezier(0.2, 0.9, 0.3, 1);
    }

    .spotlight-badge {
      position: absolute;
      top: -12px;
      left: 12px;
      color: #0f172a;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      padding: 2px 10px;
      border-radius: 999px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }

    /* ── Connected Callout Popups (Sleek HUD Cards) ── */
    .callout-card {
      position: fixed;
      z-index: 10005;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 12px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.65), 0 0 20px rgba(0, 0, 0, 0.4);
      padding: 16px 18px 14px 18px;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      animation: calloutPop 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .callout-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 20px 44px rgba(0, 0, 0, 0.8), 0 0 25px rgba(56, 189, 248, 0.25);
      border-color: rgba(255, 255, 255, 0.3);
    }

    @keyframes calloutPop {
      from { transform: scale(0.92) translateY(10px); opacity: 0; }
      to { transform: scale(1) translateY(0); opacity: 1; }
    }

    .callout-accent-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      border-radius: 12px 12px 0 0;
    }

    .callout-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .callout-tag {
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      border: 1px solid;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.04);
    }

    .callout-target-label {
      font-size: 10px;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.06em;
    }

    .callout-title {
      margin: 0 0 3px 0;
      font-size: 16px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.01em;
    }

    .callout-highlight {
      font-size: 12.5px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .callout-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.08);
      margin-bottom: 8px;
    }

    .callout-details {
      margin: 0 0 8px 0;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
    }

    .callout-subnote {
      display: flex;
      align-items: baseline;
      gap: 6px;
      font-size: 11px;
      color: #94a3b8;
      border-top: 1px dashed rgba(255, 255, 255, 0.08);
      padding-top: 6px;
      margin-bottom: 6px;
    }

    .subnote-bullet {
      font-weight: 900;
      font-size: 13px;
    }

    .subnote-text {
      line-height: 1.4;
    }

    .callout-footer-action {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
      font-size: 10.5px;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }

    .callout-card:hover .callout-footer-action {
      color: #38bdf8;
    }

    /* ── Top Stage Bar ── */
    .top-stage-bar {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10006;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      padding: 8px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.6);
      pointer-events: auto;
    }

    .stage-info {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stage-number {
      font-size: 13px;
      font-weight: 900;
      color: #f59e0b;
    }

    .stage-divider {
      color: #475569;
      font-size: 12px;
    }

    .stage-total {
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }

    .stage-category {
      background: rgba(255, 255, 255, 0.08);
      color: #94a3b8;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.08em;
      padding: 2px 10px;
      border-radius: 999px;
      margin-left: 6px;
    }

    .stage-headline {
      margin: 0;
      font-size: 15px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.01em;
    }

    .btn-stage-exit {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      font-size: 11px;
      font-weight: 800;
      padding: 4px 12px;
      border-radius: 999px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-stage-exit:hover {
      background: #ef4444;
      color: #ffffff;
    }

    /* ── Intro Modal Card (Centered) ── */
    .intro-modal-card {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10006;
      width: calc(100vw - 64px);
      max-width: 1080px;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 20px;
      padding: 36px 40px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(245, 158, 11, 0.15);
      pointer-events: auto;
      animation: calloutPop 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .intro-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 18px;
    }

    .intro-mascot-pill {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .intro-logo-thumb {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      border: 2px solid #f59e0b;
      object-fit: cover;
    }

    .intro-mascot-meta {
      display: flex;
      flex-direction: column;
    }

    .intro-mascot-badge {
      font-size: 11px;
      font-weight: 800;
      color: #f59e0b;
      letter-spacing: 0.08em;
    }

    .intro-mascot-title {
      font-size: 17px;
      font-weight: 900;
      color: #ffffff;
    }

    .btn-intro-close {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #cbd5e1;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .btn-intro-close:hover {
      background: #ef4444;
      color: #ffffff;
      border-color: #ef4444;
    }

    .intro-headline {
      margin: 0 0 8px 0;
      font-size: 28px;
      font-weight: 900;
      color: #ffffff;
      letter-spacing: -0.02em;
    }

    .intro-subhead {
      margin: 0 0 24px 0;
      font-size: 14.5px;
      color: #94a3b8;
      line-height: 1.5;
    }

    .intro-pillars-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }

    .pillar-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
    }

    .pillar-top {
      border-left: 3px solid;
      padding-left: 8px;
      margin-bottom: 8px;
    }

    .pillar-tag {
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
    }

    .pillar-title {
      margin: 0 0 4px 0;
      font-size: 15px;
      font-weight: 800;
      color: #ffffff;
    }

    .pillar-highlight {
      margin: 0 0 8px 0;
      font-size: 12px;
      font-weight: 700;
    }

    .pillar-details {
      margin: 0 0 10px 0;
      font-size: 11.5px;
      color: #cbd5e1;
      line-height: 1.45;
      flex: 1;
    }

    .pillar-subnote {
      font-size: 10.5px;
      color: #64748b;
      border-top: 1px dashed rgba(255, 255, 255, 0.08);
      padding-top: 6px;
    }

    .intro-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      padding-top: 18px;
    }

    .intro-prereq-note {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .prereq-label {
      font-size: 10.5px;
      font-weight: 900;
      color: #10b981;
      letter-spacing: 0.06em;
    }

    .prereq-items {
      font-size: 12px;
      color: #cbd5e1;
      font-weight: 500;
    }

    .btn-start-tour {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      color: #0f172a;
      border: none;
      padding: 12px 28px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0.04em;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
      transition: all 0.18s ease;
    }

    .btn-start-tour:hover {
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      transform: translateY(-2px);
      box-shadow: 0 0 28px rgba(245, 158, 11, 0.6);
    }

    .btn-tour-arrow {
      font-size: 12px;
    }

    /* ── Bottom HUD Controller Bar ── */
    .bottom-hud-bar {
      position: fixed;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      width: calc(100vw - 48px);
      max-width: 1280px;
      z-index: 10006;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 16px;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
      pointer-events: auto;
    }

    .hud-mascot-section {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .hud-mascot-avatar {
      position: relative;
      width: 36px;
      height: 36px;
    }

    .hud-avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 10px;
      border: 1.5px solid #f59e0b;
      object-fit: cover;
    }

    .hud-online-dot {
      position: absolute;
      bottom: -2px;
      right: -2px;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #10b981;
      border: 2px solid #0f172a;
    }

    .hud-mascot-info {
      display: flex;
      flex-direction: column;
    }

    .hud-mascot-role {
      font-size: 10px;
      font-weight: 800;
      color: #f59e0b;
      letter-spacing: 0.08em;
    }

    .hud-mascot-name {
      font-size: 13px;
      font-weight: 800;
      color: #ffffff;
    }

    .hud-center-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .hud-step-pills {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .hud-pill {
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #94a3b8;
      font-size: 10.5px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
    }

    .hud-pill.active {
      width: 38px;
      background: #f59e0b;
      border-color: #f59e0b;
      color: #0f172a;
      box-shadow: 0 0 14px rgba(245, 158, 11, 0.6);
    }

    .hud-pill.completed {
      background: rgba(16, 185, 129, 0.2);
      border-color: #10b981;
      color: #34d399;
    }

    .hud-hint-text {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #cbd5e1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    .hint-bullet {
      color: #10b981;
      font-size: 8px;
    }

    .hud-actions-section {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .btn-hud-nav {
      padding: 8px 18px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.04em;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .btn-hud-prev {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.14);
      color: #cbd5e1;
    }

    .btn-hud-prev:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }

    .btn-hud-prev:disabled {
      opacity: 0.25;
      cursor: not-allowed;
    }

    .btn-hud-next {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border: none;
      color: #0f172a;
      box-shadow: 0 0 16px rgba(245, 158, 11, 0.4);
    }

    .btn-hud-next:hover {
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      transform: translateY(-1px);
      box-shadow: 0 0 22px rgba(245, 158, 11, 0.6);
    }

    .hud-key-pill {
      font-size: 9px;
      font-weight: 800;
      background: rgba(15, 23, 42, 0.3);
      padding: 1px 5px;
      border-radius: 4px;
    }

    /* ── Responsive Adjustments ── */
    @media (max-width: 1024px) {
      .intro-pillars-grid {
        grid-template-columns: 1fr;
      }
      .intro-modal-card {
        padding: 24px;
        max-height: 85vh;
        overflow-y: auto;
      }
      .top-stage-bar {
        width: calc(100vw - 32px);
        justify-content: space-between;
      }
      .stage-headline {
        display: none;
      }
    }

    @media (max-width: 768px) {
      .bottom-hud-bar {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
      .hud-actions-section {
        justify-content: flex-end;
      }
    }
  `]
})
export class TutorialGuideComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() requestTab = new EventEmitter<'analysis' | 'viewer' | 'benchmark' | 'workspace'>();

  currentStepIndex = 0;

  steps: GuideStep[] = [
    // ── Stage 0: System Initialization & Intro ──
    {
      id: 'intro',
      stepNum: 'STAGE 0',
      stepCategory: 'INITIALIZATION',
      headline: 'CasMANGO: High-Precision Client-Side CRISPR Engine',
      hint: 'Click "Start Interactive Tour" or press Enter to begin the guided walkthrough.',
      isIntro: true,
      introPillars: [
        {
          tag: '100% LOCAL PRIVACY',
          title: 'Client-Side Execution',
          highlight: 'Zero Cloud Transmission',
          details: 'All sequencing FASTQ data is parsed and evaluated entirely inside Web Workers on your device. Private genetic files never touch an external server.',
          subnote: 'Clinical & proprietary genetic datasets remain strictly confidential.',
          color: '#38bdf8'
        },
        {
          tag: 'PLATFORM AGNOSTIC',
          title: 'Illumina & Nanopore',
          highlight: 'Short & Long Read Engines',
          details: 'Seamlessly handles short-read Illumina paired ends (with mate linking & gap X-padding) as well as Oxford Nanopore long-read amplicons.',
          subnote: 'Supports raw (.fastq) and compressed (.fastq.gz / .fq.gz) archives.',
          color: '#10b981'
        },
        {
          tag: 'POLYPLOID SPECIALTY',
          title: 'Zero-Misassignment Demux',
          highlight: 'Engineered for Polyploids',
          details: 'Alignment models and similarity margins reliably segregate nearly-identical homoeologs (e.g. 4A/4B/4D) with verified 0% cross-assignment error.',
          subnote: 'Benchmark-proven accuracy against CRISPRessoPooled and CRISPResso2.',
          color: '#f59e0b'
        }
      ]
    },

    // ── Stage 1: Sequencing Platform & Reference Mode ──
    {
      id: 'platform-mode',
      stepNum: 'STAGE 1',
      stepCategory: 'SEQUENCING ARCHITECTURE',
      headline: 'Select Sequencing Technology & Reference Mode',
      hint: 'Look at the highlighted toggles above. Curved arrows point to each platform mode.',
      primaryScrollTarget: '#guide-platform-choice',
      callouts: [
        {
          id: 'platform-chemistry',
          targetSelector: '#guide-platform-choice',
          tag: '01 · PLATFORM CHEMISTRY',
          title: 'Illumina vs. Nanopore',
          highlight: 'Short-Read Pairing vs. Long-Read Alignment',
          details: 'Illumina mode auto-pairs R1/R2 and applies gap X-padding for non-overlapping reads. Nanopore mode activates long-read amplicon alignment with terminal anchor checks.',
          subnote: 'Both chemistries support raw and compressed (.gz) FASTQ files.',
          accentColor: '#38bdf8',
          placement: 'bottom-left',
          offsetX: -10,
          offsetY: 20
        },
        {
          id: 'reference-mode',
          targetSelector: '#guide-mode-choice',
          tag: '02 · GENOME COMPLEXITY',
          title: 'Standard vs. Homoeolog',
          highlight: 'Single Locus vs. Polyploid Disambiguation',
          details: 'Standard mode processes individual genes independently. Homoeolog mode computes cross-subgenome competition (e.g. 4A/4B/4D) to eliminate cross-misassignments.',
          subnote: 'Always choose Homoeolog mode for allopolyploid crops (wheat, canola).',
          accentColor: '#f59e0b',
          placement: 'bottom-right',
          offsetX: 10,
          offsetY: 20
        }
      ]
    },

    // ── Stage 2: FASTQ File Ingestion ──
    {
      id: 'file-upload',
      stepNum: 'STAGE 2',
      stepCategory: 'DATA INGESTION',
      headline: 'Direct File Drag & Drop with Automated Pairing',
      hint: 'Drag your FASTQ / GZ files directly into the central drop zone.',
      primaryScrollTarget: '#guide-upload-zone',
      callouts: [
        {
          id: 'dropzone',
          targetSelector: '#guide-upload-zone',
          tag: '01 · UNIVERSAL DROPZONE',
          title: 'Zero-Upload Browser Stream',
          highlight: '.fastq / .fq / .fastq.gz / .fq.gz',
          details: 'Drop any number of sequencing files directly into the central area. Files are parsed in browser memory without sending a single byte to an external server.',
          subnote: 'Decompression of gzip archives occurs on-the-fly in local memory.',
          accentColor: '#10b981',
          placement: 'bottom-left',
          offsetX: 40,
          offsetY: -30
        },
        {
          id: 'pairing-workers',
          targetSelector: '#guide-upload-zone',
          tag: '02 · CONCURRENCY & MATES',
          title: 'Automated Illumina Mate Linking',
          highlight: 'Parallel Multi-Threaded Workers',
          details: 'Illumina R1 and R2 pairs are automatically matched from filenames into paired slots. Each sample is analyzed in parallel by an independent browser Web Worker.',
          subnote: 'Mismatched mates can also be manually dragged between slots.',
          accentColor: '#8b5cf6',
          placement: 'bottom-right',
          offsetX: -40,
          offsetY: -30
        }
      ]
    },

    // ── Stage 3: Reference & Target Configuration ──
    {
      id: 'ref-config',
      stepNum: 'STAGE 3',
      stepCategory: 'SEQUENCE CONFIGURATION',
      headline: 'Reference Amplicon & Target (gRNA) Setup',
      hint: 'Configure wild-type references and gRNA targets, or load dozens at once via Excel.',
      primaryScrollTarget: '#guide-targets-section',
      callouts: [
        {
          id: 'ref-inputs',
          targetSelector: '#guide-targets-section',
          tag: '01 · AMPLICON & gRNA',
          title: 'Wild-Type Sequence & Guide Spacer',
          highlight: 'Full Template & 19–25 bp Spacer',
          details: 'Enter the wild-type amplicon sequence and target guide(s). CasMANGO automatically locates PAM sites and determines exact double-strand cut coordinates.',
          subnote: 'Supports multiple guide RNA targets within the same reference amplicon.',
          accentColor: '#38bdf8',
          placement: 'bottom-left',
          offsetX: 30,
          offsetY: -50
        },
        {
          id: 'autofill-btn',
          targetSelector: '#guide-autofill-btn',
          tag: '02 · BATCH AUTOMATION',
          title: '1-Click Excel Auto Fill',
          highlight: 'Download Template · Fill · Upload',
          details: 'Use "Download Template" to get an Excel sheet formatted for your project, fill in dozens of targets, and upload it back to populate everything in 1 second.',
          subnote: 'Export your current configuration anytime with "Download Current Config".',
          accentColor: '#f59e0b',
          placement: 'top-right',
          offsetX: -20,
          offsetY: -10
        },
        {
          id: 'scope-btn',
          targetSelector: '#guide-scope-btn',
          tag: '03 · MULTIPLEXING',
          title: 'Config per File Override',
          highlight: 'Sample-Specific Reference Mapping',
          details: 'When different FASTQ files target distinct gene amplicons, enable "Config per File" to assign specific reference sets and gRNAs to each library.',
          subnote: 'Files without overrides inherit the Default reference configuration.',
          accentColor: '#ec4899',
          placement: 'top-left',
          offsetX: 20,
          offsetY: -10
        }
      ]
    },

    // ── Stage 4: Window Check (Visual Locus & Similarity Metric) ──
    {
      id: 'window-check',
      stepNum: 'STAGE 4',
      stepCategory: 'PRECISION TUNING',
      headline: 'Window Check: Visual Locus & Pairwise Similarity Matrix',
      hint: 'The Window Check tool guides your choice of Assignment Margin and window boundaries.',
      primaryScrollTarget: '#guide-window-check-btn',
      callouts: [
        {
          id: 'window-check-tool',
          targetSelector: '#guide-window-check-btn',
          tag: '01 · VISUAL INSPECTOR',
          title: 'Cleavage Span Preview',
          highlight: 'Interactive 30–180 bp Sequence Span',
          details: 'Inspect the nucleotide sequence surrounding the cut site. Verify visually whether your chosen window width encompasses all expected editing events and deletions.',
          subnote: 'Prevents truncated measurements on large resection alleles.',
          accentColor: '#10b981',
          placement: 'bottom-left',
          offsetX: 30,
          offsetY: 20
        },
        {
          id: 'similarity-matrix',
          targetSelector: '#guide-window-check-btn',
          tag: '02 · DECISION METRIC',
          title: 'Pairwise Similarity Matrix',
          highlight: 'Indicator for Assignment Margin (%)',
          details: 'In Homoeolog mode, CasMANGO calculates pairwise similarity percentages between all references. High similarity (e.g. >98%) indicates you should raise Assignment Margin.',
          subnote: 'Guarantees robust discrimination between paralogs with 0% misassignment.',
          accentColor: '#f59e0b',
          placement: 'bottom-right',
          offsetX: 220,
          offsetY: 20
        }
      ]
    },

    // ── Stage 5: Algorithm Parameters & Advanced Settings ──
    {
      id: 'parameters',
      stepNum: 'STAGE 5',
      stepCategory: 'ALGORITHM CONTROLS',
      headline: 'Fine-Tune Window, Noise Gate, & Mutation Weights',
      hint: 'Set core parameters, and use Advanced settings to protect against large deletion skew.',
      primaryScrollTarget: '#guide-controls-grid',
      callouts: [
        {
          id: 'core-params',
          targetSelector: '#guide-controls-grid',
          tag: '01 · CORE PARAMETERS',
          title: 'Window, Quality & Assignment Margin',
          highlight: 'Noise Filter & Demux Thresholds',
          details: 'Window Size defines the analyzed span around the cut site (default 30 bp). Assignment Margin enforces a score advantage to prevent cross-assignment. Indel Threshold filters noise.',
          subnote: 'Phred filtering automatically discards low-quality sequencing reads.',
          accentColor: '#38bdf8',
          placement: 'top-left',
          offsetX: 40,
          offsetY: -20
        },
        {
          id: 'advanced-tuning',
          targetSelector: '#guide-advanced-btn',
          tag: '02 · MUTATION RESILIENCE',
          title: 'Cut-Site Exclusion & Distance Weight',
          highlight: 'Prevent Large Deletions from Skewing Demux',
          details: 'Open "Advanced" to exclude mutations starting within cut site ±N bp from similarity scores, or apply distance weights to distant SNVs so large indels do not distort assignment.',
          subnote: 'Also supports custom asymmetrical Left / Right window flank boundaries.',
          accentColor: '#8b5cf6',
          placement: 'bottom-right',
          offsetX: -40,
          offsetY: 20
        }
      ]
    },

    // ── Stage 6: Execution & Post-Run Viewers ──
    {
      id: 'run-and-view',
      stepNum: 'STAGE 6',
      stepCategory: 'MISSION COMMENCE',
      headline: 'Launch Analysis, Inspect Dashboards, & Compare Benchmarks',
      hint: 'Ready! Start analysis or use Result Viewer & Benchmark from the top navigation.',
      primaryScrollTarget: '#guide-run-btn',
      callouts: [
        {
          id: 'run-analysis-btn',
          targetSelector: '#guide-run-btn',
          tag: '01 · EXECUTION',
          title: 'Start Local Analysis',
          highlight: 'Multi-Threaded In-Browser Engine',
          details: 'Spawns parallel Web Workers to process your reads in seconds. Live progress bars track per-file completion in real time without any server latency.',
          subnote: 'Interactive dashboards display indel distributions, size histograms, and alleles.',
          accentColor: '#f59e0b',
          placement: 'top-left',
          offsetX: 40,
          offsetY: -30
        },
        {
          id: 'nav-viewers',
          targetSelector: '#guide-nav-links',
          tag: '02 · WORKFLOW ECOSYSTEM',
          title: 'Result Viewer & Benchmark Suite',
          highlight: 'Excel Archive & Tool Comparison',
          details: 'Export comprehensive analysis results to Excel (.xlsx) and reload them into the Result Viewer anytime with zero re-computation. Validate accuracy in the Benchmark tab.',
          subnote: 'Share Excel results with collaborators for immediate inspection in CasMANGO.',
          accentColor: '#10b981',
          placement: 'bottom-left',
          offsetX: 60,
          offsetY: 25
        }
      ]
    }
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  get currentStep(): GuideStep {
    return this.steps[this.currentStepIndex];
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.steps.length - 1;
  }

  get activeCallouts(): GuideCalloutItem[] {
    return this.currentStep.callouts || [];
  }

  ngOnInit() {
    this.updateLayout();
  }

  ngOnDestroy() {
    // cleanup
  }

  @HostListener('window:resize')
  onResize() {
    this.updateLayout();
  }

  @HostListener('window:scroll')
  onScroll() {
    this.updateLayout();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.closeGuide();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      this.nextStep();
    } else if (e.key === 'ArrowLeft') {
      this.prevStep();
    }
  }

  nextStep() {
    if (this.isLastStep) {
      this.closeGuide();
      return;
    }
    this.currentStepIndex++;
    this.scrollAndRefresh();
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.scrollAndRefresh();
    }
  }

  goToStep(index: number) {
    if (index >= 0 && index < this.steps.length) {
      this.currentStepIndex = index;
      this.scrollAndRefresh();
    }
  }

  closeGuide() {
    this.close.emit();
  }

  private scrollAndRefresh() {
    const targetSel = this.currentStep.primaryScrollTarget;
    if (targetSel) {
      const el = document.querySelector(targetSel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setTimeout(() => {
      this.updateLayout();
    }, 180);
    setTimeout(() => {
      this.updateLayout();
    }, 380);
  }

  private updateLayout() {
    if (this.currentStep.isIntro || !this.currentStep.callouts) {
      this.cdr.detectChanges();
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(350, Math.max(290, vw - 48));
    const cardHeight = 175;

    this.currentStep.callouts.forEach((item, index) => {
      item.arrowMarkerId = 'arrow-marker-' + index;
      const el = document.querySelector(item.targetSelector);
      if (!el) {
        item.targetRect = undefined;
        item.cardRect = undefined;
        item.pathD = undefined;
        return;
      }

      const rect = el.getBoundingClientRect();
      item.targetRect = rect;

      // Calculate desired card top / left based on placement
      let cLeft = rect.left;
      let cTop = rect.bottom + 35;

      switch (item.placement) {
        case 'bottom':
          cLeft = rect.left + (rect.width - cardWidth) / 2;
          cTop = rect.bottom + 35;
          break;
        case 'bottom-left':
          cLeft = rect.left - 30;
          cTop = rect.bottom + 35;
          break;
        case 'bottom-right':
          cLeft = rect.right - cardWidth + 30;
          cTop = rect.bottom + 35;
          break;
        case 'top':
          cLeft = rect.left + (rect.width - cardWidth) / 2;
          cTop = rect.top - cardHeight - 35;
          break;
        case 'top-left':
          cLeft = rect.left - 30;
          cTop = rect.top - cardHeight - 35;
          break;
        case 'top-right':
          cLeft = rect.right - cardWidth + 30;
          cTop = rect.top - cardHeight - 35;
          break;
        case 'left':
          cLeft = rect.left - cardWidth - 35;
          cTop = rect.top + (rect.height - cardHeight) / 2;
          break;
        case 'right':
          cLeft = rect.right + 35;
          cTop = rect.top + (rect.height - cardHeight) / 2;
          break;
      }

      // Add custom offsets
      if (item.offsetX) cLeft += item.offsetX;
      if (item.offsetY) cTop += item.offsetY;

      // Clamping to visible viewport (accounting for top bar and bottom HUD)
      cLeft = Math.max(18, Math.min(vw - cardWidth - 18, cLeft));
      cTop = Math.max(76, Math.min(vh - cardHeight - 90, cTop));

      item.cardRect = {
        left: Math.round(cLeft),
        top: Math.round(cTop),
        width: Math.round(cardWidth),
        height: Math.round(cardHeight)
      };

      // Determine Arrow Start (on element border) and Arrow End (on card border)
      let startX = rect.left + rect.width / 2;
      let startY = rect.bottom;
      let endX = cLeft + cardWidth / 2;
      let endY = cTop;

      if (cTop >= rect.bottom) {
        // Card is below element
        startY = rect.bottom + 4;
        startX = Math.max(rect.left + 10, Math.min(rect.right - 10, cLeft + cardWidth / 2));
        endY = cTop;
        endX = Math.max(cLeft + 20, Math.min(cLeft + cardWidth - 20, startX));
      } else if (cTop + cardHeight <= rect.top) {
        // Card is above element
        startY = rect.top - 4;
        startX = Math.max(rect.left + 10, Math.min(rect.right - 10, cLeft + cardWidth / 2));
        endY = cTop + cardHeight;
        endX = Math.max(cLeft + 20, Math.min(cLeft + cardWidth - 20, startX));
      } else if (cLeft >= rect.right) {
        // Card is to the right of element
        startX = rect.right + 4;
        startY = Math.max(rect.top + 10, Math.min(rect.bottom - 10, cTop + cardHeight / 2));
        endX = cLeft;
        endY = Math.max(cTop + 20, Math.min(cTop + cardHeight - 20, startY));
      } else {
        // Card is to the left of element
        startX = rect.left - 4;
        startY = Math.max(rect.top + 10, Math.min(rect.bottom - 10, cTop + cardHeight / 2));
        endX = cLeft + cardWidth;
        endY = Math.max(cTop + 20, Math.min(cTop + cardHeight - 20, startY));
      }

      item.startX = Math.round(startX);
      item.startY = Math.round(startY);
      item.endX = Math.round(endX);
      item.endY = Math.round(endY);

      // Generate smooth cubic bezier curve
      const dx = endX - startX;
      const dy = endY - startY;

      let cp1X = startX;
      let cp1Y = startY;
      let cp2X = endX;
      let cp2Y = endY;

      if (Math.abs(dy) >= Math.abs(dx)) {
        // Vertical dominant curve
        cp1Y = startY + dy * 0.55;
        cp2Y = endY - dy * 0.15;
        cp2X = endX;
      } else {
        // Horizontal dominant curve
        cp1X = startX + dx * 0.55;
        cp2X = endX - dx * 0.15;
        cp2Y = endY;
      }

      item.pathD = `M ${Math.round(startX)} ${Math.round(startY)} C ${Math.round(cp1X)} ${Math.round(cp1Y)}, ${Math.round(cp2X)} ${Math.round(cp2Y)}, ${Math.round(endX)} ${Math.round(endY)}`;
    });

    this.cdr.detectChanges();
  }
}
