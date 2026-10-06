import { Component, EventEmitter, Output, Input, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TutorialStep {
  id: string;
  category: 'intro' | 'prereq' | 'tool' | 'finish';
  title: string;
  subtitle?: string;
  content: string;
  keyPoints?: string[];
  callout?: string;
  targetSelector?: string;
  mascotPose?: 'wave' | 'explain' | 'point' | 'excited' | 'sparkle';
  badge?: string;
}

@Component({
  selector: 'app-tutorial-guide',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tutorial-backdrop" (click)="onBackdropClick($event)">
      <!-- Highlight Spotlight box around targeted element -->
      <div class="spotlight-box" *ngIf="spotlightRect" [ngStyle]="spotlightStyle">
        <div class="spotlight-pulse"></div>
        <div class="spotlight-badge">{{ currentStep.badge || 'STEP ' + currentStepNumber }}</div>
      </div>

      <!-- Mascot Companion with Floating Dialogue Box -->
      <div class="tutorial-stage" [ngStyle]="stagePositionStyle" (click)="$event.stopPropagation()">
        <!-- Character Avatar / Mascot -->
        <div class="mascot-actor" [class.emerging]="isEmerging" [class.speaking]="isSpeaking">
          <div class="avatar-ring">
            <img src="casmango-logo.jpg" alt="Mango Mascot" class="mascot-avatar-img" />
            <span class="mascot-sparkle-fx">✨</span>
          </div>
          <div class="mascot-nametag">
            <span class="nametag-name">Mango Guide</span>
            <span class="nametag-dot"></span>
          </div>
        </div>

        <!-- Interactive Dialogue Box -->
        <div class="dialogue-card" [class.intro-card]="currentStep.category === 'intro'">
          <header class="dialogue-header">
            <div class="step-progress-pill">
              <span class="pill-category">{{ categoryLabel }}</span>
              <span class="pill-divider">·</span>
              <span class="pill-counter">{{ currentStepIndex + 1 }} / {{ steps.length }}</span>
            </div>
            <div class="dialogue-actions">
              <button *ngIf="currentStep.category === 'intro'" type="button" class="btn-skip-intro" (click)="skipIntro()">
                Skip Intro ⏭
              </button>
              <button type="button" class="btn-close-guide" (click)="closeGuide()" title="Exit Guide">
                &times;
              </button>
            </div>
          </header>

          <main class="dialogue-body">
            <h3 class="dialogue-title">{{ currentStep.title }}</h3>
            <p class="dialogue-subtitle" *ngIf="currentStep.subtitle">{{ currentStep.subtitle }}</p>
            
            <div class="dialogue-text">
              <p>{{ currentStep.content }}</p>
            </div>

            <ul class="dialogue-points" *ngIf="currentStep.keyPoints?.length">
              <li *ngFor="let point of currentStep.keyPoints">
                <span class="point-bullet">🥭</span>
                <span class="point-desc">{{ point }}</span>
              </li>
            </ul>

            <div class="dialogue-callout" *ngIf="currentStep.callout">
              <span class="callout-icon">💡</span>
              <span class="callout-text">{{ currentStep.callout }}</span>
            </div>
          </main>

          <footer class="dialogue-footer">
            <div class="progress-track">
              <div class="progress-fill" [style.width.%]="((currentStepIndex + 1) / steps.length) * 100"></div>
            </div>

            <div class="dialogue-nav-buttons">
              <button type="button" class="btn-nav-prev" [disabled]="currentStepIndex === 0" (click)="prevStep()">
                ← Prev
              </button>
              <button type="button" class="btn-nav-next" (click)="nextStep()">
                {{ isLastStep ? 'Got it! Start Exploring 🎉' : 'Next Step →' }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .tutorial-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: backdropFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      pointer-events: auto;
    }

    @keyframes backdropFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* ── Spotlight on actual UI elements ── */
    .spotlight-box {
      position: fixed;
      z-index: 10001;
      border: 2px solid #f59e0b;
      background: rgba(245, 158, 11, 0.08);
      border-radius: 12px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.62), 0 0 25px rgba(245, 158, 11, 0.45);
      pointer-events: none;
      transition: all 0.4s cubic-bezier(0.2, 0.9, 0.3, 1);
    }

    .spotlight-pulse {
      position: absolute;
      inset: -6px;
      border: 2px dashed rgba(245, 158, 11, 0.6);
      border-radius: 16px;
      animation: pulseRotate 12s linear infinite;
    }

    @keyframes pulseRotate {
      0% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.02); opacity: 0.3; }
      100% { transform: scale(1); opacity: 0.8; }
    }

    .spotlight-badge {
      position: absolute;
      top: -14px;
      left: 14px;
      background: #f59e0b;
      color: #78350f;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 10px;
      border-radius: 999px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }

    /* ── Main Stage for Character & Dialogue ── */
    .tutorial-stage {
      position: fixed;
      z-index: 10002;
      display: flex;
      align-items: flex-start;
      gap: 16px;
      max-width: 580px;
      width: calc(100vw - 40px);
      transition: all 0.45s cubic-bezier(0.2, 0.9, 0.3, 1);
    }

    /* ── Mascot Actor ── */
    .mascot-actor {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
      animation: mascotBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes mascotBounce {
      0% { transform: scale(0) translateY(50px) rotate(-15deg); opacity: 0; }
      70% { transform: scale(1.15) translateY(-6px) rotate(4deg); opacity: 1; }
      100% { transform: scale(1) translateY(0) rotate(0deg); opacity: 1; }
    }

    .avatar-ring {
      position: relative;
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #ffffff;
      padding: 4px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 0 0 4px #f59e0b;
      animation: mascotFloat 3.5s ease-in-out infinite;
    }

    @keyframes mascotFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }

    .mascot-avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      display: block;
    }

    .mascot-sparkle-fx {
      position: absolute;
      top: -8px;
      right: -6px;
      font-size: 18px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
      animation: sparkleRotate 2.5s ease-in-out infinite;
    }

    @keyframes sparkleRotate {
      0%, 100% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(15deg) scale(1.2); }
    }

    .mascot-nametag {
      margin-top: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(245, 158, 11, 0.4);
      padding: 3px 10px;
      border-radius: 999px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    .nametag-name {
      font-size: 11px;
      font-weight: 700;
      color: #fbbf24;
      letter-spacing: 0.02em;
    }

    .nametag-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 6px #10b981;
    }

    /* ── RPG-style Dialogue Card ── */
    .dialogue-card {
      flex: 1;
      background: #ffffff;
      border-radius: 18px;
      padding: 22px 24px;
      box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(226, 232, 240, 0.8);
      position: relative;
      animation: cardPop 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes cardPop {
      from { transform: translateY(12px) scale(0.97); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }

    .dialogue-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #f1f5f9;
    }

    .step-progress-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: #d97706;
      background: #fef3c7;
      padding: 3px 10px;
      border-radius: 999px;
    }

    .pill-category {
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .pill-counter {
      color: #92400e;
    }

    .dialogue-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-skip-intro {
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-skip-intro:hover {
      background: #e2e8f0;
      color: #334155;
    }

    .btn-close-guide {
      background: none;
      border: none;
      font-size: 20px;
      line-height: 1;
      color: #94a3b8;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .btn-close-guide:hover {
      color: #0f172a;
      background: #f1f5f9;
    }

    .dialogue-title {
      margin: 0 0 6px 0;
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.01em;
    }

    .dialogue-subtitle {
      margin: 0 0 12px 0;
      font-size: 12.5px;
      font-weight: 600;
      color: #d97706;
    }

    .dialogue-text p {
      margin: 0 0 12px 0;
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
    }

    .dialogue-points {
      list-style: none;
      margin: 0 0 12px 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .dialogue-points li {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 13.5px;
      line-height: 1.5;
      color: #1e293b;
      background: #f8fafc;
      padding: 7px 10px;
      border-radius: 8px;
      border: 1px solid #f1f5f9;
    }

    .point-bullet {
      font-size: 14px;
      line-height: 1.3;
      flex-shrink: 0;
    }

    .dialogue-callout {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: #fffbeb;
      border: 1px solid #fef3c7;
      padding: 9px 12px;
      border-radius: 10px;
      font-size: 12.5px;
      line-height: 1.5;
      color: #92400e;
      margin-bottom: 14px;
    }

    .callout-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .dialogue-footer {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .progress-track {
      height: 4px;
      background: #f1f5f9;
      border-radius: 999px;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #10b981);
      border-radius: 999px;
      transition: width 0.3s ease;
    }

    .dialogue-nav-buttons {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
    }

    .btn-nav-prev {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      color: #64748b;
      padding: 7px 14px;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-nav-prev:hover:not(:disabled) {
      background: #f1f5f9;
      color: #1e293b;
    }

    .btn-nav-prev:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .btn-nav-next {
      background: #0f172a;
      border: 1px solid #0f172a;
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.2);
      transition: all 0.15s ease;
    }

    .btn-nav-next:hover {
      background: #f59e0b;
      border-color: #f59e0b;
      color: #78350f;
      transform: translateY(-1px);
    }

    @media (max-width: 640px) {
      .tutorial-stage {
        flex-direction: column;
        align-items: center;
      }
      .mascot-actor {
        flex-direction: row;
        gap: 10px;
      }
      .avatar-ring {
        width: 52px;
        height: 52px;
      }
    }
  `]
})
export class TutorialGuideComponent implements OnInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() requestTab = new EventEmitter<'analysis' | 'viewer' | 'benchmark' | 'workspace'>();

  currentStepIndex = 0;
  isEmerging = true;
  isSpeaking = false;
  spotlightRect: DOMRect | null = null;

  steps: TutorialStep[] = [
    // ── 0. Introduction ──
    {
      id: 'intro',
      category: 'intro',
      title: "Hey there! I'm Mango 🥭",
      subtitle: "Welcome to CasMANGO — Fast & Private Browser CRISPR Analysis",
      content: "CasMANGO stands for CRISPR Analysis System for Mutation Assessment of Next-Generation & Oxford Nanopore data. Everything runs 100% locally right inside your web browser — none of your sequencing FASTQ files are ever sent to an external server!",
      keyPoints: [
        "Private & Client-Side: Zero cloud upload risk for your proprietary genomic data.",
        "Universal Sequencing Support: Illumina (paired/single) & Oxford Nanopore.",
        "High-Resolution Demultiplexing: Resolves complex polyploid homoeologs with ease."
      ],
      callout: "Click 'Next Step' to follow the tour, or 'Skip Intro' to dive straight into input setup!",
      mascotPose: 'wave'
    },
    // ── 1. Prerequisites ──
    {
      id: 'prerequisites',
      category: 'prereq',
      title: "Required Inputs Checklist 📋",
      subtitle: "3 Essential Ingredients for CRISPR Analysis",
      content: "Before starting your analysis, ensure you have the following 3 elements ready:",
      keyPoints: [
        "1. Sequencing FASTQ File(s): .fastq, .fq, or .fastq.gz from Illumina or Nanopore.",
        "2. Gene Reference Sequence: The wild-type amplicon sequence.",
        "3. gRNA Target Sequence(s): 19-25 bp guide RNA target(s) with cut sites."
      ],
      callout: "All references and targets can also be batch auto-filled via an Excel template in just one click!",
      mascotPose: 'explain'
    },
    // ── 2. Platform & Mode Selection ──
    {
      id: 'platform-mode',
      category: 'tool',
      title: "1. Select Platform & Mode ⚙️",
      subtitle: "Illumina / Nanopore & Standard / Homoeolog",
      content: "CasMANGO supports both Oxford Nanopore long reads and Illumina paired/single-end short reads.",
      keyPoints: [
        "Nanopore Mode: Tuned for long read indel calling and terminal anchor checks.",
        "Illumina Mode: Auto-pairs R1/R2 and uses intelligent X-padding for non-overlapping reads.",
        "Standard vs Homoeolog Mode: Both perform identical deep indel profiling. Homoeolog mode additionally demultiplexes polyploid subgenomes (e.g. wheat 4A/4B/4D, canola A/C) and models cross-genome relations."
      ],
      callout: "Use Standard mode for typical single-target CRISPR experiments, and Homoeolog mode for polyploid genomes or pooled paralogs.",
      targetSelector: '.sequencing-platform-field',
      badge: 'PLATFORM'
    },
    // ── 3. File Upload ──
    {
      id: 'file-upload',
      category: 'tool',
      title: "2. Fastq File Upload 📂",
      subtitle: "Drag & Drop Local Fastq Files",
      content: "Simply drag and drop your FASTQ files (.fastq, .fq, .fastq.gz) directly onto the upload zone.",
      keyPoints: [
        "Automatic Mate Pairing: In Illumina mode, CasMANGO inspects filenames and automatically links R1 and R2 pairs.",
        "Multi-file Batch: Drop multiple files or libraries simultaneously for parallel browser worker processing."
      ],
      callout: "Because processing runs entirely in Web Workers on your machine, your raw sequencing reads never leave your computer.",
      targetSelector: '.upload-zone',
      badge: 'UPLOAD'
    },
    // ── 4. Reference & Target Setup ──
    {
      id: 'ref-target',
      category: 'tool',
      title: "3. Reference & Guide Targets 🧬",
      subtitle: "Manual Entry or 1-Click Auto Fill",
      content: "Configure your target genes and guide RNAs in the Reference Configuration section below.",
      keyPoints: [
        "Manual Input: Type or paste your gene name, reference sequence, target ID, and gRNA sequence.",
        "Auto Fill (Excel): Download our template, fill your genes/guides, and upload to configure in seconds.",
        "Config per File: If different FASTQ libraries target different genes, enable 'Config per File' to assign custom references per sample!"
      ],
      callout: "Look for the 'Auto Fill' and 'Config per File' buttons right above the reference cards.",
      targetSelector: '.targets-section .section-header',
      badge: 'REFERENCE'
    },
    // ── 5. Window Check ──
    {
      id: 'window-check',
      category: 'tool',
      title: "4. Window Check & Matrix (Optional) 🔍",
      subtitle: "Visual Cut-Site Verification & Homoeolog Matrix",
      content: "Click 'Window Check' to visually inspect the exact analysis window centered around your gRNA cleavage site.",
      keyPoints: [
        "Visual Reference Window: See exactly which flanking nucleotides will be analyzed based on your window size (e.g. 120 bp, 190 bp).",
        "Pairwise Similarity Matrix: In Homoeolog mode, calculates exact sequence similarity percentages across all homoeolog pairs.",
        "Margin Guidance: Sequence similarity scores give you a direct metric to determine optimal Assignment Margin (%) parameters."
      ],
      callout: "Extremely helpful before running to ensure your window covers all editing-relevant flanking bases without bleed-through.",
      targetSelector: '.btn-window-check',
      badge: 'WINDOW CHECK'
    },
    // ── 6. Parameter Tuning & Advanced Features ──
    {
      id: 'parameters',
      category: 'tool',
      title: "5. Parameters & Advanced Classification 🎛️",
      subtitle: "Fine-tune Accuracy, Noise Filtering & Indel Weights",
      content: "Customize analysis parameters to match your specific library quality and biological question:",
      keyPoints: [
        "Window Size (bp): Total nucleotide span evaluated around the cut site.",
        "Assignment Margin (%): Minimum alignment advantage required to confidently assign a read to a homoeolog (prevents false positive cross-calls).",
        "Indel Threshold (%): Filters sequencing noise below this frequency.",
        "Advanced — Asymmetric Custom Windows: Split left and right flanks unequally.",
        "Advanced — Distance Weight & Exclusion: Down-weight indels right at the cut site or up-weight distant SNVs so editing doesn't disrupt subgenome classification!"
      ],
      callout: "Click the 'Advanced ▼' button above Reference Configuration to reveal Cut Site Exclusion and Distance Weight controls.",
      targetSelector: '.analysis-controls-grid',
      badge: 'PARAMETERS'
    },
    // ── 7. Run & Overview ──
    {
      id: 'run-analysis',
      category: 'tool',
      title: "Ready to Run! 🚀",
      subtitle: "Hit 'Start Local Analysis' to Begin",
      content: "Once files and references are set, hit 'Start Local Analysis'. Multi-threaded Web Workers will crunch your reads in parallel with real-time progress bars.",
      keyPoints: [
        "Real-time Dashboard: Interactive frequency plots, indel size histograms, and WT/edited fractions.",
        "Result Viewer: Save results as Excel (.xlsx) and reopen anytime in the 'Result Viewer' tab.",
        "Benchmark: Directly benchmark classification accuracy and read merge methods against CRISPResso2!"
      ],
      callout: "You're all set! Enjoy using CasMANGO for your CRISPR research.",
      targetSelector: 'button.btn-primary',
      badge: 'RUN'
    }
  ];

  constructor(private cdr: ChangeDetectorRef) {}

  get currentStep(): TutorialStep {
    return this.steps[this.currentStepIndex];
  }

  get currentStepNumber(): number {
    return this.currentStepIndex + 1;
  }

  get isLastStep(): boolean {
    return this.currentStepIndex === this.steps.length - 1;
  }

  get categoryLabel(): string {
    switch (this.currentStep.category) {
      case 'intro': return 'Introduction';
      case 'prereq': return 'Checklist';
      case 'tool': return 'Interactive Walkthrough';
      default: return 'Guide';
    }
  }

  ngOnInit() {
    this.updateSpotlight();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('scroll', this.onScroll, true);
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('scroll', this.onScroll, true);
  }

  private onResize = () => this.updateSpotlight();
  private onScroll = () => this.updateSpotlight();

  nextStep() {
    if (this.isLastStep) {
      this.closeGuide();
      return;
    }
    this.currentStepIndex++;
    this.updateSpotlight();
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.updateSpotlight();
    }
  }

  skipIntro() {
    // Jump straight to prerequisite or first tool step
    const firstToolIndex = this.steps.findIndex(s => s.category === 'prereq' || s.category === 'tool');
    if (firstToolIndex !== -1) {
      this.currentStepIndex = firstToolIndex;
      this.updateSpotlight();
    }
  }

  closeGuide() {
    this.close.emit();
  }

  onBackdropClick(event: MouseEvent) {
    // Prevent accidental closing by clicking backdrop; keep guided interaction focused
  }

  private updateSpotlight() {
    const sel = this.currentStep.targetSelector;
    if (sel) {
      setTimeout(() => {
        const el = document.querySelector(sel);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            const rect = el.getBoundingClientRect();
            this.spotlightRect = rect;
            this.cdr.detectChanges();
          }, 300);
          return;
        }
        this.spotlightRect = null;
        this.cdr.detectChanges();
      }, 50);
    } else {
      this.spotlightRect = null;
    }
  }

  get spotlightStyle(): { [key: string]: string } {
    if (!this.spotlightRect) return { display: 'none' };
    const padding = 10;
    return {
      top: `${Math.max(10, this.spotlightRect.top - padding)}px`,
      left: `${Math.max(10, this.spotlightRect.left - padding)}px`,
      width: `${this.spotlightRect.width + padding * 2}px`,
      height: `${this.spotlightRect.height + padding * 2}px`
    };
  }

  get stagePositionStyle(): { [key: string]: string } {
    if (!this.spotlightRect) {
      // Center stage for intro/prereq
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)'
      };
    }

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const cardHeight = 360;
    const cardWidth = Math.min(580, viewportWidth - 40);

    const spaceBelow = viewportHeight - this.spotlightRect.bottom;
    const spaceAbove = this.spotlightRect.top;

    let top = 0;
    let left = Math.max(20, Math.min(this.spotlightRect.left, viewportWidth - cardWidth - 20));

    if (spaceBelow > cardHeight + 40 || spaceBelow >= spaceAbove) {
      // Position below target
      top = Math.min(viewportHeight - cardHeight - 20, this.spotlightRect.bottom + 20);
    } else {
      // Position above target
      top = Math.max(20, this.spotlightRect.top - cardHeight - 20);
    }

    return {
      top: `${top}px`,
      left: `${left}px`
    };
  }
}
