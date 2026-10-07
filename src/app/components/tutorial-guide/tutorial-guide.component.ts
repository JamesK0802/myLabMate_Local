import { Component, EventEmitter, Input, Output, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormArray } from '@angular/forms';
import { AppStateService } from '../../services/app-state.service';

export interface AdvantageCard {
  title: string;
  desc: string;
  badge?: string;
}

export interface GuideStep {
  id: string;
  stageName: string;
  headline: string;
  introLine?: string;
  cards?: AdvantageCard[];
  comparisonColumns?: Array<{
    colTitle: string;
    items: Array<{ label: string; desc: string }>;
  }>;
  paramItems?: Array<{ name: string; desc: string }>;
  textLines?: string[];
  targetSelector?: string;
  isIntro?: boolean;
  isPrereq?: boolean;
  isFinal?: boolean;
  nextButtonText?: string;
  interactiveAction?: 'create_guide_tab' | 'load_demo_files' | 'open_autofill' | 'load_demo_targets' | 'open_window_check' | 'test_curation' | 'click_export' | 'switch_to_viewer';
  actionPromptText?: string;
  actionSuccessText?: string;
}

@Component({
  selector: 'app-tutorial-guide',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="guide-root" [class.no-target]="!targetRect" (keydown.escape)="closeGuide()" tabindex="0">

      <!-- ── Top-Left Fixed Previous Button ── -->
      <button type="button"
              class="btn-top-prev"
              *ngIf="currentStepIndex > 0"
              (click)="prevStep()"
              title="Previous Step (←)">
        ◀ Previous
      </button>

      <!-- ── Top-Right Fixed Exit Guide Button ── -->
      <button type="button" class="btn-top-exit" (click)="closeGuide()" title="Exit Guide (Esc)">
        Exit Guide ✕
      </button>

      <!-- ── Spotlight Cutout with 0% Tint Inside (Clean border without text label) ── -->
      <div class="spotlight-hole"
           *ngIf="targetRect"
           [style.top.px]="targetRect.top - 6"
           [style.left.px]="targetRect.left - 6"
           [style.width.px]="targetRect.width + 12"
           [style.height.px]="targetRect.height + 12">
      </div>

      <!-- ── SVG Curved Dashed Arrow from Target to Speech Bubble ── -->
      <svg class="arrow-svg-layer" *ngIf="targetRect && pathD">
        <defs>
          <marker id="guide-arrowhead"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse">
            <polygon points="0 1, 9 5, 0 9" fill="#f59e0b" />
          </marker>
        </defs>

        <!-- Origin Dot on the Spotlight Border -->
        <circle [attr.cx]="arrowStartX" [attr.cy]="arrowStartY" r="4.5" fill="#f59e0b" />
        <circle [attr.cx]="arrowStartX" [attr.cy]="arrowStartY" r="8" fill="none" stroke="#f59e0b" stroke-width="1.5" class="pulse-ring" />

        <!-- Curved Dashed Connector Arrow -->
        <path [attr.d]="pathD"
              stroke="#f59e0b"
              stroke-width="2.5"
              stroke-dasharray="6,4"
              fill="none"
              class="animated-dashed-arrow"
              marker-end="url(#guide-arrowhead)" />
      </svg>

      <!-- ── Character on Left + Speech Bubble on Right ── -->
      <div class="guide-dialog-wrapper"
           [class.is-centered]="!targetRect"
           [class.is-large-dialog]="currentStep.isIntro || currentStep.isPrereq"
           [ngStyle]="targetRect ? cardStyle : {}">

        <!-- Character Column (Left) -->
        <div class="mascot-col">
          <div class="mascot-avatar-frame">
            <img [src]="currentStepIndex === 0 ? 'casmango-mascot-wave.png' : 'casmango-mascot-idle.png'"
                 alt="CasMANGO Mascot"
                 class="mascot-avatar-img" />
          </div>
          <span class="mascot-tag">CasMANGO</span>
        </div>

        <!-- Speech Bubble (Right) -->
        <div class="bubble-content">
          <h2 class="bubble-headline">{{ currentStep.headline }}</h2>

          <!-- Acronym Breakdown (Single line sentence with C, A, S, M, A, N, G, O highlighted) -->
          <div class="acronym-sentence" *ngIf="currentStep.isIntro && guideMode === 'analysis'">
            <span class="acro-letter">C</span>RISPR
            <span class="acro-letter">A</span>mplicon
            <span class="acro-letter">S</span>equencing with
            <span class="acro-letter">M</span>ultiplexed
            <span class="acro-letter">A</span>ssignment of
            <span class="acro-letter">N</span>GS reads for
            <span class="acro-letter">G</span>enotyping and
            <span class="acro-letter">O</span>utcome analysis
          </div>

          <!-- 1-line tool explanation -->
          <p class="bubble-intro-line" *ngIf="currentStep.introLine">
            {{ currentStep.introLine }}
          </p>

          <!-- Interactive 4-Card Selection Grid for Guide Hub -->
          <div class="hub-cards-grid" *ngIf="guideMode === 'hub'">
            <div class="hub-card"
                 *ngFor="let card of currentStep.cards; let i = index"
                 (click)="selectGuideFromHub(card.title)">
              <div class="hub-card-header">
                <span class="hub-card-badge">{{ card.badge }}</span>
                <span class="hub-card-arrow">▶</span>
              </div>
              <h3 class="hub-card-title">{{ card.title }}</h3>
              <p class="hub-card-desc">{{ card.desc }}</p>
              <button type="button" class="btn-hub-start">Start Guide</button>
            </div>
          </div>

          <!-- 3 Advantage Cards (Intro & Prereq) -->
          <div class="cards-grid" *ngIf="guideMode !== 'hub' && currentStep.cards && currentStep.cards.length > 0">
            <div class="grid-card" *ngFor="let card of currentStep.cards">
              <span class="grid-card-badge" *ngIf="card.badge">{{ card.badge }}</span>
              <h3 class="grid-card-title">{{ card.title }}</h3>
              <p class="grid-card-desc">{{ card.desc }}</p>
            </div>
          </div>

          <!-- Side-by-Side Comparison Columns (Platform / Mode / 3 Charts) -->
          <div class="comparison-grid"
               [class.three-cols]="currentStep.comparisonColumns.length === 3"
               *ngIf="currentStep.comparisonColumns">
            <div class="comp-col" *ngFor="let col of currentStep.comparisonColumns">
              <h4 class="comp-col-title">{{ col.colTitle }}</h4>
              <div class="comp-item" *ngFor="let item of col.items">
                <span class="comp-item-label">{{ item.label }}</span>
                <p class="comp-item-desc">{{ item.desc }}</p>
              </div>
            </div>
          </div>

          <!-- Parameter Specific Items List (Clean, not bulky) -->
          <div class="params-list" *ngIf="currentStep.paramItems">
            <div class="param-row" *ngFor="let p of currentStep.paramItems">
              <strong class="param-name">{{ p.name }}:</strong>
              <span class="param-desc">{{ p.desc }}</span>
            </div>
          </div>

          <!-- Text lines with Markdown bold support -->
          <div class="text-lines-block" *ngIf="currentStep.textLines && currentStep.textLines.length > 0">
            <p class="text-line" *ngFor="let line of currentStep.textLines" [innerHTML]="formatMarkdown(line)"></p>
          </div>

          <!-- Interactive Action Status Prompt (Clean yellow box without emojis) -->
          <div class="interactive-status-row" *ngIf="currentStep.interactiveAction">
            <div class="status-pill status-prompt" *ngIf="!isCurrentActionCompleted">
              <span class="pulse-indicator"></span>
              <span>{{ currentStep.actionPromptText }}</span>
            </div>
            <div class="status-pill status-success" *ngIf="isCurrentActionCompleted">
              <span class="check-mark">✓</span>
              <span>{{ currentStep.actionSuccessText }}</span>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="bubble-footer">
            <button type="button"
                    class="btn-hub-return"
                    *ngIf="guideMode !== 'hub'"
                    (click)="returnToHub()"
                    title="Return to Guide Selection Hub">
              All Guides Hub
            </button>

            <ng-container *ngIf="guideMode === 'hub'">
              <button type="button" class="btn-secondary-action" (click)="closeGuide()">
                Close ✕
              </button>
            </ng-container>

            <ng-container *ngIf="guideMode !== 'hub' && !currentStep.isFinal">
              <button type="button"
                      class="btn-guide-next"
                      [disabled]="!isNextButtonEnabled"
                      (click)="nextStep()">
                {{ currentStep.nextButtonText || 'Next ▶' }}
              </button>
            </ng-container>

            <!-- Final Step of Any Tour: Hub, Next Tour, or Exit -->
            <ng-container *ngIf="guideMode !== 'hub' && currentStep.isFinal">
              <div class="final-actions-group">
                <button type="button"
                        class="btn-secondary-action"
                        (click)="closeGuide()">
                  Exit Guide ✕
                </button>
                <button type="button"
                        class="btn-guide-next"
                        *ngIf="guideMode === 'analysis'"
                        (click)="startResultsGuide()">
                  Next: Results Guide ▶
                </button>
                <button type="button"
                        class="btn-guide-next"
                        *ngIf="guideMode === 'result'"
                        (click)="startSequenceWorkspaceGuide()">
                  Next: Sequence Viewer Guide ▶
                </button>
                <button type="button"
                        class="btn-guide-next"
                        *ngIf="guideMode === 'workspace'"
                        (click)="startBenchmarkGuide()">
                  Next: Benchmark Guide ▶
                </button>
                <button type="button"
                        class="btn-guide-next"
                        *ngIf="guideMode === 'benchmark'"
                        (click)="returnToHub()">
                  Back to Hub ▶
                </button>
              </div>
            </ng-container>
          </div>
        </div>
      </div>

      <!-- ── Screen Bottom Overall Progress Bar ── -->
      <div class="screen-progress-track">
        <div class="screen-progress-fill" [style.width.%]="progressPercent"></div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    /* ── Fullscreen Overlay (Higher than all page elements, lets clicks pass through) ── */
    .guide-root {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      min-height: 100%;
      z-index: 99990;
      outline: none;
      pointer-events: none;
      user-select: none;
    }

    /* Backdrop when on Intro / Prereq without target spotlight */
    .guide-root.no-target {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Top-Left Fixed Previous Button ── */
    .btn-top-prev {
      position: fixed;
      top: 18px;
      left: 24px;
      z-index: 100010;
      pointer-events: auto;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.04em;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
    }

    .btn-top-prev:hover {
      background: #f59e0b;
      color: #0f172a;
      border-color: #f59e0b;
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(245, 158, 11, 0.4);
    }

    /* ── Top-Right Fixed Exit Guide Button ── */
    .btn-top-exit {
      position: fixed;
      top: 18px;
      right: 24px;
      z-index: 100010;
      pointer-events: auto;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.04em;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      backdrop-filter: blur(4px);
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      transition: all 0.2s ease;
    }

    .btn-top-exit:hover {
      background: #ef4444;
      border-color: #ef4444;
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(239, 68, 68, 0.4);
    }

    /* ── Spotlight Cutout with 0% Tint Inside (Clean border without label) ── */
    .spotlight-hole {
      position: absolute;
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.52);
      border: 2px solid #f59e0b;
      pointer-events: none;
      z-index: 99995;
      animation: pulseBorder 2.5s infinite ease-in-out;
      background: transparent !important;
    }

    @keyframes pulseBorder {
      0%, 100% { border-color: #f59e0b; box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.52), 0 0 15px rgba(245, 158, 11, 0.45); }
      50% { border-color: #fbbf24; box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.52), 0 0 25px rgba(251, 191, 36, 0.65); }
    }

    /* ── SVG Arrow Layer ── */
    .arrow-svg-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 99997;
    }

    .animated-dashed-arrow {
      animation: dashFlow 1.2s linear infinite;
    }

    @keyframes dashFlow {
      from { stroke-dashoffset: 20; }
      to { stroke-dashoffset: 0; }
    }

    .pulse-ring {
      animation: ringExpand 2s infinite ease-out;
      transform-origin: center;
    }

    @keyframes ringExpand {
      0% { r: 5; opacity: 1; }
      100% { r: 12; opacity: 0; }
    }

    /* ── Dialog Wrapper: Highest z-index on page, placed once in document flow ── */
    .guide-dialog-wrapper {
      position: absolute;
      z-index: 100000;
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 18px;
      pointer-events: auto;
      max-width: 90vw;
      animation: dialogPop 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .guide-dialog-wrapper.is-centered {
      position: relative;
      margin: auto;
      max-width: 820px;
      width: 90%;
    }

    .guide-dialog-wrapper.is-large-dialog {
      max-width: 860px;
    }

    @keyframes dialogPop {
      from { transform: scale(0.97); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    /* ── Character Mascot Column (Left) ── */
    .mascot-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      margin-top: 4px;
    }

    .mascot-avatar-frame {
      position: relative;
      width: 100px;
      height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .mascot-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.22));
      animation: mascotFloat 3s ease-in-out infinite;
    }

    @keyframes mascotFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }

    .mascot-tag {
      font-size: 11px;
      font-weight: 800;
      color: #ffffff;
      background: rgba(15, 23, 42, 0.85);
      padding: 3px 10px;
      border-radius: 999px;
      letter-spacing: 0.04em;
    }

    /* ── Speech Bubble (Right) ── */
    .bubble-content {
      position: relative;
      background: #ffffff;
      color: #1e293b;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      box-shadow: 0 20px 45px -8px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.06);
      padding: 24px 28px 20px 28px;
      flex: 1;
      min-width: 0;
    }

    .bubble-headline {
      margin: 0 0 10px 0;
      font-size: 20px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.02em;
    }

    /* ── Acronym Single-Line Sentence ── */
    .acronym-sentence {
      margin: 0 0 14px 0;
      font-size: 13.5px;
      font-weight: 600;
      color: #334155;
      line-height: 1.55;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 9px 15px;
      text-align: center;
    }

    .acro-letter {
      color: #ea580c;
      font-weight: 900;
      font-size: 15px;
    }

    .bubble-intro-line {
      margin: 0 0 16px 0;
      font-size: 14px;
      color: #475569;
      line-height: 1.55;
    }

    /* ── 3 Cards Grid (Intro & Prereq) ── */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 16px;
    }

    .grid-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 14px 12px 14px;
      display: flex;
      flex-direction: column;
    }

    .grid-card-badge {
      font-size: 10px;
      font-weight: 900;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
    }

    .grid-card-title {
      margin: 0 0 4px 0;
      font-size: 14.5px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.35;
    }

    .grid-card-desc {
      margin: 0;
      font-size: 12px;
      color: #475569;
      line-height: 1.45;
    }

    /* ── 4 Hub Cards Grid (Guide Selection) ── */
    .hub-cards-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }

    .hub-card {
      background: #f8fafc;
      border: 2px solid #e2e8f0;
      border-radius: 14px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
    }

    .hub-card:hover {
      background: #ffffff;
      border-color: #f59e0b;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.18);
      transform: translateY(-2px);
    }

    .hub-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .hub-card-badge {
      font-size: 11px;
      font-weight: 900;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: #fff7ed;
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid #ffedd5;
    }

    .hub-card-arrow {
      color: #f59e0b;
      font-size: 13px;
      font-weight: 800;
      transition: transform 0.2s ease;
    }

    .hub-card:hover .hub-card-arrow {
      transform: translateX(3px);
    }

    .hub-card-title {
      margin: 0 0 6px 0;
      font-size: 15.5px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.35;
    }

    .hub-card-desc {
      margin: 0 0 14px 0;
      font-size: 12.5px;
      color: #475569;
      line-height: 1.48;
      flex: 1;
    }

    .btn-hub-start {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      color: #ffffff;
      border: none;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      align-self: flex-start;
      box-shadow: 0 3px 10px rgba(234, 88, 12, 0.25);
      pointer-events: none;
    }

    /* ── Comparison Columns (Platform / Mode / 3 Charts) ── */
    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
    }

    .comparison-grid.three-cols {
      grid-template-columns: repeat(3, 1fr);
    }

    .comp-col {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .comp-col-title {
      margin: 0;
      font-size: 13px;
      font-weight: 900;
      color: #0f172a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1.5px solid #e2e8f0;
      padding-bottom: 6px;
    }

    .comp-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .comp-item-label {
      font-size: 13px;
      font-weight: 800;
      color: #ea580c;
    }

    .comp-item-desc {
      margin: 0;
      font-size: 12px;
      color: #475569;
      line-height: 1.4;
    }

    /* ── Parameters Clean List ── */
    .params-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
    }

    .param-row {
      font-size: 12.5px;
      line-height: 1.45;
    }

    .param-name {
      color: #0f172a;
      margin-right: 6px;
    }

    .param-desc {
      color: #475569;
    }

    /* ── Text lines ── */
    .text-lines-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 14px;
    }

    .text-line {
      margin: 0;
      font-size: 13.5px;
      color: #334155;
      line-height: 1.5;
    }

    /* ── Interactive Action Status Prompt (Yellow / Amber Highlight Box) ── */
    .interactive-status-row {
      margin-top: 12px;
      margin-bottom: 6px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.01em;
    }

    .status-pill.status-prompt {
      background: #fef3c7;
      border: 1px solid #fde68a;
      color: #92400e;
    }

    .pulse-indicator {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #d97706;
      box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.7);
      animation: pulseDot 1.5s infinite;
      flex-shrink: 0;
    }

    @keyframes pulseDot {
      0% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.7); }
      70% { box-shadow: 0 0 0 8px rgba(217, 119, 6, 0); }
      100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0); }
    }

    .status-pill.status-success {
      background: #dcfce7;
      border: 1px solid #bbf7d0;
      color: #15803d;
    }

    .check-mark {
      font-weight: 900;
    }

    /* ── Footer Actions ── */
    .bubble-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 10px;
      border-top: 1px solid #f1f5f9;
      padding-top: 14px;
    }

    .btn-guide-next {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      color: #ffffff;
      border: none;
      padding: 9px 22px;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 800;
      letter-spacing: 0.02em;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(234, 88, 12, 0.35);
      transition: all 0.15s ease;
    }

    .btn-guide-next:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(234, 88, 12, 0.45);
    }

    .btn-guide-next:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      box-shadow: none;
    }

    .btn-hub-return {
      background: #f8fafc;
      color: #64748b;
      border: 1px solid #cbd5e1;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      margin-right: auto;
      transition: all 0.15s ease;
    }

    .btn-hub-return:hover {
      background: #f1f5f9;
      color: #0f172a;
      border-color: #94a3b8;
    }

    .final-actions-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .btn-secondary-action {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
      padding: 9px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-secondary-action:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    /* ── Bottom Progress Bar ── */
    .screen-progress-track {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 5px;
      background: rgba(255, 255, 255, 0.15);
      z-index: 100009;
    }

    .screen-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #ea580c);
      transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.8);
    }

    @media (max-width: 768px) {
      .cards-grid, .comparison-grid {
        grid-template-columns: 1fr;
      }
      .guide-dialog-wrapper {
        flex-direction: column;
        align-items: stretch;
      }
      .mascot-col {
        flex-direction: row;
        align-items: center;
      }
      .bubble-content {
        padding: 18px;
      }
    }
  `]
})
export class TutorialGuideComponent implements OnInit, OnDestroy {
  @Input() initialMode: 'hub' | 'analysis' | 'result' | 'workspace' | 'benchmark' = 'hub';
  @Output() close = new EventEmitter<void>();
  @Output() requestTab = new EventEmitter<'analysis' | 'viewer' | 'benchmark' | 'workspace'>();

  guideMode: 'hub' | 'analysis' | 'result' | 'workspace' | 'benchmark' = 'hub';
  currentStepIndex = 0;

  targetRect: { top: number; left: number; width: number; height: number; bottom: number; right: number } | null = null;
  cardStyle: { [key: string]: string } = {};

  arrowStartX = 0;
  arrowStartY = 0;
  arrowEndX = 0;
  arrowEndY = 0;
  pathD = '';

  guideTabId: string | null = null;
  guideTabCreated = false;
  demoFilesLoaded = false;
  demoTargetsLoaded = false;
  isAutofillOpen = false;
  windowCheckOpened = false;

  // Result Guide specific interactive flags
  curationTested = false;
  exportTested = false;
  viewerLoaded = false;

  private rafId: number | null = null;
  private boundCaptureClick = (event: MouseEvent) => this.onCaptureClick(event);

  steps: GuideStep[] = [
    // ── 0. Intro (Overview with Acronym) ──
    {
      id: 'intro',
      stageName: 'Introduction',
      headline: "Hi! I'm CasMANGO",
      introLine: 'CasMANGO is a 100% client-side web application built to accurately assign reads and analyze multiplexed CRISPR editing outcomes directly in your browser with zero server uploads.',
      cards: [
        {
          badge: 'Security & Privacy',
          title: '100% Client-Side Engine',
          desc: 'All sequencing reads are processed locally in your browser via Web Workers—zero files uploaded to external servers.'
        },
        {
          badge: 'Platform Agnostic',
          title: 'Illumina & Nanopore',
          desc: 'Supports short-read Illumina single/paired-end (with automated mate linking & gap X-padding) and long-read Oxford Nanopore amplicons.'
        },
        {
          badge: 'Polyploid Specialty',
          title: 'Ambiguity-Aware Assignment',
          desc: 'Retains uncertain reads in an explicit ambiguous group to prevent cross-misassignment among near-identical homeologs.'
        }
      ],
      nextButtonText: 'Next ▶',
      isIntro: true
    },

    // ── 1. Prerequisites ──
    {
      id: 'prerequisites',
      stageName: 'Prerequisites',
      headline: 'What You Need to Prepare',
      introLine: 'You only need 3 core inputs to begin analyzing your CRISPR editing outcomes:',
      cards: [
        {
          badge: 'Input 1',
          title: 'FASTQ File(s)',
          desc: 'Supported formats: .fastq, .fq, .fastq.gz, .fq.gz (from Illumina single/paired-end or Oxford Nanopore).'
        },
        {
          badge: 'Input 2',
          title: 'Gene Reference Sequence(s)',
          desc: 'The wild-type genomic sequence(s) against which sequencing reads are aligned and compared.'
        },
        {
          badge: 'Input 3',
          title: 'gRNA Target Sequence(s)',
          desc: 'Guide spacer sequence(s) used to define double-strand cleavage cut sites and target loci.'
        }
      ],
      nextButtonText: 'Start Interactive Tour ▶',
      isPrereq: true
    },

    // ── 2. Analysis Tabs ──
    {
      id: 'analysis-tabs',
      stageName: 'Analysis Tabs',
      headline: 'Open a Guide Analysis Tab',
      textLines: [
        '• CasMANGO allows managing multiple independent analysis sessions simultaneously in your browser.'
      ],
      targetSelector: '#guide-tabs-bar',
      interactiveAction: 'create_guide_tab',
      actionPromptText: 'Click the (+) button on the tabs bar to create a tab and proceed',
      actionSuccessText: 'Guide Analysis tab created! Click Next to continue.',
      nextButtonText: 'Next: Platform & Mode ▶'
    },

    // ── 3. Platform & Reference Mode ──
    {
      id: 'platform-mode',
      stageName: 'Platform & Mode',
      headline: 'Platform & Reference Mode',
      comparisonColumns: [
        {
          colTitle: 'Sequencing Platform',
          items: [
            { label: 'Nanopore', desc: 'Long-read amplicon alignment with terminal anchor checks.' },
            { label: 'Illumina', desc: 'Short-read single & paired-end sequencing with automated R1/R2 linking and gap X-padding.' }
          ]
        },
        {
          colTitle: 'Reference Mode',
          items: [
            { label: 'Standard', desc: 'Independent locus analysis (default for single-gene experiments).' },
            { label: 'Homeolog', desc: 'Same core analysis, plus additionally computes inter-subgenome relationships in the result dashboard.' }
          ]
        }
      ],
      targetSelector: '#guide-platform-section',
      nextButtonText: 'Next ▶'
    },

    // ── 4. File Upload ──
    {
      id: 'file-upload',
      stageName: 'File Upload',
      headline: 'Upload FASTQ Sequencing Files',
      textLines: [
        '• Supports .fastq and .gz files (Illumina pairs link automatically by name).'
      ],
      targetSelector: '#guide-upload-zone',
      interactiveAction: 'load_demo_files',
      actionPromptText: 'Click the upload zone to load the demo dataset (CPC, TRY, Pooled)',
      actionSuccessText: 'Demo files loaded (CPC, TRY, Pooled)! Click Next to continue.',
      nextButtonText: 'Next: Targets ▶'
    },

    // ── 5. Reference Sequence(s) & Target(s) ──
    {
      id: 'ref-config',
      stageName: 'Ref & Targets',
      headline: 'Reference Sequence(s) & Target(s)',
      textLines: [
        '• Enter wild-type amplicon sequence(s) and gRNA spacer(s). Cut sites and PAM coordinates are determined automatically.',
        '• Supports multiple guide RNAs per amplicon as well as separate gene loci.'
      ],
      targetSelector: '#guide-targets-section',
      nextButtonText: 'Next ▶'
    },

    // ── 6. Reference Configuration Actions ──
    {
      id: 'ref-configuration-actions',
      stageName: 'Config Options',
      headline: 'Batch Setup & Auto Fill',
      textLines: [
        '• Config per File assigns distinct reference amplicons to individual FASTQ libraries in pooled runs.'
      ],
      targetSelector: '#guide-autofill-btn',
      interactiveAction: 'open_autofill',
      actionPromptText: 'Click Auto Fill to expand the batch Excel configuration toolset',
      actionSuccessText: 'Auto Fill toolset opened! Click Next to view tools.',
      nextButtonText: 'Next: Auto Fill Tools ▶'
    },

    // ── 7. Auto Fill Toolset & Demo Reference Loading ──
    {
      id: 'autofill-panel',
      stageName: 'Auto Fill (Excel)',
      headline: 'Batch Configuration via Excel',
      paramItems: [
        { name: '1. Download Template', desc: 'Get an empty pre-formatted Excel template for batch target entry.' },
        { name: '2. Download Current Config', desc: 'Export your currently active gene & guide setups to an Excel workbook.' },
        { name: '3. Upload Sequence (Excel)', desc: 'Batch-import references and gRNAs to configure all defaults at once.' },
        { name: '4. Apply to Current File', desc: 'Apply an Excel sheet override only to the currently selected FASTQ library.' }
      ],
      targetSelector: '#guide-autofill-upload-btn',
      interactiveAction: 'load_demo_targets',
      actionPromptText: 'Click Upload Sequence (Excel) to load demo references and proceed',
      actionSuccessText: 'Demo CPC & TRY references loaded! Click Next to continue.',
      nextButtonText: 'Next ▶'
    },

    // ── 8. Window Check ──
    {
      id: 'window-check',
      stageName: 'Window Check',
      headline: 'Window Check: Compare Locus Windows',
      textLines: [
        '• Window Check compares extracted cut-site windows across amplicons to measure sequence similarity.'
      ],
      targetSelector: '#guide-window-check-btn',
      interactiveAction: 'open_window_check',
      actionPromptText: 'Click Window Check to view comparison and proceed',
      actionSuccessText: 'Window Check opened! Click Next to continue.',
      nextButtonText: 'Next ▶'
    },

    // ── 9. Core Parameters ──
    {
      id: 'core-parameters',
      stageName: 'Core Parameters',
      headline: 'Core Alignment Thresholds',
      paramItems: [
        { name: 'Window Size (bp)', desc: 'Total analyzed sequence width centered around the cleavage site (default: 30 bp).' },
        { name: 'Data Filtering (Phred)', desc: 'Minimum Phred base-calling score to filter out low-confidence reads.' },
        { name: 'Assignment Margin (%)', desc: 'Score advantage required to assign a read and eliminate cross-calling.' },
        { name: 'Indel Threshold (%)', desc: 'Noise floor filter to exclude background sequencing errors.' }
      ],
      targetSelector: '#guide-controls-grid',
      nextButtonText: 'Next: Advanced ▶'
    },

    // ── 10. Advanced Parameters (Auto-expanded) ──
    {
      id: 'advanced-parameters',
      stageName: 'Advanced Settings',
      headline: 'Mutation Resilience & Custom Window',
      paramItems: [
        { name: 'Cut Site Exclusion Window', desc: 'Excludes mutations within cut site ±N bp from similarity calculations to prevent large deletions from distorting reference assignment.' },
        { name: 'Distance Weight', desc: 'Assigns higher weight to sequence differences (e.g. SNVs) located further from the cut site.' },
        { name: 'Custom Window', desc: 'Configures independent asymmetric Left and Right flank window boundaries around the cut site.' }
      ],
      targetSelector: '#guide-advanced-panel',
      nextButtonText: 'Next ▶'
    },

    // ── 11. Run Analysis & Viewers ──
    {
      id: 'run-and-view',
      stageName: 'Execution',
      headline: 'Start Analysis & View Outcomes',
      textLines: [
        '• Click Start Local Analysis to run hardware-accelerated Web Workers with live progress bars.',
        '• Export comprehensive results to Excel (.xlsx) and drop them into Result Viewer anytime, or inspect accuracy in the Benchmark tab.',
        '• When you exit the guide, the "Guide Analysis" tab will be closed automatically, restoring your original workspace cleanly.'
      ],
      targetSelector: '#guide-run-btn',
      isFinal: true
    }
  ];

  hubSteps: GuideStep[] = [
    {
      id: 'hub',
      stageName: 'Guide Selection Hub',
      headline: 'Welcome to CasMANGO Guides',
      introLine: 'Select a guide below to explore the end-to-end interactive tutorial for that module:',
      cards: [
        {
          badge: 'Tour 1',
          title: 'CRISPR Analysis',
          desc: 'End-to-end pipeline setup: file upload, reference amplicons & gRNAs, auto fill, window check, and alignment parameters.'
        },
        {
          badge: 'Tour 2',
          title: 'Results & Result Viewer',
          desc: 'Tour results with the Figure 2 synthetic dataset: read filtering flow, metrics, 3 visual charts, annotation tracks, curation, and Excel report reproducibility.'
        },
        {
          badge: 'Tour 3',
          title: 'Sequence Viewer',
          desc: 'Multi-sequence alignment workspace, tree hierarchy, linear map, sequence tracks, and PAM visualization controls.'
        },
        {
          badge: 'Tour 4',
          title: 'Benchmark',
          desc: 'In-browser labeled read ground truth evaluation and Illumina paired-end overlap mate normalization.'
        }
      ],
      isIntro: true
    }
  ];

  workspaceSteps: GuideStep[] = [
    {
      id: 'workspace-overview',
      stageName: 'Sequence Viewer',
      headline: 'Sequence Workspace Overview',
      introLine: 'The Sequence Viewer offers full multi-sequence alignment, feature annotation, and Sanger / NGS read visualization in your browser.',
      cards: [
        {
          badge: 'Explorer',
          title: 'Project Tree',
          desc: 'Organize amplicons, plasmids, Sanger reads, and NGS FASTQ files in hierarchical folders.'
        },
        {
          badge: 'Visualization',
          title: 'Linear & Plasmid Maps',
          desc: 'Interactive high-density sequence tracks with gRNA PAM markers and translation frames.'
        },
        {
          badge: 'Inspector',
          title: 'Feature Inspector',
          desc: 'Inspect sequence properties, GC content, annotations, and export curated sub-sequences.'
        }
      ],
      nextButtonText: 'Next: Project Explorer ▶',
      isIntro: true
    },
    {
      id: 'workspace-explorer',
      stageName: 'Project Explorer',
      headline: 'Project Explorer & File Hierarchy',
      textLines: [
        '• Manage your sequence documents, references, and imported FASTQ reads.',
        '• Click to collapse or expand folders, rename items, and select sequences for viewing.'
      ],
      targetSelector: '#guide-workspace-explorer',
      nextButtonText: 'Next: Main Alignment Viewer ▶'
    },
    {
      id: 'workspace-viewer',
      stageName: 'Main Viewer',
      headline: 'Interactive Sequence Alignment & Maps',
      textLines: [
        '• Zoom and pan across base pairs with single-nucleotide clarity.',
        '• Toggle between linear map, circular plasmid map, and multi-read pairwise alignment views.'
      ],
      targetSelector: '#guide-workspace-viewer',
      nextButtonText: 'Next: Feature Inspector ▶'
    },
    {
      id: 'workspace-inspector',
      stageName: 'Inspector',
      headline: 'Item Inspector & Properties',
      textLines: [
        '• Inspect base composition, GC percentage, translations, and feature annotations.',
        '• Edit features or export clean FASTA sequences directly.'
      ],
      targetSelector: '#guide-workspace-inspector',
      nextButtonText: 'Next: Benchmark Guide ▶'
    },
    {
      id: 'workspace-final',
      stageName: 'Workspace Complete',
      headline: 'Sequence Workspace Tour Complete!',
      introLine: 'You can return to the Guide Hub anytime or proceed to explore the Benchmark module next.',
      cards: [
        {
          badge: 'Next Step',
          title: 'Explore Benchmark',
          desc: 'Verify classification accuracy and Illumina paired-end normalization.'
        }
      ],
      isFinal: true
    }
  ];

  benchmarkSteps: GuideStep[] = [
    {
      id: 'benchmark-overview',
      stageName: 'Benchmark Module',
      headline: 'Deterministic Benchmark & Normalization',
      introLine: 'CasMANGO includes built-in benchmarking utilities to evaluate classification accuracy against labelled datasets and inspect Illumina paired-end normalization.',
      cards: [
        {
          badge: 'Classification',
          title: 'Ground Truth Verification',
          desc: 'Validate assignment precision, cross-calling prevention, and ambiguity handling.'
        },
        {
          badge: 'Illumina',
          title: 'Overlap-Aware Normalization',
          desc: 'Form high-confidence consensus from qualifying mate overlaps or apply window-sized X-guards.'
        }
      ],
      nextButtonText: 'Next: Parameters & Platform ▶',
      isIntro: true
    },
    {
      id: 'benchmark-params',
      stageName: 'Benchmark Parameters',
      headline: 'Analysis Parameters for Benchmark',
      textLines: [
        '• Configure window size, Phred quality filter, and Assignment Margin for benchmark validation.',
        '• Toggle between Nanopore long-read amplicons and Illumina paired-end libraries.'
      ],
      targetSelector: '#guide-bench-params-card',
      nextButtonText: 'Next: Labelled Dataset ▶'
    },
    {
      id: 'benchmark-dataset',
      stageName: 'Dataset Setup',
      headline: 'Labelled Classes & Expected References',
      textLines: [
        '• Add classes with defined ground-truth gene references, gRNA spacers, and test FASTQ reads.',
        '• Run Benchmark to obtain instant confusion metrics (Correct %, Wrong %, Ambiguous %).'
      ],
      targetSelector: '#guide-bench-dataset-card',
      nextButtonText: 'Next: Illumina Normalization ▶'
    },
    {
      id: 'benchmark-final',
      stageName: 'Benchmark Complete',
      headline: 'Benchmark Tour Complete!',
      introLine: 'You have explored all core modules of CasMANGO! Return to the Guide Hub or start analyzing your CRISPR experiments.',
      cards: [
        {
          badge: 'Ready to Run',
          title: 'Start Analyzing',
          desc: 'Load your FASTQ sequencing reads and discover accurate CRISPR outcomes with 100% client-side privacy.'
        }
      ],
      isFinal: true
    }
  ];

  resultSteps: GuideStep[] = [
    // ── R0. Result Introduction (Figure 2 Synthetic Benchmark) ──
    {
      id: 'result-welcome',
      stageName: 'Results Dashboard',
      headline: 'Results & Outcome Analysis',
      introLine: 'Welcome to the Results Guide! We load the Figure 2 synthetic benchmark dataset (single-target CPC Cas9 amplicon) to walk through the read-filtering flow, metric cards, 3 visual charts, mutation annotation tracks, and live curation tools.',
      cards: [
        {
          badge: 'Synthetic Ground Truth',
          title: 'Figure 2 CPC Amplicon',
          desc: 'High-coverage synthetic locus modeled after Figure 2 CPC amplicon with defined cleavage sites and mutation spectrum.'
        },
        {
          badge: 'Filter Transparency',
          title: 'Traceable Read Filtering',
          desc: 'Transparent stage-by-stage tracking: Raw Reads → Phred Passed → Usable for Assignment → Assigned Reads.'
        },
        {
          badge: 'Live Exploration',
          title: 'Interactive Curation',
          desc: 'Exclude or restore individual sequencing files, gene references, targets, or specific mutation groups on the fly.'
        }
      ],
      nextButtonText: 'Next: Read Filtering Flow ▶',
      isIntro: true
    },

    // ── R1. Read Flow & Margin Filter ──
    {
      id: 'result-read-flow',
      stageName: 'Read Flow Analytics',
      headline: 'Read Filtering & Ambiguity Exclusion',
      textLines: [
        '• **Raw Reads**: Initial total sequencing reads read from the FASTQ input file(s).',
        '• **Phred Passed**: Reads passing your minimum Phred average quality threshold.',
        '• **Usable for Assignment**: Filtered reads successfully matching outer flanking amplicon primers/anchors.',
        '• **Assigned Reads**: Reads unambiguously assigned to this target gene reference.',
        '• **Ambiguous Excluded**: Reads where alignment score difference was within your configured **Assignment Margin**—safely segregated to prevent cross-assignment false positives.'
      ],
      targetSelector: '#guide-read-flow-stripe',
      nextButtonText: 'Next: Summary Metrics ▶'
    },

    // ── R2. Summary Metrics Grid ──
    {
      id: 'result-metrics',
      stageName: 'Summary Metrics',
      headline: 'Summary Metrics Cards',
      textLines: [
        '• **Total & Aligned Reads**: Overall read count and percentage successfully assigned to this locus window.',
        '• **Out-of-frame %**: Frame-shifting indel rate (disruptive knockout mutations).',
        '• **In-frame %**: In-frame indels (multiples of 3 bp preserving reading frame).',
        '• **Unmodified %**: Wild-type unedited reads.',
        '• **Substitution %**: Base substitutions tracked in a distinct category according to policy.'
      ],
      targetSelector: '#guide-metrics-grid',
      nextButtonText: 'Next: 3 Visual Charts ▶'
    },

    // ── R3. 3 Visual Charts: Left - Center - Right Breakdown ──
    {
      id: 'result-charts',
      stageName: 'Visual Charts',
      headline: 'Mutation Outcome Charts (Left · Center · Right)',
      comparisonColumns: [
        {
          colTitle: 'Left: Mutation Pie Chart',
          items: [
            { label: 'Classification Ratio', desc: 'Visual proportion of Unmodified (WT), In-frame indels, Out-of-frame frame-shifts, and Substitutions.' },
            { label: 'Instant Focus', desc: 'Identifies dominant genotype class at a glance.' }
          ]
        },
        {
          colTitle: 'Center: Indel Distribution',
          items: [
            { label: 'Indel Size Spectrum', desc: 'High-resolution bar chart showing exact deletion (-) and insertion (+) sizes in nucleotides.' },
            { label: 'Frameshift Detection', desc: 'Colors highlight frameshifting indels vs 3bp-multiple in-frame alterations.' }
          ]
        },
        {
          colTitle: 'Right: Donut Summary',
          items: [
            { label: 'Total Efficiency', desc: 'Total editing efficiency summarizing modified vs unmodified amplicons.' },
            { label: 'Knockout Ratio', desc: 'Fast benchmark gauge for experimental knockout success.' }
          ]
        }
      ],
      targetSelector: '#guide-charts-section',
      nextButtonText: 'Next: Mutation Annotation Track ▶'
    },

    // ── R3. Mutation Annotation Track ──
    {
      id: 'result-annotation',
      stageName: 'Sequence Annotation',
      headline: 'Mutation Annotation Track',
      textLines: [
        '• REFERENCE 5\'→3\': Wild-type genomic reference sequence with the 20nt gRNA track highlighted.',
        '• Cut Site Indicator: Vertical marker marking the predicted Cas9 double-strand break (3 bp upstream of PAM).',
        '• Group Alignment Rows: Sequenced reads grouped by identical variant genotypes.',
        '• Variant Tokens: Hyphen (-) represents deletion, colored bases represent substitutions, and insertions are pinned at position.'
      ],
      targetSelector: '#guide-annotation-panel',
      nextButtonText: 'Next: FASTQ Export & Sequence Viewer ▶'
    },

    // ── R4. Actions in Annotation: FASTQ Download & Sequence Workspace ──
    {
      id: 'result-export-workspace',
      stageName: 'Target Actions',
      headline: 'Read FASTQ Export & Sequence Viewer',
      textLines: [
        '• Download FASTQ: Export all original sequencing reads or specific mutation group reads as standard FASTQ files.',
        '• All Reads in Workspace: Click to instantly open all reads in the Sequence Viewer (Sequence Workspace) with automatic reference alignment pre-configured.'
      ],
      targetSelector: '#guide-all-reads-workspace-btn',
      nextButtonText: 'Next: Test Curation View ▶'
    },

    // ── R5. Interactive Curation: Free Exploration ──
    {
      id: 'result-curation',
      stageName: 'Data Curation',
      headline: 'Interactive Curation View',
      textLines: [
        '• Click Create Curated View below to test filtering out noise or specific groups.',
        '• Once activated, click the (✕) toggle buttons on any file tab, gene tab, summary table target row, or individual mutation group row to exclude them.',
        '• All summary statistics and charts recalculate instantly in real-time!'
      ],
      targetSelector: '#guide-curate-btn',
      interactiveAction: 'test_curation',
      actionPromptText: 'Click "Create Curated View" above and freely toggle exclusions on files, targets, or groups',
      actionSuccessText: 'Curation tested! Statistics recalculated. Click Next to continue.',
      nextButtonText: 'Next: Export Reports ▶'
    },

    // ── R6. Export Excel Reports ──
    {
      id: 'result-export-report',
      stageName: 'Export Reports',
      headline: 'Export Multi-Sheet Excel Reports',
      textLines: [
        '• CasMANGO generates publication-ready Excel reports containing per-file scopes, read-flow summaries, and high-resolution chart images.',
        '• If you curated the data, "Export Curated" includes full curation exclusion records and adjusted statistics alongside original data.'
      ],
      targetSelector: '#guide-export-excel-btn',
      interactiveAction: 'click_export',
      actionPromptText: 'Click "Export Excel" (or "Export Curated") to download your analysis workbook (.xlsx)',
      actionSuccessText: 'Excel report downloaded! Click Next to verify Result Viewer.',
      nextButtonText: 'Next: Reproduce in Result Viewer ▶'
    },

    // ── R7. Result Viewer Reproducibility ──
    {
      id: 'result-viewer-reproduce',
      stageName: 'Result Viewer',
      headline: 'Reproduce Results in Result Viewer',
      textLines: [
        '• Click the Result Viewer tab in the navigation bar.',
        '• Drop or load your exported Excel report into the dropzone to instantly restore the complete analysis dashboard—including any active curation states!'
      ],
      targetSelector: '#guide-viewer-tab-btn',
      interactiveAction: 'switch_to_viewer',
      actionPromptText: 'Click the "Result Viewer" tab in the top navigation bar',
      actionSuccessText: 'Result loaded into Result Viewer! Complete dashboard restored.',
      nextButtonText: 'Next: Sequence Viewer Guide ▶'
    },
    {
      id: 'result-final-hub',
      stageName: 'Results Complete',
      headline: 'Results Guide Complete!',
      introLine: 'You have explored all outcome analytics, annotation tracks, curation options, and Excel reports. What would you like to explore next?',
      cards: [
        {
          badge: 'Next Guide',
          title: 'Sequence Viewer Guide',
          desc: 'Explore the full multi-sequence alignment workspace and plasmid viewer.'
        },
        {
          badge: 'Next Guide',
          title: 'Benchmark Guide',
          desc: 'Explore labeled dataset validation and Illumina paired-end normalization.'
        }
      ],
      isFinal: true
    }
  ];

  constructor(
    public state: AppStateService,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  get currentSteps(): GuideStep[] {
    switch (this.guideMode) {
      case 'hub':
        return this.hubSteps;
      case 'result':
        return this.resultSteps;
      case 'workspace':
        return this.workspaceSteps;
      case 'benchmark':
        return this.benchmarkSteps;
      case 'analysis':
      default:
        return this.steps;
    }
  }

  get currentStep(): GuideStep {
    return this.currentSteps[this.currentStepIndex];
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.currentSteps.length - 1;
  }

  get progressPercent(): number {
    return Math.round(((this.currentStepIndex + 1) / this.currentSteps.length) * 100);
  }

  get currentStepTargetSelector(): string | undefined {
    const step = this.currentStep;
    if (step.id === 'file-upload' && this.demoFilesLoaded) {
      return '#guide-upload-section';
    }
    if (step.id === 'window-check' && this.windowCheckOpened) {
      return '#guide-window-check-panel';
    }
    return step.targetSelector;
  }

  get isCurrentActionCompleted(): boolean {
    const step = this.currentStep;
    if (!step.interactiveAction) return true;
    switch (step.interactiveAction) {
      case 'create_guide_tab':
        return this.guideTabCreated;
      case 'load_demo_files':
        return this.demoFilesLoaded || this.state.selectedFiles.length > 0 || this.state.illuminaPairs.length > 0;
      case 'open_autofill':
        return this.isAutofillOpen || document.querySelector('#guide-autofill-panel') !== null;
      case 'load_demo_targets':
        return this.demoTargetsLoaded;
      case 'open_window_check':
        return this.windowCheckOpened || document.querySelector('#guide-window-check-panel') !== null;
      case 'test_curation':
        return this.curationTested || this.state.isCuratedView;
      case 'click_export':
        return this.exportTested || this.state.lastExportedFile !== null;
      case 'switch_to_viewer':
        return this.viewerLoaded || (this.state.activeMode === 'viewer' && this.state.genes.length > 0);
      default:
        return true;
    }
  }

  get isNextButtonEnabled(): boolean {
    const step = this.currentStep;
    if (step.isIntro || step.isPrereq) return true;
    if (step.interactiveAction) {
      return this.isCurrentActionCompleted;
    }
    return true;
  }

  ngOnInit() {
    this.guideMode = this.initialMode;
    if (this.guideMode === 'result') {
      this.ensureFigure2SyntheticDataLoaded();
    } else {
      this.state.collapseAnalysisPanels();
    }
    window.addEventListener('click', this.boundCaptureClick, true);
    this.handleStepSideEffects();
    this.updateLayoutInstant();
  }

  ngOnDestroy() {
    window.removeEventListener('click', this.boundCaptureClick, true);
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.guideMode === 'analysis') {
      this.removeGuideTab();
    }
  }

  private onCaptureClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target) return;

    // 1. Step: Analysis Tabs - user clicks (+) button
    if (this.currentStep.id === 'analysis-tabs') {
      if (target.closest('#guide-add-tab-btn')) {
        setTimeout(() => {
          this.onTabCreatedByClick();
        }, 80);
      }
    }

    // 2. Step: File Upload - user clicks upload dropzone
    if (this.currentStep.id === 'file-upload') {
      if (target.closest('#guide-upload-zone')) {
        event.preventDefault();
        event.stopPropagation();
        this.loadDemoFiles();
      }
    }

    // 3. Step: Reference Configuration Actions - user clicks Auto Fill button
    if (this.currentStep.id === 'ref-configuration-actions') {
      if (target.closest('#guide-autofill-btn')) {
        this.isAutofillOpen = true;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.nextStep();
        }, 220);
      }
    }

    // 4. Step: Auto Fill Panel - user clicks specifically Upload Sequence (Excel)
    if (this.currentStep.id === 'autofill-panel') {
      if (target.closest('#guide-autofill-upload-btn') || target.closest('.btn-template-upload')) {
        event.preventDefault();
        event.stopPropagation();
        this.loadDemoTargets();
      }
    }

    // 5. Step: Window Check - user clicks Window Check button
    if (this.currentStep.id === 'window-check') {
      if (target.closest('#guide-window-check-btn')) {
        this.windowCheckOpened = true;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.updateLayoutInstant();
        }, 200);
      }
    }

    // 6. Result Guide Step: Test Curation (click curate button or toggle exclusions)
    if (this.currentStep.id === 'result-curation') {
      if (target.closest('#guide-curate-btn') || target.closest('#guide-exit-curate-btn') || target.closest('.exclude-toggle') || target.closest('.exclude-btn-sm') || target.closest('.exclude-btn-group')) {
        this.curationTested = true;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.updateLayoutInstant();
        }, 250);
      }
    }

    // 7. Result Guide Step: Export Excel / Curated
    if (this.currentStep.id === 'result-export-report') {
      if (target.closest('#guide-export-excel-btn') || target.closest('#guide-export-curated-btn')) {
        this.exportTested = true;
        this.cdr.detectChanges();
        setTimeout(() => {
          this.updateLayoutInstant();
        }, 300);
      }
    }

    // 8. Result Guide Step: Reproduce in Result Viewer tab
    if (this.currentStep.id === 'result-viewer-reproduce') {
      if (target.closest('#guide-viewer-tab-btn') || target.closest('.nav-tab')) {
        this.requestTab.emit('viewer');
        setTimeout(() => {
          this.simulateDropIntoResultViewer();
        }, 350);
      }
    }
  }

  private onTabCreatedByClick() {
    this.state.collapseAnalysisPanels();
    const activeTab = this.state.currentTab;
    if (activeTab) {
      this.state.renameTab(activeTab.id, 'Guide Analysis');
      this.guideTabId = activeTab.id;
      this.guideTabCreated = true;
      this.cdr.detectChanges();
    }
  }

  private removeGuideTab() {
    this.closeWindowCheckPanel();
    this.state.collapseAnalysisPanels();
    if (this.guideTabId) {
      const exists = this.state.tabs.some(t => t.id === this.guideTabId);
      if (exists) {
        this.state.closeTab(this.guideTabId);
      }
      this.guideTabId = null;
      this.guideTabCreated = false;
    }
  }

  private closeWindowCheckPanel() {
    const winCloseBtn = document.querySelector('.btn-close-window-check') as HTMLElement;
    if (winCloseBtn) {
      winCloseBtn.click();
    }
    this.windowCheckOpened = false;
  }

  @HostListener('window:resize')
  onResize() {
    this.updateLayoutInstant();
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.closeGuide();
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      if (!this.currentStep.isFinal && this.isNextButtonEnabled) {
        this.nextStep();
      }
    } else if (e.key === 'ArrowLeft') {
      if (this.currentStepIndex > 0) {
        this.prevStep();
      }
    }
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.handleStepSideEffects();
      this.onStepChanged();
    }
  }

  nextStep() {
    if (this.isLastStep) {
      this.closeGuide();
      return;
    }

    if (!this.isNextButtonEnabled) {
      return;
    }

    this.currentStepIndex++;
    this.handleStepSideEffects();
    this.onStepChanged();
  }

  closeGuide() {
    this.closeWindowCheckPanel();
    this.state.collapseAnalysisPanels();
    this.removeGuideTab();
    this.close.emit();
  }

  openResultsGuideComingSoon() {
    this.startResultsGuide();
  }

  /**
   * Converts markdown bolding syntax `**text**` to safe HTML strong tags.
   */
  formatMarkdown(text: string): SafeHtml {
    if (!text) return '';
    const formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    return this.sanitizer.bypassSecurityTrustHtml(formatted);
  }

  /**
   * Handler when a user clicks one of the 4 cards on the Guide Hub.
   */
  selectGuideFromHub(cardTitle: string) {
    if (cardTitle.includes('CRISPR Analysis')) {
      this.startAnalysisGuide();
    } else if (cardTitle.includes('Result')) {
      this.startResultsGuide();
    } else if (cardTitle.includes('Sequence Viewer')) {
      this.startSequenceWorkspaceGuide();
    } else if (cardTitle.includes('Benchmark')) {
      this.startBenchmarkGuide();
    }
  }

  /**
   * Return back to the Guide Selection Hub from any guide.
   */
  returnToHub() {
    this.closeWindowCheckPanel();
    this.state.collapseAnalysisPanels();
    this.guideMode = 'hub';
    this.currentStepIndex = 0;
    this.targetRect = null;
    this.pathD = '';
    this.cardStyle = {};
    this.cdr.detectChanges();
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.updateLayoutInstant();
    }, 120);
  }

  /**
   * Starts the CRISPR Analysis Tour.
   */
  startAnalysisGuide() {
    this.guideMode = 'analysis';
    this.currentStepIndex = 0;
    this.requestTab.emit('analysis');
    this.state.collapseAnalysisPanels();
    this.cdr.detectChanges();
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.handleStepSideEffects();
      this.updateLayoutInstant();
    }, 200);
  }

  /**
   * Switch Tutorial Guide to Results Guide mode and load synthetic Figure 2 dataset if needed.
   */
  startResultsGuide() {
    this.guideMode = 'result';
    this.currentStepIndex = 0;
    this.requestTab.emit('viewer');
    this.ensureFigure2SyntheticDataLoaded();
    this.cdr.detectChanges();
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.handleStepSideEffects();
      this.updateLayoutInstant();
    }, 250);
  }

  /**
   * Starts the Sequence Workspace Tour.
   */
  startSequenceWorkspaceGuide() {
    this.guideMode = 'workspace';
    this.currentStepIndex = 0;
    this.requestTab.emit('workspace');
    this.cdr.detectChanges();
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.handleStepSideEffects();
      this.updateLayoutInstant();
    }, 250);
  }

  /**
   * Starts the Benchmark Tour.
   */
  startBenchmarkGuide() {
    this.guideMode = 'benchmark';
    this.currentStepIndex = 0;
    this.requestTab.emit('benchmark');
    this.cdr.detectChanges();
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.handleStepSideEffects();
      this.updateLayoutInstant();
    }, 250);
  }

  /**
   * Loads realistic Figure 2 synthetic data for the single-target CPC locus.
   */
  private ensureFigure2SyntheticDataLoaded() {
    // If analysisSlot already has loaded genes and results, we don't overwrite
    if (this.state.analysisSlot.genes && this.state.analysisSlot.genes.length > 0) {
      this.state.activateSlot('analysis');
      return;
    }

    const fig2Data = this.generateSyntheticFigure2Result();
    this.state.activateSlot('analysis');
    this.state.loadResultData(fig2Data);
  }

  /**
   * Simulates loading exported Excel into Result Viewer when reaching step R7.
   */
  private simulateDropIntoResultViewer() {
    const file = this.state.lastExportedFile;
    if (file) {
      window.dispatchEvent(new CustomEvent('casmango:guide-load-excel', { detail: { file } }));
      this.viewerLoaded = true;
      this.cdr.detectChanges();
      setTimeout(() => {
        this.updateLayoutInstant();
      }, 250);
    } else {
      // If user skipped direct export button, generate and load Figure 2 data directly into viewer slot
      const fig2Data = this.generateSyntheticFigure2Result();
      this.state.activateSlot('viewer');
      this.state.loadResultData({
        ...fig2Data,
        curationConfig: this.state.isCuratedView ? this.state.curationConfig : null
      });
      this.viewerLoaded = true;
      this.cdr.detectChanges();
      setTimeout(() => {
        this.updateLayoutInstant();
      }, 250);
    }
  }

  /**
   * Generates synthetic Figure 2 single-target Cas9 outcome dataset (CPC amplicon).
   */
  private generateSyntheticFigure2Result(): { params: any; scopes: any[] } {
    const cpcAmplicon = 'AAATTTGAAATTCCTAAGCAATTTTTTCTTCTTATATATATAGATAATTATACATTCCAAAATAGTAATTCAAGGACAGGTACATTTCCTTTTTTTCTTGTCTTGTGAATTAAGGAGAGGAAAATTTTCTTTTAATCCAAACAAAAAAAATCATTTCCTAAAAAAGTCTCTTCGTCTGTTGGCAAAAACGACGCCGTGTTTCATAAGCCAATATCTCTCTATCTCCTCCGGCGTCCGTCCCGGGATCCTTCCGGCGATCAACTCCCACCTACGCGCCACGTAGGATAGGCTAACAGTCAGTGTTGAGGAACTTACACTTAACCAAATACCTTTTATTCCGATAAAAACCGCATAAAGTTTGTAATTCGGTTAAAATTCTATGGAACCGAACCAAAATCGTAATTTACACTTTGACTTCATACAAACATGCTGTAATCAAAATTGAACCAA';
    const grna = 'AATATCTCTCTATCTCCTC';
    
    // 90bp analyzed window centered around cut site 225 (window indices 180..270)
    // Cut site is at index 45 within this 90bp window (3bp upstream of PAM CGG at 48..51)
    const refWindow90 = 'GGCAAAAACGACGCCGTGTTTCATAAGCCAATATCTCTCTATCTCCTCCGGCGTCCGTCCCGGGATCCTTCCGGCGATCAACTCCCACCT';
    const grnaStartInWindow = 29;
    const cutPosInWindow = 45;

    const rawReads = 2500;
    const phredPassed = 2420;
    const usableForAssignment = 2350;
    const assignedReads = 2210;
    const ambiguousReads = 140;

    const topGroups = [
      {
        group_rank: 1,
        read_inner: 'WT_CPC_UNMODIFIED',
        read_count: 1094,
        read_pct: 49.5,
        classification: 'WT / No Indel',
        net_indel: 0,
        tokens: [
          { type: 'equal', val: refWindow90 }
        ]
      },
      {
        group_rank: 2,
        read_inner: 'DEL_1BP_OUT_OF_FRAME',
        read_count: 628,
        read_pct: 28.4,
        classification: 'Out-of-frame Deletion',
        net_indel: -1,
        tokens: [
          { type: 'equal', val: refWindow90.slice(0, 44) },
          { type: 'delete', val: refWindow90.slice(44, 45) },
          { type: 'equal', val: refWindow90.slice(45) }
        ]
      },
      {
        group_rank: 3,
        read_inner: 'INS_1BP_A_OUT_OF_FRAME',
        read_count: 283,
        read_pct: 12.8,
        classification: 'Out-of-frame Insertion',
        net_indel: 1,
        tokens: [
          { type: 'equal', val: refWindow90.slice(0, 45) },
          { type: 'insert', val: 'A' },
          { type: 'equal', val: refWindow90.slice(45) }
        ]
      },
      {
        group_rank: 4,
        read_inner: 'DEL_3BP_IN_FRAME',
        read_count: 150,
        read_pct: 6.8,
        classification: 'In-frame Deletion',
        net_indel: -3,
        tokens: [
          { type: 'equal', val: refWindow90.slice(0, 43) },
          { type: 'delete', val: refWindow90.slice(43, 46) },
          { type: 'equal', val: refWindow90.slice(46) }
        ]
      },
      {
        group_rank: 5,
        read_inner: 'SUB_1BP_T_TO_A',
        read_count: 55,
        read_pct: 2.5,
        classification: 'Substitution',
        net_indel: 0,
        tokens: [
          { type: 'equal', val: refWindow90.slice(0, 44) },
          { type: 'substitute', val: 'T' },
          { type: 'equal', val: refWindow90.slice(45) }
        ]
      }
    ];

    const targetResult = {
      target_id: 't1',
      summary: {
        total_reads: assignedReads,
        matched_reads: assignedReads,
        aligned_reads: assignedReads,
        unmodified: 1094,
        modified: 1061,
        editing_efficiency: 48.0,
        out_of_frame_pct: 41.2,
        in_frame_pct: 6.8,
        no_indel_pct: 52.0,
        substitution_pct: 2.5,
        substitution_reads: 55,
        indel_editing_efficiency: 48.0,
        substitution_policy: 'separate_category_indel_editing_excludes_substitutions',
        failed_reads: 0
      },
      breakdown: {
        no_indel: 1094,
        substitution: 55,
        in_frame: 150,
        out_of_frame: 911,
        failed: 0
      },
      read_details: [],
      ref_sequence: refWindow90,
      cut_site_index: cutPosInWindow,
      sgrna_seq: grna,
      display_sgrna_seq: grna,
      grna_start_index: grnaStartInWindow,
      strand: '+',
      top_groups: topGroups
    };

    const geneResult = {
      gene: 'CPC',
      reference_sequence: cpcAmplicon,
      assigned_read_count: assignedReads,
      ambiguous_excluded: true,
      analysis_result: {
        targets: [targetResult]
      }
    };

    const scopes = [
      {
        sheetName: 'Merged',
        readFlow: {
          rawReads,
          phredPassed,
          anchorMatched: usableForAssignment,
          usableForAssignment,
          assignedReads,
          ambiguousReads
        },
        genes: [geneResult]
      },
      {
        sheetName: 'cpc_sample.fastq.gz',
        readFlow: {
          rawReads,
          phredPassed,
          anchorMatched: usableForAssignment,
          usableForAssignment,
          assignedReads,
          ambiguousReads
        },
        genes: [geneResult]
      }
    ];

    const params = {
      windowSize: 90,
      phredThreshold: 20,
      indelThreshold: 30,
      assignmentMargin: 10,
      rescueThreshold: 0,
      cutSiteDistanceWeight: 0,
      cutSiteExclusionFlank: 0,
      analyzeAmbiguous: false,
      rescueAmbiguous: false,
      dataType: 'Single-Target CPC Amplicon (Figure 2)',
      fileCount: 1,
      sequencingPlatform: 'nanopore'
    };

    return { params, scopes };
  }

  /**
   * Automatically expand panels or prepare UI states required for each step.
   */
  private handleStepSideEffects() {
    const step = this.currentStep;

    // Step: Auto Fill - ensure Auto Fill panel is opened
    if (step.id === 'autofill-panel') {
      const autofillPanel = document.querySelector('#guide-autofill-panel');
      if (!autofillPanel) {
        const autofillBtn = document.querySelector('#guide-autofill-btn') as HTMLElement;
        if (autofillBtn) autofillBtn.click();
      }
      this.isAutofillOpen = true;
    }

    // Step: Advanced Parameters - ensure Advanced panel is expanded
    if (step.id === 'advanced-parameters') {
      const advPanel = document.querySelector('#guide-advanced-panel');
      if (!advPanel) {
        const advBtn = document.querySelector('#guide-advanced-btn') as HTMLElement;
        if (advBtn) advBtn.click();
      }
    }
  }

  /**
   * Interactive Demo Action: Load synthetic FASTQ files (cpc, try, pooled).
   */
  loadDemoFiles() {
    const cpcRead = "@cpc_sample_1\nAAATTTGAAATTCCTAAGCAATTTTTTCTTCTTATATATATAGATAATTATACATTCCAAAATAGTAATTCAAGGACAGGTACATTTCCTTTTTTTCTTGTCTTGTGAATTAAGGAGAGGAAAATTTTCTTTTAATCCAAACAAAAAAAATCATTTCCTAAAAAAGTCTCTTCGTCTGTTGGCAAAAACGACGCCGTGTTTCATAAGCCAATATCTCTCTATCTCCTCCGGCGTCCGTCCCGGGATCCTTCCGGCGATCAACTCCCACCTACGCGCCACGTAGGATAGGCTAACAGTCAGTGTTGAGGAACTTACACTTAACCAAATACCTTTTATTCCGATAAAAACCGCATAAAGTTTGTAATTCGGTTAAAATTCTATGGAACCGAACCAAAATCGTAATTTACACTTTGACTTCATACAAACATGCTGTAATCAAAATTGAACCAA\n+\nBEEECACEBEFGDEC@CEGDEFDDBDBDEEEEDEAEEDFEEE?FDEDFEFDEGCFCFDGECEFEDHECEEEED@EEGGBDFGCFCCDAGEFDCBCDFABDECCECGGF@FCCAEAEFDDBDEDFCDECF@BFCCFADEFEBCCDEE?BDDBDDGDFCCEDDDFCCGCFFADCGDE?ADFEBBCBECGFGEDCEACEFFFCCFHEECDCDFEIBBCEEFDFEEEDDCEGEGDCEEF@CC@@CDCEBF?HECBDBEDCAECIEEFDABDEG@DBBEE?FCEEBFDAHHDHEBFFEGDD>CCCCGEGDCHEGDEGEDBGEBDEFBFDACCIEAADBCCDGGFCCBGBFDFEFDAGEFDDD@EAFECCBHEFGFBDHDFDCGDDBFDCICBBCFGBCGDGADGDFFAEECBFEHC=AFFDEFDFBCGBEEBGCDIE@FDFCD?FDCGGDFDEFE\n";
    const tryRead = "@try_sample_1\nGTCTACACAAAGGGTAAGAGGTCAACAAGACCACACAACACTTCTTACTATTAGTTTTGCAAAGGCCGTTCGTTGGACATTTCCTTCTCTCTCCTCCCCTCTTCTTCTTCTTGTTCGCTCTATAAACTCTCATCTCTCACGTCTTTTTTTCCTTACATTCTCCAAACTCAAAATTTCATCACATTAATTTCTCTCTATTTTTCTTTTCTTACTTCAATAGTAATGGATAACACTGACCGTCGTCGCCGTCGTAAGCAACACAAAATCGCCCTCCATGACTCTGAAGAAGTGAGCAGTATCGAATGGGAGTTTATCAACATGACTGAACAAGAAGAAGATCTCATCTTTCGAATGTACAGACTTGTCGGTGATAGGTGGGATTTGATAGCAGGAAGAGTTCCTGGAAGACAACCAGAGGAGATAGAGAGATATTGGATAATGAG\n+\nIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII\n";
    const pooledRead = cpcRead + tryRead;

    const file1 = new File([cpcRead], 'cpc_sample.fastq.gz', { type: 'application/gzip', lastModified: Date.now() });
    const file2 = new File([tryRead], 'try_sample.fastq.gz', { type: 'application/gzip', lastModified: Date.now() });
    const file3 = new File([pooledRead], 'cpc_try_pooled.fastq.gz', { type: 'application/gzip', lastModified: Date.now() });

    if (this.state.analysisForm.get('sequencingPlatform')?.value === 'illumina') {
      const r1 = new File([cpcRead], 'cpc_sample_R1.fastq.gz', { type: 'application/gzip', lastModified: Date.now() });
      const r2 = new File([cpcRead], 'cpc_sample_R2.fastq.gz', { type: 'application/gzip', lastModified: Date.now() });
      this.state.illuminaPairs = [
        { id: 'cpc_sample', name: 'cpc_sample', r1, r2 }
      ];
    } else {
      this.state.selectedFiles = [file1, file2, file3];
    }
    this.demoFilesLoaded = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.updateLayoutInstant();
    }, 120);
  }

  /**
   * Interactive Demo Action: Auto-fill actual synthetic CPC and TRY reference amplicons & gRNAs.
   */
  loadDemoTargets() {
    const cpcSeq = 'gctactattaatccttcccctcgtgaggaaatcatttcttcttgtttctcgagatttattctctttctctctctctttctctgtgtgtttcgtgtcttcagattagttcgATGTTTCGTTCAGACAAGGCGGAAAAAATGGATAAACGACGACGGAGACAGAGCAAAGCCAAGGCTTCTTGTTCCGAAGgtctgatttctctttgtttctctctatatctttttgatcggtttgagtctgattttgtatgtttgtttcgcagAGGTGAGTAGTATCGAATGGGAAGCTGTGAAGATGTCAGAAGAAGAAGAAGATCTCATTTCTCGGATGTATAAACTCGTTGGCGACAGgttagagactctttctctctcgatccatcttgttgctttctcttttttttggtctttcatgttttgtcgaatctgcttagattttgatctcaaagtcggtcgtttatttatgcattttcttggtttttctattatattattgggtctaacttaccgagctgtcaatgactgtgttcagcctgatttttgatcttgttattattctctgttttttgttttagttgttcaaatagcaaaacctaatcaagatttcgttttcagtttctttttttatatatgattctttagcaaaacatattcttaatttatgtcagaactcactttggctagtttggttcaattttgattacagcatgtttgtatgaagtcaaagtgtaaattacgattttggttcggttccatagaattttaaccgaattacaaactttatgcggtttttatcggaataaaaggtatttggttaagtgtaagttcctcaacactgactgttagcctatcctacgtggcgcgtagGTGGGAGTTGATCGCCGGAAGGATCCCGGGACGGACGCCGGAGGAGATAGAGAGATATTGGCTTATGAAACACGGCGTCGTTTTTGCCAACAGACGAAGAGACTTTTTTAGGAAATGAttttttttgtttggattaaaagaaaattttcctctccttaattcacaagacaagaaaaaaaggaaatgtacctgtccttgaattactattttggaatgtataattatctatatatataagaagaaaaaattgcttaggaatttcaaatttttaccagcctccatcgacacatgatatatc';
    const trySeq = 'gtctacacaaagggtaagaggtcaacaagaccacacaacacttcttactattagttttgcaaaggccgttcgttggacatttccttctctctcctcccctcttcttcttcttgttcgctctataaactctcatctctcacgtctttttttccttacattctccaaactcaaaatttcatcacattaatttctctctatttttcttttcttacttcaatagtaATGGATAACACTGACCGTCGTCGCCGTCGTAAGCAACACAAAATCGCCCTCCATGACTCTGAAGgtacctctctattctctatatattttctatttcctaaatccaattttattaaacatcttgaaaataaatttagttcctagctaggatcatattctctttgtatatattcgttaaaacgagggatacgtttaattacttctaaattagttacacctcgtgctgactaaaagacttatcaagattagtttctagttttaacaaaaattaatatctttttaaaaagtttatatttgtctttttttgttagtttaatattgttttgagtttaattggtttaatattgttatttgcagAAGTGAGCAGTATCGAATGGGAGTTTATCAACATGACTGAACAAGAAGAAGATCTCATCTTTCGAATGTACAGACTTGTCGGTGATAGgtaacaatttcttcttcttctactttttctaagattatcccagcataaaataaattttatattttagacatgtctagctaaaacaatttaatatgcaggtatatacaattttacatacgttaatttaagcatatgtactttataacatatgtacagtgtaccatgttgtaggggaagcacatggtgtccactaattttctaaaaaaagacatttaattaaagctatcacgttcattaaattatatatgtacacacatatatatagagataaaaataagaacctaatttactattcttatcagtacgtactcatgtatataaatgcttggctggctcaaaaatggaaatttttgaactgacaaattatattttattatgaaaatataaatgctaatgcttgggataaaaatgtttttttttttcttttgaattagGTGGGATTTGATAGCAGGAAGAGTTCCTGGAAGACAACCAGAGGAGATAGAGAGATATTGGATAATGAGAAACAGTGAAGGCTTTGCTGATAAACGACGCCAGCTTCACTCATCTTCCCACAAACATACCAAGCCTCACCGTCCTCGCTTTTCTATCTATCCTTCCTAGtgtttttgtttttaagccaacgaaaaaagaaaataaaaaaattataatagatgtatagtagtggttcttgttagtttgaagaattcatcatctattgttttctttttgttgttatttcatttataatttttatagtataggtttcatttggtaatcaactttaatccatgc';
    const grna = 'AATATCTCTCTATCTCCTC';

    // Clear existing genes
    while (this.state.geneBlocks.length > 0) {
      this.state.geneBlocks.removeAt(0);
    }

    // Add Gene 1: CPC
    this.state.addGene('CPC');
    const gene0 = this.state.geneBlocks.at(0);
    gene0.get('gene_name')?.setValue('CPC');
    gene0.get('gene_reference')?.setValue(cpcSeq);
    const targets0 = gene0.get('geneTargets') as FormArray;
    if (targets0 && targets0.length > 0) {
      targets0.at(0).get('target_id')?.setValue('t1');
      targets0.at(0).get('gRNA')?.setValue(grna);
    }

    // Add Gene 2: TRY
    this.state.addGene('TRY');
    const gene1 = this.state.geneBlocks.at(1);
    gene1.get('gene_name')?.setValue('TRY');
    gene1.get('gene_reference')?.setValue(trySeq);
    const targets1 = gene1.get('geneTargets') as FormArray;
    if (targets1 && targets1.length > 0) {
      targets1.at(0).get('target_id')?.setValue('t1');
      targets1.at(0).get('gRNA')?.setValue(grna);
    }

    this.demoTargetsLoaded = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      this.updateLayoutInstant();
    }, 120);
  }

  /**
   * Smoothly scroll target into view if needed, and place guide dialog.
   */
  private onStepChanged() {
    this.cdr.detectChanges();

    const sel = this.currentStepTargetSelector;
    if (sel) {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        const dialogEl = document.querySelector('.guide-dialog-wrapper') as HTMLElement;
        const dialogHeight = dialogEl ? dialogEl.offsetHeight : 280;
        const rect = el.getBoundingClientRect();
        const absoluteTop = window.scrollY + rect.top;
        const vh = window.innerHeight;

        const preferAbove = (rect.bottom > vh * 0.55 || el.offsetHeight > 220);
        if (preferAbove) {
          const desiredScroll = Math.max(0, absoluteTop - (dialogHeight + 50));
          window.scrollTo({ top: desiredScroll, behavior: 'smooth' });
        } else {
          const desiredScroll = Math.max(0, absoluteTop - 80);
          window.scrollTo({ top: desiredScroll, behavior: 'smooth' });
        }
      }
    }

    // Update layout once immediately
    this.updateLayoutInstant();

    // Re-verify once after smooth scroll settles
    setTimeout(() => {
      this.updateLayoutInstant();
    }, 320);
  }

  /**
   * Calculate document-absolute coordinates so the guide stays anchored to the page
   * without continuously following the viewport when the user scrolls.
   */
  private updateLayoutInstant() {
    const sel = this.currentStepTargetSelector;
    if (!sel) {
      this.targetRect = null;
      this.pathD = '';
      this.cardStyle = {};
      this.cdr.detectChanges();
      return;
    }

    const el = document.querySelector(sel) as HTMLElement;
    if (!el) {
      this.targetRect = null;
      this.pathD = '';
      this.cardStyle = {};
      this.cdr.detectChanges();
      return;
    }

    const clientRect = el.getBoundingClientRect();
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const scrollX = window.scrollX || window.pageXOffset || 0;

    // Convert target rect to document-absolute coordinates
    const docTop = clientRect.top + scrollY;
    const docLeft = clientRect.left + scrollX;
    const rect = {
      top: docTop,
      left: docLeft,
      width: clientRect.width,
      height: clientRect.height,
      bottom: docTop + clientRect.height,
      right: docLeft + clientRect.width
    };
    this.targetRect = rect;

    const dialogEl = document.querySelector('.guide-dialog-wrapper') as HTMLElement;
    const dialogHeight = dialogEl ? dialogEl.offsetHeight : 280;
    const docWidth = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(800, Math.max(340, docWidth - 48));
    const gap = 24;

    let cTop = 0;
    let cLeft = rect.left + (rect.width - cardWidth) / 2;

    let sX = rect.left + rect.width / 2;
    let sY = 0;
    let eX = 0;
    let eY = 0;

    // Use viewport-relative position at the moment of calculation to decide above vs below
    const spaceBelow = vh - clientRect.bottom;
    const spaceAbove = clientRect.top;
    const preferAbove = (clientRect.bottom > vh * 0.55 || clientRect.height > 220);

    if (preferAbove && spaceAbove >= dialogHeight + gap) {
      cTop = rect.top - dialogHeight - gap;
      sY = rect.top - 6;
      eY = cTop + dialogHeight;
    } else if (spaceBelow >= dialogHeight + gap) {
      cTop = rect.bottom + gap;
      sY = rect.bottom + 6;
      eY = cTop;
    } else if (spaceAbove >= dialogHeight + gap) {
      cTop = rect.top - dialogHeight - gap;
      sY = rect.top - 6;
      eY = cTop + dialogHeight;
    } else {
      if (spaceBelow >= spaceAbove) {
        cTop = rect.bottom + gap;
        sY = rect.bottom + 6;
        eY = cTop;
      } else {
        cTop = Math.max(10, rect.top - dialogHeight - gap);
        sY = rect.top - 6;
        eY = cTop + dialogHeight;
      }
    }

    // Clamp horizontally to page bounds
    cLeft = Math.max(24, Math.min(docWidth - cardWidth - 24, cLeft));
    eX = Math.max(cLeft + 60, Math.min(cLeft + cardWidth - 60, sX));

    this.cardStyle = {
      top: `${Math.round(cTop)}px`,
      left: `${Math.round(cLeft)}px`,
      width: `${Math.round(cardWidth)}px`
    };

    this.arrowStartX = Math.round(sX);
    this.arrowStartY = Math.round(sY);
    this.arrowEndX = Math.round(eX);
    this.arrowEndY = Math.round(eY);

    const dy = this.arrowEndY - this.arrowStartY;
    const cp1X = this.arrowStartX;
    const cp1Y = Math.round(this.arrowStartY + dy * 0.55);
    const cp2X = this.arrowEndX;
    const cp2Y = Math.round(this.arrowEndY - dy * 0.15);

    this.pathD = `M ${this.arrowStartX} ${this.arrowStartY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${this.arrowEndX} ${this.arrowEndY}`;

    this.cdr.detectChanges();
  }
}
