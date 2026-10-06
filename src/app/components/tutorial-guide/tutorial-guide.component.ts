import { Component, EventEmitter, Output, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

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
  textLines?: string[];
  targetSelector?: string;
  isIntro?: boolean;
  isPrereq?: boolean;
  nextButtonText?: string;
}

@Component({
  selector: 'app-tutorial-guide',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="guide-root" [class.no-target]="!targetRect" (keydown.escape)="closeGuide()" tabindex="0">

      <!-- ── Top-Right Fixed Exit Guide Button ── -->
      <button type="button" class="btn-top-exit" (click)="closeGuide()" title="Exit Guide (Esc)">
        Exit Guide ✕
      </button>

      <!-- ── Spotlight Cutout with 0% Tint Inside ── -->
      <div class="spotlight-hole"
           *ngIf="targetRect"
           [style.top.px]="targetRect.top - 6"
           [style.left.px]="targetRect.left - 6"
           [style.width.px]="targetRect.width + 12"
           [style.height.px]="targetRect.height + 12">
        <span class="spotlight-label">{{ currentStep.stageName }}</span>
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
            <img src="casmango-logo.jpg" alt="CasMANGO" class="mascot-avatar-img" />
            <span class="mascot-live-indicator"></span>
          </div>
          <span class="mascot-tag">CasMANGO</span>
        </div>

        <!-- Speech Bubble (Right) -->
        <div class="bubble-content">
          <h2 class="bubble-headline">{{ currentStep.headline }}</h2>

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

          <!-- Minimal 1-2 lines text explanation (Tour Steps) -->
          <div class="text-lines-block" *ngIf="currentStep.textLines && currentStep.textLines.length > 0">
            <p class="text-line" *ngFor="let line of currentStep.textLines">{{ line }}</p>
          </div>

          <!-- Footer Actions (Forward button only, no back button) -->
          <div class="bubble-footer">
            <button type="button"
                    class="btn-guide-next"
                    (click)="nextStep()">
              {{ currentStep.nextButtonText || 'Next ▶' }}
            </button>
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

    /* ── Fullscreen Overlay ── */
    .guide-root {
      position: fixed;
      inset: 0;
      z-index: 10000;
      outline: none;
      pointer-events: auto;
      user-select: none;
    }

    /* Backdrop when on Intro / Prereq without target spotlight */
    .guide-root.no-target {
      background: rgba(15, 23, 42, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Top-Right Fixed Exit Guide Button ── */
    .btn-top-exit {
      position: fixed;
      top: 18px;
      right: 24px;
      z-index: 10010;
      background: rgba(15, 23, 42, 0.75);
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
      transition: all 0.15s ease;
    }

    .btn-top-exit:hover {
      background: rgba(239, 68, 68, 0.9);
      border-color: #ef4444;
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(239, 68, 68, 0.4);
    }

    /* ── Spotlight Hole: 0% Tint Inside, Massive Box Shadow Darkens Outside ── */
    .spotlight-hole {
      position: fixed;
      z-index: 10001;
      border: 3px solid #f59e0b;
      border-radius: 10px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55), 0 0 20px rgba(245, 158, 11, 0.4);
      pointer-events: none;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .spotlight-label {
      position: absolute;
      top: -13px;
      left: 14px;
      background: #f59e0b;
      color: #0f172a;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.06em;
      padding: 2px 10px;
      border-radius: 999px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      text-transform: uppercase;
    }

    /* ── SVG Arrow Layer ── */
    .arrow-svg-layer {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 10003;
    }

    .animated-dashed-arrow {
      animation: dashMove 1.1s linear infinite;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
    }

    @keyframes dashMove {
      from { stroke-dashoffset: 0; }
      to { stroke-dashoffset: -20; }
    }

    .pulse-ring {
      animation: pulseAnim 1.4s ease-out infinite;
      transform-origin: center;
    }

    @keyframes pulseAnim {
      0% { r: 4.5; opacity: 1; }
      100% { r: 14; opacity: 0; }
    }

    /* ── Dialog Wrapper: Character Left + Bubble Right ── */
    .guide-dialog-wrapper {
      position: fixed;
      z-index: 10005;
      display: flex;
      align-items: flex-start;
      gap: 20px;
      max-width: 760px;
      width: calc(100vw - 40px);
      pointer-events: auto;
      transition: top 0.15s cubic-bezier(0.16, 1, 0.3, 1), left 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      animation: dialogPop 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .guide-dialog-wrapper.is-centered {
      position: relative;
      margin: auto;
    }

    .guide-dialog-wrapper.is-large-dialog {
      max-width: 940px;
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
      margin-top: 12px;
    }

    .mascot-avatar-frame {
      position: relative;
      width: 76px;
      height: 76px;
    }

    .mascot-avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 18px;
      border: 3px solid #f59e0b;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3);
      object-fit: cover;
      background: #ffffff;
    }

    .mascot-live-indicator {
      position: absolute;
      bottom: -2px;
      right: -2px;
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: #10b981;
      border: 2.5px solid #ffffff;
    }

    .mascot-tag {
      font-size: 11.5px;
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
      padding: 26px 30px 22px 30px;
      flex: 1;
      min-width: 0;
    }

    /* Speech bubble arrow notch pointing toward the mascot */
    .bubble-content::before {
      content: '';
      position: absolute;
      top: 36px;
      left: -11px;
      width: 0;
      height: 0;
      border-top: 10px solid transparent;
      border-bottom: 10px solid transparent;
      border-right: 11px solid #ffffff;
    }

    .bubble-headline {
      margin: 0 0 8px 0;
      font-size: 21px;
      font-weight: 900;
      color: #0f172a;
      letter-spacing: -0.02em;
    }

    .bubble-intro-line {
      margin: 0 0 18px 0;
      font-size: 14.5px;
      color: #475569;
      line-height: 1.55;
    }

    /* ── 3 Cards Grid (Intro & Prereq) ── */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
      margin-bottom: 18px;
    }

    .grid-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 16px 14px 16px;
      display: flex;
      flex-direction: column;
      transition: all 0.15s ease;
    }

    .grid-card:hover {
      background: #ffffff;
      border-color: #cbd5e1;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
    }

    .grid-card-badge {
      font-size: 10px;
      font-weight: 900;
      color: #ea580c;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
    }

    .grid-card-title {
      margin: 0 0 6px 0;
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.35;
    }

    .grid-card-desc {
      margin: 0;
      font-size: 12px;
      color: #475569;
      line-height: 1.5;
    }

    /* ── Minimal 1-2 Lines Text (Tour Steps) ── */
    .text-lines-block {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 18px;
    }

    .text-line {
      margin: 0;
      font-size: 14.5px;
      color: #334155;
      line-height: 1.55;
    }

    /* ── Footer Actions ── */
    .bubble-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      border-top: 1px solid #f1f5f9;
      padding-top: 14px;
    }

    .btn-guide-next {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border: none;
      color: #ffffff;
      padding: 10px 24px;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(245, 158, 11, 0.35);
      transition: all 0.15s ease;
    }

    .btn-guide-next:hover {
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      box-shadow: 0 6px 16px rgba(245, 158, 11, 0.5);
      transform: translateY(-1px);
    }

    /* ── Bottom Progress Bar ── */
    .screen-progress-track {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 5px;
      background: rgba(255, 255, 255, 0.15);
      z-index: 10009;
    }

    .screen-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #ea580c);
      transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 0 10px rgba(245, 158, 11, 0.8);
    }

    @media (max-width: 768px) {
      .cards-grid {
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
      .bubble-content::before {
        display: none;
      }
      .bubble-content {
        padding: 20px;
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

  private rafId: number | null = null;

  steps: GuideStep[] = [
    // ── 0. Intro (Overview) ──
    {
      id: 'intro',
      stageName: 'Introduction',
      headline: 'Welcome to CasMANGO',
      introLine: 'CasMANGO is a client-side tool for pooled, multiplexed CRISPR amplicon sequencing using ambiguity-aware reference assignment.',
      cards: [
        {
          badge: 'Security & Privacy',
          title: '100% Client-Side Engine',
          desc: 'All sequencing FASTQ data is processed directly in your browser Web Workers—zero files uploaded to external servers.'
        },
        {
          badge: 'Platform Agnostic',
          title: 'Illumina & Nanopore',
          desc: 'Supports short-read Illumina paired ends (with mate linking and gap X-padding) and long-read Oxford Nanopore amplicons (.gz supported).'
        },
        {
          badge: 'Polyploid Demux',
          title: 'Minimizing Misassignment',
          desc: 'Ambiguity-aware assignment separates near-identical homeologs (e.g. wheat, canola) while retaining uncertain reads to prevent miscalling.'
        }
      ],
      nextButtonText: 'Next ▶',
      isIntro: true
    },

    // ── 1. Prerequisites (Inputs) ──
    {
      id: 'prerequisites',
      stageName: 'Prerequisites',
      headline: 'What You Need to Prepare',
      introLine: 'You only need 3 core inputs to begin analyzing your CRISPR editing outcomes:',
      cards: [
        {
          badge: 'Input 1',
          title: 'FASTQ File(s)',
          desc: 'Supported formats: .fastq, .fq, .fastq.gz, .fq.gz (from Illumina paired/single-end or Oxford Nanopore).'
        },
        {
          badge: 'Input 2',
          title: 'Gene Reference Sequence(s)',
          desc: 'The wild-type genomic sequence(s) against which sequencing reads are aligned and compared.'
        },
        {
          badge: 'Input 3',
          title: 'gRNA Target Sequence(s)',
          desc: '19–25 bp guide spacer sequence(s) used to define double-strand cut sites and editing target loci.'
        }
      ],
      nextButtonText: 'Start Interactive Tour ▶',
      isPrereq: true
    },

    // ── 2. Platform & Reference Mode ──
    {
      id: 'platform-mode',
      stageName: 'Platform & Mode',
      headline: 'Platform & Reference Mode',
      textLines: [
        '• Platform: Choose Illumina (short-read with auto R1/R2 mate pairing) or Nanopore (long-read amplicon alignment). Both support .fastq.gz.',
        '• Reference Mode: Select Standard for independent gene loci, or Homeolog for polyploid crops (wheat, canola) to analyze inter-subgenome competition and minimize cross-misassignments.'
      ],
      targetSelector: '#guide-platform-section',
      nextButtonText: 'Next ▶'
    },

    // ── 3. File Upload ──
    {
      id: 'file-upload',
      stageName: 'File Upload',
      headline: 'Upload FASTQ Sequencing Files',
      textLines: [
        '• Drag and drop .fastq, .fq, or .gz compressed files directly into the central dropzone.',
        '• Illumina paired-end files are automatically paired by filename (R1 & R2). All parsing runs locally in parallel Web Workers.'
      ],
      targetSelector: '#guide-upload-zone',
      nextButtonText: 'Next ▶'
    },

    // ── 4. Reference Sequence(s) & Target(s) ──
    {
      id: 'ref-config',
      stageName: 'Ref & Targets',
      headline: 'Reference Sequence(s) & Target(s)',
      textLines: [
        '• Enter wild-type amplicon sequence(s) and gRNA spacer(s). Cut sites and PAM coordinates are determined automatically.',
        '• Click Auto Fill to download an Excel template and batch-upload dozens of targets in 1 second, or use Config per File for multiplexed libraries.'
      ],
      targetSelector: '#guide-targets-section',
      nextButtonText: 'Next ▶'
    },

    // ── 5. Window Check ──
    {
      id: 'window-check',
      stageName: 'Window Check',
      headline: 'Window Check & Similarity Indicator',
      textLines: [
        '• Visually inspect the nucleotide sequence around the cut site to verify that expected editing events fall within the analyzed window.',
        '• In Homeolog mode, review the pairwise similarity matrix—high sequence similarity (e.g. >98%) indicates you should raise the Assignment Margin (%).'
      ],
      targetSelector: '#guide-window-check-btn',
      nextButtonText: 'Next ▶'
    },

    // ── 6. Parameter Settings ──
    {
      id: 'parameters',
      stageName: 'Parameters',
      headline: 'Parameters & Advanced Settings',
      textLines: [
        '• Set Window Size (analysis span), Phred Quality, Assignment Margin (demux threshold), and Indel Threshold (noise filter).',
        '• In Advanced, configure cut-site mutation exclusion or distance weighting so large deletions do not distort reference assignment.'
      ],
      targetSelector: '#guide-controls-grid',
      nextButtonText: 'Next ▶'
    },

    // ── 7. Run Analysis & Viewers ──
    {
      id: 'run-and-view',
      stageName: 'Execution',
      headline: 'Run Analysis & Result Viewers',
      textLines: [
        '• Click Start Local Analysis to run. Dedicated browser Web Workers process your files in parallel with live progress updates.',
        '• Export comprehensive results to Excel (.xlsx) and drop them into Result Viewer anytime, or inspect accuracy in the Benchmark tab.'
      ],
      targetSelector: '#guide-run-btn',
      nextButtonText: 'Finish Guide ✕'
    }
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  get currentStep(): GuideStep {
    return this.steps[this.currentStepIndex];
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.steps.length - 1;
  }

  get progressPercent(): number {
    return Math.round(((this.currentStepIndex + 1) / this.steps.length) * 100);
  }

  ngOnInit() {
    this.updateLayoutInstant();
  }

  ngOnDestroy() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
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
      this.nextStep();
    }
  }

  nextStep() {
    if (this.isLastStep) {
      this.closeGuide();
      return;
    }
    this.currentStepIndex++;
    this.onStepChanged();
  }

  closeGuide() {
    this.close.emit();
  }

  /**
   * Instantly switch target and scroll smoothly without lag.
   */
  private onStepChanged() {
    const sel = this.currentStep.targetSelector;
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // Update immediately (0ms delay)
    this.updateLayoutInstant();

    // Continuously follow during smooth scrolling animation
    let frames = 0;
    const followScroll = () => {
      this.updateLayoutInstant();
      frames++;
      if (frames < 20) {
        this.rafId = requestAnimationFrame(followScroll);
      }
    };
    this.rafId = requestAnimationFrame(followScroll);
  }

  /**
   * Calculate coordinates synchronously without delays.
   */
  private updateLayoutInstant() {
    const sel = this.currentStep.targetSelector;
    if (!sel) {
      this.targetRect = null;
      this.pathD = '';
      this.cardStyle = {};
      this.cdr.detectChanges();
      return;
    }

    const el = document.querySelector(sel);
    if (!el) {
      this.targetRect = null;
      this.pathD = '';
      this.cardStyle = {};
      this.cdr.detectChanges();
      return;
    }

    const rect = el.getBoundingClientRect();
    this.targetRect = rect;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(760, Math.max(340, vw - 40));
    const cardEstimatedHeight = 260;

    // Determine placement: above or below
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    let cTop = 0;
    let cLeft = rect.left + (rect.width - cardWidth) / 2;

    let sX = rect.left + rect.width / 2;
    let sY = 0;
    let eX = 0;
    let eY = 0;

    if (spaceBelow >= cardEstimatedHeight + 40 || spaceBelow >= spaceAbove) {
      // Place below
      cTop = rect.bottom + 36;
      sY = rect.bottom + 6;
      eY = cTop;
    } else {
      // Place above
      cTop = rect.top - cardEstimatedHeight - 36;
      sY = rect.top - 6;
      eY = cTop + cardEstimatedHeight;
    }

    // Clamp inside viewport
    cLeft = Math.max(20, Math.min(vw - cardWidth - 20, cLeft));
    cTop = Math.max(24, Math.min(vh - cardEstimatedHeight - 24, cTop));

    eX = Math.max(cLeft + 50, Math.min(cLeft + cardWidth - 50, sX));

    this.cardStyle = {
      top: `${Math.round(cTop)}px`,
      left: `${Math.round(cLeft)}px`,
      width: `${Math.round(cardWidth)}px`
    };

    this.arrowStartX = Math.round(sX);
    this.arrowStartY = Math.round(sY);
    this.arrowEndX = Math.round(eX);
    this.arrowEndY = Math.round(eY);

    // Smooth cubic bezier curve
    const dy = this.arrowEndY - this.arrowStartY;
    const cp1X = this.arrowStartX;
    const cp1Y = Math.round(this.arrowStartY + dy * 0.55);
    const cp2X = this.arrowEndX;
    const cp2Y = Math.round(this.arrowEndY - dy * 0.15);

    this.pathD = `M ${this.arrowStartX} ${this.arrowStartY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${this.arrowEndX} ${this.arrowEndY}`;

    this.cdr.detectChanges();
  }
}
