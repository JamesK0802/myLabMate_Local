import { Component, EventEmitter, Output, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  interactiveAction?: 'create_guide_tab' | 'load_demo_files' | 'open_autofill' | 'load_demo_targets' | 'open_window_check';
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
          <div class="acronym-sentence" *ngIf="currentStep.isIntro">
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

          <!-- 3 Advantage Cards (Intro & Prereq) -->
          <div class="cards-grid" *ngIf="currentStep.cards && currentStep.cards.length > 0">
            <div class="grid-card" *ngFor="let card of currentStep.cards">
              <span class="grid-card-badge" *ngIf="card.badge">{{ card.badge }}</span>
              <h3 class="grid-card-title">{{ card.title }}</h3>
              <p class="grid-card-desc">{{ card.desc }}</p>
            </div>
          </div>

          <!-- Side-by-Side Comparison Columns (Platform / Mode) -->
          <div class="comparison-grid" *ngIf="currentStep.comparisonColumns">
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

          <!-- Minimal text lines -->
          <div class="text-lines-block" *ngIf="currentStep.textLines && currentStep.textLines.length > 0">
            <p class="text-line" *ngFor="let line of currentStep.textLines">{{ line }}</p>
          </div>

          <!-- Footer Actions -->
          <div class="bubble-footer">
            <ng-container *ngIf="!currentStep.isFinal">
              <button type="button"
                      class="btn-guide-next"
                      [disabled]="!isNextButtonEnabled"
                      (click)="nextStep()">
                {{ currentStep.nextButtonText || 'Next ▶' }}
              </button>
            </ng-container>

            <!-- Final Step: Exit or Explore Results Guide -->
            <ng-container *ngIf="currentStep.isFinal">
              <div class="final-actions-group">
                <button type="button"
                        class="btn-secondary-action"
                        (click)="closeGuide()">
                  Exit Guide ✕
                </button>
                <button type="button"
                        class="btn-guide-next"
                        (click)="openResultsGuideComingSoon()">
                  Explore Results Guide ▶
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
      position: fixed;
      inset: 0;
      z-index: 99990;
      outline: none;
      pointer-events: none;
      user-select: none;
    }

    /* Backdrop when on Intro / Prereq without target spotlight */
    .guide-root.no-target {
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
      position: fixed;
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
      position: fixed;
      inset: 0;
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

    /* ── Dialog Wrapper: Highest z-index on page, always on top ── */
    .guide-dialog-wrapper {
      position: fixed;
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

    /* ── Comparison Columns (Platform / Mode) ── */
    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 16px;
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
  @Output() close = new EventEmitter<void>();
  @Output() requestTab = new EventEmitter<'analysis' | 'viewer' | 'benchmark' | 'workspace'>();

  currentStepIndex = 0;

  targetRect: DOMRect | null = null;
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
        '• CasMANGO allows managing multiple independent analysis sessions at once.',
        '• Click the (+) button on the tabs bar to create a dedicated tab for this tutorial.'
      ],
      targetSelector: '#guide-tabs-bar',
      interactiveAction: 'create_guide_tab',
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
        '• Supports .fastq and .gz files (Illumina pairs link automatically by name).',
        '• Click the upload zone to load the demo dataset (CPC, TRY, Pooled).'
      ],
      targetSelector: '#guide-upload-zone',
      interactiveAction: 'load_demo_files',
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
        '• Config per File assigns distinct reference amplicons to individual FASTQ libraries in pooled runs.',
        '• Click Auto Fill to expand the batch Excel configuration toolset.'
      ],
      targetSelector: '#guide-autofill-btn',
      interactiveAction: 'open_autofill',
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
      textLines: [
        '• Click Upload Sequence (Excel) to load the demo CPC & TRY locus configurations.'
      ],
      targetSelector: '#guide-autofill-upload-btn',
      interactiveAction: 'load_demo_targets',
      nextButtonText: 'Next ▶'
    },

    // ── 8. Window Check ──
    {
      id: 'window-check',
      stageName: 'Window Check',
      headline: 'Window Check: Compare Locus Windows',
      textLines: [
        '• Window Check compares extracted cut-site windows across amplicons to measure sequence similarity.',
        '• Click Window Check to view the live comparison between CPC and TRY.'
      ],
      targetSelector: '#guide-window-check-btn',
      interactiveAction: 'open_window_check',
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

  constructor(
    public state: AppStateService,
    private cdr: ChangeDetectorRef
  ) {}

  get currentStep(): GuideStep {
    return this.steps[this.currentStepIndex];
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.steps.length - 1;
  }

  get progressPercent(): number {
    return Math.round(((this.currentStepIndex + 1) / this.steps.length) * 100);
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
    window.addEventListener('click', this.boundCaptureClick, true);
    this.handleStepSideEffects();
    this.updateLayoutInstant();
  }

  ngOnDestroy() {
    window.removeEventListener('click', this.boundCaptureClick, true);
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.removeGuideTab();
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
  }

  private onTabCreatedByClick() {
    const activeTab = this.state.currentTab;
    if (activeTab) {
      this.state.renameTab(activeTab.id, 'Guide Analysis');
      this.guideTabId = activeTab.id;
      this.guideTabCreated = true;
      this.cdr.detectChanges();
    }
  }

  private removeGuideTab() {
    if (this.guideTabId) {
      const exists = this.state.tabs.some(t => t.id === this.guideTabId);
      if (exists) {
        this.state.closeTab(this.guideTabId);
      }
      this.guideTabId = null;
      this.guideTabCreated = false;
    }
  }

  @HostListener('window:resize')
  onResize() {
    this.updateLayoutInstant();
  }

  @HostListener('window:scroll')
  onScroll() {
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
    this.removeGuideTab();
    this.close.emit();
  }

  openResultsGuideComingSoon() {
    alert('Results Dashboard Walkthrough will be available in the upcoming update!\n\nYou can run analysis, export comprehensive multi-sheet Excel (.xlsx) files, and restore all visual charts anytime via the Result Viewer tab.');
    this.closeGuide();
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
   * Instantly switch target and scroll smoothly with guaranteed gap.
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

    this.updateLayoutInstant();

    let frames = 0;
    const followScroll = () => {
      this.updateLayoutInstant();
      frames++;
      if (frames < 25) {
        this.rafId = requestAnimationFrame(followScroll);
      }
    };
    this.rafId = requestAnimationFrame(followScroll);
  }

  /**
   * Calculate coordinates synchronously without delays and prevent overlapping on tall targets.
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

    const rect = el.getBoundingClientRect();
    this.targetRect = rect;

    const dialogEl = document.querySelector('.guide-dialog-wrapper') as HTMLElement;
    const dialogHeight = dialogEl ? dialogEl.offsetHeight : 280;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(800, Math.max(340, vw - 48));
    const gap = 24;

    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    let cTop = 0;
    let cLeft = rect.left + (rect.width - cardWidth) / 2;

    let sX = rect.left + rect.width / 2;
    let sY = 0;
    let eX = 0;
    let eY = 0;

    // Prefer placing ABOVE if target is in lower portion or tall
    const preferAbove = (rect.bottom > vh * 0.55 || rect.height > 220);

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

    // Clamp horizontally
    cLeft = Math.max(24, Math.min(vw - cardWidth - 24, cLeft));
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
