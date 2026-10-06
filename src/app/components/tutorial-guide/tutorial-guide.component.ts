import { Component, EventEmitter, Output, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface GuidePoint {
  title: string;
  text: string;
}

export interface GuideStep {
  id: string;
  stepTitle: string;
  headline: string;
  summary: string;
  points: GuidePoint[];
  tip?: string;
  targetSelector?: string;
  isIntro?: boolean;
}

@Component({
  selector: 'app-tutorial-guide',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="guide-overlay" [class.intro-mode]="currentStep.isIntro" (keydown.escape)="closeGuide()" tabindex="0">

      <!-- ── SVG Curved Dashed Arrow Layer ── -->
      <svg class="guide-svg-layer" *ngIf="!currentStep.isIntro && pathD">
        <defs>
          <marker id="guide-arrow-marker"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse">
            <polygon points="0 1, 9 5, 0 9" fill="#f59e0b" />
          </marker>
        </defs>

        <!-- Pulse dot at origin on the target UI element -->
        <circle [attr.cx]="arrowStartX" [attr.cy]="arrowStartY" r="8"
                fill="none" stroke="#f59e0b" stroke-width="1.5" class="origin-pulse" />
        <circle [attr.cx]="arrowStartX" [attr.cy]="arrowStartY" r="4" fill="#f59e0b" />

        <!-- Curved Dashed Arrow from element to speech bubble -->
        <path [attr.d]="pathD"
              stroke="#f59e0b"
              stroke-width="2.5"
              stroke-dasharray="6,4"
              fill="none"
              class="dashed-arrow"
              marker-end="url(#guide-arrow-marker)" />
      </svg>

      <!-- ── Spotlight Frame on Target Element ── -->
      <div class="guide-target-spotlight"
           *ngIf="!currentStep.isIntro && targetRect"
           [style.top.px]="targetRect.top - 4"
           [style.left.px]="targetRect.left - 4"
           [style.width.px]="targetRect.width + 8"
           [style.height.px]="targetRect.height + 8">
        <span class="spotlight-name">{{ currentStep.stepTitle }}</span>
      </div>

      <!-- ── Speech Bubble Card (Bright Theme) ── -->
      <div class="guide-card"
           [class.is-intro-card]="currentStep.isIntro"
           [ngStyle]="currentStep.isIntro ? {} : cardStyle">

        <!-- Top Accent Bar -->
        <div class="card-accent-bar"></div>

        <!-- Header: Mascot & Step Progress -->
        <div class="card-header">
          <div class="mascot-group">
            <img src="casmango-logo.jpg" alt="CasMANGO" class="mascot-thumb" />
            <div class="mascot-meta">
              <strong class="mascot-name">CasMANGO</strong>
              <span class="step-indicator" *ngIf="!currentStep.isIntro">
                Step {{ currentStepIndex }} / {{ steps.length - 1 }} · {{ currentStep.stepTitle }}
              </span>
              <span class="step-indicator" *ngIf="currentStep.isIntro">Interactive Guide</span>
            </div>
          </div>

          <button type="button" class="btn-card-close" (click)="closeGuide()" title="Close Tutorial (Esc)">
            ✕
          </button>
        </div>

        <!-- Headline -->
        <h2 class="card-headline">{{ currentStep.headline }}</h2>

        <!-- Main Summary -->
        <p class="card-summary">{{ currentStep.summary }}</p>

        <!-- Core Bullet Points -->
        <div class="points-container">
          <div class="point-row" *ngFor="let pt of currentStep.points">
            <span class="point-badge">{{ pt.title }}</span>
            <span class="point-desc">{{ pt.text }}</span>
          </div>
        </div>

        <!-- Optional Tip Box -->
        <div class="card-tip-box" *ngIf="currentStep.tip">
          <strong class="tip-tag">TIP</strong>
          <span class="tip-desc">{{ currentStep.tip }}</span>
        </div>

        <!-- Footer Navigation -->
        <div class="card-footer">
          <button type="button"
                  class="btn-nav btn-prev"
                  *ngIf="!currentStep.isIntro"
                  (click)="prevStep()">
            ◀ Back
          </button>

          <!-- Step Dots -->
          <div class="step-dots-row">
            <span *ngFor="let s of steps; let i = index"
                  class="dot-pill"
                  [class.active]="i === currentStepIndex"
                  (click)="goToStep(i)"
                  [title]="s.stepTitle"></span>
          </div>

          <button type="button"
                  class="btn-nav btn-next"
                  (click)="nextStep()">
            {{ isLastStep ? 'Finish Guide ✕' : (currentStep.isIntro ? 'Start Guide ▶' : 'Next ▶') }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    /* ── Overlay: Clean, bright-friendly dark-tint (NO BLUR) ── */
    .guide-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: none; /* Completely sharp UI underneath */
      outline: none;
      pointer-events: auto;
      user-select: none;
      animation: fadeIn 0.2s ease forwards;
    }

    .guide-overlay.intro-mode {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── SVG Curved Dashed Arrow ── */
    .guide-svg-layer {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 10002;
    }

    .dashed-arrow {
      animation: arrowDash 1.2s linear infinite;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
    }

    @keyframes arrowDash {
      from { stroke-dashoffset: 0; }
      to { stroke-dashoffset: -20; }
    }

    .origin-pulse {
      animation: pulseRipple 1.5s ease-out infinite;
      transform-origin: center;
    }

    @keyframes pulseRipple {
      0% { r: 4; opacity: 1; }
      100% { r: 14; opacity: 0; }
    }

    /* ── Target Spotlight Frame on Real UI ── */
    .guide-target-spotlight {
      position: fixed;
      z-index: 10001;
      border: 2.5px solid #f59e0b;
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.25), 0 4px 14px rgba(0, 0, 0, 0.15);
      border-radius: 8px;
      pointer-events: none;
      transition: all 0.2s ease;
    }

    .spotlight-name {
      position: absolute;
      top: -11px;
      left: 10px;
      background: #f59e0b;
      color: #ffffff;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      padding: 1px 8px;
      border-radius: 999px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }

    /* ── Bright Speech Bubble Card ── */
    .guide-card {
      position: fixed;
      z-index: 10005;
      background: #ffffff;
      color: #1e293b;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.06);
      padding: 22px 24px 18px 24px;
      display: flex;
      flex-direction: column;
      pointer-events: auto;
      max-width: 480px;
      width: calc(100vw - 32px);
      animation: cardPop 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .guide-card.is-intro-card {
      position: relative;
      max-width: 540px;
      margin: auto;
    }

    @keyframes cardPop {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .card-accent-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #f59e0b, #ea580c);
      border-radius: 16px 16px 0 0;
    }

    /* ── Header ── */
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .mascot-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .mascot-thumb {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      border: 1.5px solid #f59e0b;
      object-fit: cover;
    }

    .mascot-meta {
      display: flex;
      flex-direction: column;
    }

    .mascot-name {
      font-size: 13.5px;
      font-weight: 800;
      color: #0f172a;
    }

    .step-indicator {
      font-size: 11px;
      color: #64748b;
      font-weight: 600;
    }

    .btn-card-close {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #64748b;
      width: 28px;
      height: 28px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .btn-card-close:hover {
      background: #fee2e2;
      color: #ef4444;
      border-color: #fca5a5;
    }

    /* ── Typography & Points ── */
    .card-headline {
      margin: 0 0 6px 0;
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.01em;
    }

    .card-summary {
      margin: 0 0 12px 0;
      font-size: 13px;
      color: #475569;
      line-height: 1.5;
    }

    .points-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
    }

    .point-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 12.5px;
      line-height: 1.45;
    }

    .point-badge {
      font-size: 10.5px;
      font-weight: 800;
      color: #0369a1;
      background: #e0f2fe;
      padding: 1px 7px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .point-desc {
      color: #334155;
    }

    /* ── Tip Box ── */
    .card-tip-box {
      background: #fffbeb;
      border: 1px solid #fef3c7;
      border-radius: 8px;
      padding: 8px 12px;
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 11.5px;
      color: #92400e;
      margin-bottom: 14px;
    }

    .tip-tag {
      font-size: 10px;
      font-weight: 900;
      background: #f59e0b;
      color: #ffffff;
      padding: 1px 5px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .tip-desc {
      line-height: 1.4;
    }

    /* ── Footer & Navigation ── */
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid #f1f5f9;
      padding-top: 12px;
    }

    .step-dots-row {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .dot-pill {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #cbd5e1;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .dot-pill.active {
      width: 18px;
      background: #f59e0b;
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
    }

    .btn-nav {
      padding: 7px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-prev {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #475569;
    }

    .btn-prev:hover {
      background: #e2e8f0;
      color: #1e293b;
    }

    .btn-next {
      background: #f59e0b;
      border: 1px solid #d97706;
      color: #ffffff;
      margin-left: auto;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
    }

    .btn-next:hover {
      background: #d97706;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
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

  steps: GuideStep[] = [
    // ── Step 0: Intro (Centered) ──
    {
      id: 'intro',
      stepTitle: 'Overview',
      headline: 'Welcome to CasMANGO!',
      summary: 'CasMANGO is a high-precision, 100% client-side CRISPR amplicon analysis tool engineered for polyploids (wheat, canola) and single-locus targets.',
      points: [
        {
          title: '100% Private',
          text: 'FASTQ files are parsed in local browser memory and never uploaded to any server.'
        },
        {
          title: 'Platforms',
          text: 'Supports Illumina paired-end short reads and Oxford Nanopore long reads.'
        },
        {
          title: 'Prerequisites',
          text: '1) FASTQ files (.fq / .gz), 2) Wild-Type Reference Amplicon, 3) gRNA Spacer Sequence.'
        }
      ],
      tip: 'Click "Start Guide ▶" to take a step-by-step interactive walkthrough of the tool.',
      isIntro: true
    },

    // ── Step 1: Platform & Mode ──
    {
      id: 'platform-mode',
      stepTitle: 'Platform & Mode',
      headline: 'Platform & Homoeolog Mode',
      summary: 'Choose your sequencing chemistry and reference classification mode.',
      points: [
        {
          title: 'Platform',
          text: 'Illumina auto-pairs R1/R2 and applies gap X-padding; Nanopore aligns long amplicons with terminal anchor checks. Both accept .fastq.gz.'
        },
        {
          title: 'Reference Mode',
          text: 'Use Standard for independent loci. Use Homoeolog for polyploid crops (wheat, canola) to analyze inter-subgenome competition with 0% misassignment.'
        }
      ],
      tip: 'Polyploid samples (e.g. 4A/4B/4D) should always be analyzed in Homoeolog mode.',
      targetSelector: '#guide-platform-choice'
    },

    // ── Step 2: File Upload ──
    {
      id: 'file-upload',
      stepTitle: 'File Upload',
      headline: 'FASTQ File Ingestion',
      summary: 'Drag and drop your raw or gzip-compressed sequencing files directly into the central dropzone.',
      points: [
        {
          title: 'Formats',
          text: 'Accepts .fastq, .fq, and compressed .fastq.gz / .fq.gz directly.'
        },
        {
          title: 'Auto-Pairing',
          text: 'Illumina paired-end R1 and R2 files are matched automatically based on file name patterns.'
        },
        {
          title: 'Multi-Core',
          text: 'Each sample runs in parallel on an independent browser Web Worker thread.'
        }
      ],
      tip: 'Files stay strictly on your computer and are decompressed in browser RAM.',
      targetSelector: '#guide-upload-zone'
    },

    // ── Step 3: Reference & Targets ──
    {
      id: 'ref-config',
      stepTitle: 'Ref & Targets',
      headline: 'Reference Amplicon & gRNA Spacers',
      summary: 'Enter your wild-type genomic sequence and guide target(s), or batch-load with Excel.',
      points: [
        {
          title: 'Sequence Input',
          text: 'Paste the WT reference sequence and 19-25 bp guide. Cut sites and PAM locations are detected automatically.'
        },
        {
          title: 'Auto Fill',
          text: 'Click "Auto Fill" to download an Excel template, fill in dozens of targets, and upload in 1 second.'
        },
        {
          title: 'Config per File',
          text: 'Enable when multiplexed FASTQ libraries require different reference sequences.'
        }
      ],
      tip: 'You can add multiple guide RNA targets within the same reference amplicon.',
      targetSelector: '#guide-targets-section'
    },

    // ── Step 4: Window Check ──
    {
      id: 'window-check',
      stepTitle: 'Window Check',
      headline: 'Window Check & Similarity Indicator',
      summary: 'Preview the sequence cleavage span and check homoeolog sequence similarity.',
      points: [
        {
          title: 'Visual Locus',
          text: 'Inspect the sequence centered around the cut site to ensure expected deletions stay within window bounds.'
        },
        {
          title: 'Similarity Metric',
          text: 'Calculates pairwise sequence identity between homoeologs.'
        }
      ],
      tip: 'High similarity (e.g. >98%) is a direct indicator to increase your Assignment Margin parameter!',
      targetSelector: '#guide-window-check-btn'
    },

    // ── Step 5: Parameters ──
    {
      id: 'parameters',
      stepTitle: 'Parameters',
      headline: 'Parameters & Advanced Settings',
      summary: 'Fine-tune analysis window boundaries, noise thresholds, and mutation weights.',
      points: [
        {
          title: 'Core Controls',
          text: 'Set Window Size (bp around cut site), Assignment Margin (% score difference for demux), and Indel Threshold (% noise filter).'
        },
        {
          title: 'Advanced',
          text: 'Open "Advanced" to use Cut Site Exclusion and Distance Weight so large deletions do not skew classification.'
        }
      ],
      tip: 'Phred threshold automatically filters out low-quality sequencing reads.',
      targetSelector: '#guide-controls-grid'
    },

    // ── Step 6: Run & Viewers ──
    {
      id: 'run-and-view',
      stepTitle: 'Run & Viewers',
      headline: 'Run Analysis & Explore Dashboards',
      summary: 'Start local multi-worker processing and explore interactive result viewers.',
      points: [
        {
          title: 'Local Analysis',
          text: 'Click "Start Local Analysis" to run. Real-time progress bars track each file on dedicated threads.'
        },
        {
          title: 'Result Viewer',
          text: 'Export comprehensive Excel (.xlsx) files and reload them into the Result Viewer anytime.'
        },
        {
          title: 'Benchmark',
          text: 'Compare assignment yield and accuracy head-to-head against CRISPResso2.'
        }
      ],
      tip: 'You are all set! Click "Finish Guide" to begin analyzing your CRISPR data.',
      targetSelector: '#guide-run-btn'
    }
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  get currentStep(): GuideStep {
    return this.steps[this.currentStepIndex];
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.steps.length - 1;
  }

  ngOnInit() {
    this.updateLayout();
  }

  ngOnDestroy() {}

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
    const sel = this.currentStep.targetSelector;
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    setTimeout(() => this.updateLayout(), 160);
    setTimeout(() => this.updateLayout(), 350);
  }

  private updateLayout() {
    if (this.currentStep.isIntro || !this.currentStep.targetSelector) {
      this.targetRect = null;
      this.pathD = '';
      this.cdr.detectChanges();
      return;
    }

    const el = document.querySelector(this.currentStep.targetSelector);
    if (!el) {
      this.targetRect = null;
      this.pathD = '';
      this.cdr.detectChanges();
      return;
    }

    const rect = el.getBoundingClientRect();
    this.targetRect = rect;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(460, Math.max(300, vw - 36));
    const cardHeight = 290;

    // Calculate whether card should be below or above target
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    let cTop = 0;
    let cLeft = rect.left + (rect.width - cardWidth) / 2;

    // Arrow coordinates
    let sX = rect.left + rect.width / 2;
    let sY = 0;
    let eX = 0;
    let eY = 0;

    if (spaceBelow >= cardHeight + 35 || spaceBelow >= spaceAbove) {
      // Place card below target
      cTop = rect.bottom + 35;
      sY = rect.bottom + 4;
      eY = cTop;
    } else {
      // Place card above target
      cTop = rect.top - cardHeight - 35;
      sY = rect.top - 4;
      eY = cTop + cardHeight;
    }

    // Clamp coordinates to viewport
    cLeft = Math.max(18, Math.min(vw - cardWidth - 18, cLeft));
    cTop = Math.max(18, Math.min(vh - cardHeight - 18, cTop));

    eX = Math.max(cLeft + 30, Math.min(cLeft + cardWidth - 30, sX));

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
