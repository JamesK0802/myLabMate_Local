import { Component, EventEmitter, Output, OnDestroy, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface AdvantageCard {
  title: string;
  desc: string;
  badge?: string;
}

export interface GuideStep {
  id: string;
  stepNum: number;
  totalSteps: number;
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

      <!-- ── Spotlight Hole with 0% Tint Inside (Clear Cutout) ── -->
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
          <!-- Close Button -->
          <button type="button" class="btn-close" (click)="closeGuide()" title="Close Guide (Esc)">✕</button>

          <!-- Stage Badge & Headline -->
          <div class="bubble-header">
            <span class="bubble-badge" *ngIf="!currentStep.isIntro && !currentStep.isPrereq">
              STEP {{ currentStep.stepNum }} / {{ currentStep.totalSteps }} · {{ currentStep.stageName }}
            </span>
            <span class="bubble-badge intro-badge" *ngIf="currentStep.isIntro || currentStep.isPrereq">
              {{ currentStep.stageName }}
            </span>
          </div>

          <h3 class="bubble-headline">{{ currentStep.headline }}</h3>

          <!-- Intro 1-line tool explanation -->
          <p class="bubble-intro-line" *ngIf="currentStep.introLine">
            {{ currentStep.introLine }}
          </p>

          <!-- 3 Advantage Cards (Intro & Prereq) -->
          <div class="cards-grid" *ngIf="currentStep.cards && currentStep.cards.length > 0">
            <div class="grid-card" *ngFor="let card of currentStep.cards">
              <span class="grid-card-badge" *ngIf="card.badge">{{ card.badge }}</span>
              <h4 class="grid-card-title">{{ card.title }}</h4>
              <p class="grid-card-desc">{{ card.desc }}</p>
            </div>
          </div>

          <!-- Minimal 1-2 lines text explanation (Tour Steps) -->
          <div class="text-lines-block" *ngIf="currentStep.textLines && currentStep.textLines.length > 0">
            <p class="text-line" *ngFor="let line of currentStep.textLines">{{ line }}</p>
          </div>

          <!-- Footer Actions -->
          <div class="bubble-footer">
            <button type="button"
                    class="btn-guide-back"
                    *ngIf="currentStepIndex > 0"
                    (click)="prevStep()">
              ◀ 이전
            </button>

            <!-- Progress dots -->
            <div class="dots-track">
              <span *ngFor="let s of steps; let i = index"
                    class="step-dot"
                    [class.active]="i === currentStepIndex"
                    (click)="goToStep(i)"
                    [title]="s.stageName"></span>
            </div>

            <button type="button"
                    class="btn-guide-next"
                    (click)="nextStep()">
              {{ currentStep.nextButtonText || '다음 ▶' }}
            </button>
          </div>
        </div>
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

    /* Default backdrop when on Intro / Prereq without target spotlight */
    .guide-root.no-target {
      background: rgba(15, 23, 42, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* ── Spotlight Hole: 0% Tint Inside, Covers Rest of Viewport with Shadow ── */
    .spotlight-hole {
      position: fixed;
      z-index: 10001;
      border: 3px solid #f59e0b;
      border-radius: 10px;
      /* Massive box-shadow darkens the rest of the screen, leaving inside crystal-clear! */
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.55), 0 0 18px rgba(245, 158, 11, 0.4);
      pointer-events: none;
      transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .spotlight-label {
      position: absolute;
      top: -12px;
      left: 12px;
      background: #f59e0b;
      color: #0f172a;
      font-size: 10.5px;
      font-weight: 900;
      letter-spacing: 0.05em;
      padding: 1px 9px;
      border-radius: 999px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
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
      gap: 16px;
      max-width: 680px;
      width: calc(100vw - 36px);
      pointer-events: auto;
      transition: top 0.15s cubic-bezier(0.16, 1, 0.3, 1), left 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      animation: dialogPop 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    .guide-dialog-wrapper.is-centered {
      position: relative;
      max-width: 740px;
      margin: auto;
    }

    @keyframes dialogPop {
      from { transform: scale(0.96); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    /* ── Character Mascot Column (Left) ── */
    .mascot-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      margin-top: 8px;
    }

    .mascot-avatar-frame {
      position: relative;
      width: 58px;
      height: 58px;
    }

    .mascot-avatar-img {
      width: 100%;
      height: 100%;
      border-radius: 14px;
      border: 2.5px solid #f59e0b;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
      object-fit: cover;
      background: #ffffff;
    }

    .mascot-live-indicator {
      position: absolute;
      bottom: -2px;
      right: -2px;
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #10b981;
      border: 2px solid #ffffff;
    }

    .mascot-tag {
      font-size: 11px;
      font-weight: 800;
      color: #ffffff;
      background: rgba(15, 23, 42, 0.75);
      padding: 2px 8px;
      border-radius: 999px;
      letter-spacing: 0.04em;
    }

    /* ── Speech Bubble (Right) ── */
    .bubble-content {
      position: relative;
      background: #ffffff;
      color: #1e293b;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.08);
      padding: 20px 24px 16px 24px;
      flex: 1;
      min-width: 0;
    }

    /* Speech bubble arrow notch pointing toward the mascot */
    .bubble-content::before {
      content: '';
      position: absolute;
      top: 24px;
      left: -9px;
      width: 0;
      height: 0;
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-right: 9px solid #ffffff;
    }

    .btn-close {
      position: absolute;
      top: 14px;
      right: 14px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #64748b;
      width: 26px;
      height: 26px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .btn-close:hover {
      background: #fee2e2;
      color: #ef4444;
      border-color: #fca5a5;
    }

    .bubble-header {
      margin-bottom: 6px;
    }

    .bubble-badge {
      font-size: 10.5px;
      font-weight: 800;
      color: #ea580c;
      background: #fff7ed;
      border: 1px solid #ffedd5;
      padding: 2px 8px;
      border-radius: 6px;
      letter-spacing: 0.04em;
    }

    .bubble-badge.intro-badge {
      color: #0369a1;
      background: #f0f9ff;
      border-color: #e0f2fe;
    }

    .bubble-headline {
      margin: 4px 0 6px 0;
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.01em;
    }

    .bubble-intro-line {
      margin: 0 0 14px 0;
      font-size: 13.5px;
      color: #475569;
      line-height: 1.5;
    }

    /* ── 3 Cards Grid (Intro & Prereq) ── */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 14px;
    }

    .grid-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
    }

    .grid-card-badge {
      font-size: 9.5px;
      font-weight: 800;
      color: #f59e0b;
      margin-bottom: 4px;
      letter-spacing: 0.05em;
    }

    .grid-card-title {
      margin: 0 0 6px 0;
      font-size: 13.5px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.3;
    }

    .grid-card-desc {
      margin: 0;
      font-size: 11.5px;
      color: #475569;
      line-height: 1.45;
    }

    /* ── Minimal 1-2 Lines Text (Tour Steps) ── */
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

    /* ── Footer ── */
    .bubble-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid #f1f5f9;
      padding-top: 12px;
    }

    .dots-track {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .step-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #cbd5e1;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .step-dot.active {
      width: 18px;
      background: #f59e0b;
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
    }

    .btn-guide-back {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      color: #475569;
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-guide-back:hover {
      background: #e2e8f0;
      color: #1e293b;
    }

    .btn-guide-next {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border: none;
      color: #ffffff;
      padding: 7px 18px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 800;
      cursor: pointer;
      margin-left: auto;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
      transition: all 0.15s ease;
    }

    .btn-guide-next:hover {
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.45);
    }

    @media (max-width: 640px) {
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
    // ── 0. Intro (소개) ──
    {
      id: 'intro',
      stepNum: 0,
      totalSteps: 6,
      stageName: '안내 시작',
      headline: '안녕하세요! CasMANGO 가이드입니다.',
      introLine: 'CasMANGO는 브라우저 로컬에서 안전하고 빠르게 분석하는 다중 풀링 CRISPR amplicon 분석 도구입니다.',
      cards: [
        {
          badge: '보안 & 프라이버시',
          title: '100% 로컬 분석',
          desc: 'FASTQ 파일이 외부 서버로 전송되지 않고 브라우저 Web Worker에서 즉시 분석됩니다.'
        },
        {
          badge: '플랫폼 호환',
          title: 'Illumina & Nanopore',
          desc: '짧은 Illumina paired-end부터 긴 Oxford Nanopore 리드까지 모두 지원 (.gz 지원).'
        },
        {
          badge: '다배체 특화',
          title: '0% 오할당 분리',
          desc: '동질유전자(Homeolog) 간 미세한 차이를 정밀 분리하여 교차 오할당을 방지합니다.'
        }
      ],
      nextButtonText: '다음 ▶',
      isIntro: true
    },

    // ── 1. Prerequisites (준비물) ──
    {
      id: 'prerequisites',
      stepNum: 0,
      totalSteps: 6,
      stageName: '필수 준비물',
      headline: '분석 전 3가지 필수 준비물이에요',
      introLine: '아래 3가지 정보만 준비되면 바로 브라우저에서 분석을 시작할 수 있습니다.',
      cards: [
        {
          badge: '입력 1',
          title: 'FASTQ 파일',
          desc: '지원 포맷: .fastq, .fq, .fastq.gz, .fq.gz (Illumina 또는 Nanopore 시퀀싱 파일)'
        },
        {
          badge: '입력 2',
          title: 'Gene Reference',
          desc: '리드(Read)가 정렬 및 비교될 기준 Wild-Type 유전자 서열 정보입니다.'
        },
        {
          badge: '입력 3',
          title: 'gRNA Target',
          desc: '절단(Cut site) 및 유전자 교정 타겟 지점을 확인하기 위한 가이드 서열입니다.'
        }
      ],
      nextButtonText: '시작하기 ▶',
      isPrereq: true
    },

    // ── 2. Platform & Reference Mode (플랫폼 및 모드 선택) ──
    {
      id: 'platform-mode',
      stepNum: 1,
      totalSteps: 6,
      stageName: '플랫폼 및 모드',
      headline: '시퀀싱 플랫폼과 분석 모드를 선택하세요',
      textLines: [
        '• 플랫폼: Illumina(자동 R1/R2 페어링 및 갭 패딩) 또는 Nanopore(롱리드 정렬)를 선택합니다.',
        '• 참조 모드: 일반 분석은 Standard를, 밀·유채 등 다배체 작물의 동질유전자 관계까지 함께 분석하려면 Homeolog 모드를 선택하세요.'
      ],
      targetSelector: '#guide-platform-section',
      nextButtonText: '다음 ▶'
    },

    // ── 3. File Upload (파일 업로드) ──
    {
      id: 'file-upload',
      stepNum: 2,
      totalSteps: 6,
      stageName: '파일 업로드',
      headline: 'FASTQ 파일을 드래그 & 드롭으로 업로드하세요',
      textLines: [
        '• .fastq, .fq 및 압축된 .fastq.gz, .fq.gz 파일을 바로 업로드할 수 있습니다.',
        '• Illumina Paired-end 파일은 파일명(R1, R2)에 따라 자동으로 묶입니다.',
        '• 모든 파일은 브라우저 백그라운드 스레드에서 병렬로 안전하게 파싱됩니다.'
      ],
      targetSelector: '#guide-upload-zone',
      nextButtonText: '다음 ▶'
    },

    // ── 4. Ref & Target Config (Ref / Target 입력) ──
    {
      id: 'ref-config',
      stepNum: 3,
      totalSteps: 6,
      stageName: 'Ref / Target 설정',
      headline: '참조 서열과 타겟 gRNA를 입력하세요',
      textLines: [
        '• Reference Sequence와 타겟 서열을 입력하면 절단 위치가 자동으로 계산됩니다.',
        '• 상단의 Auto Fill로 엑셀 템플릿을 다운로드/업로드하여 여러 유전자를 한 번에 자동 입력할 수 있습니다.',
        '• 파일별로 서열 구성이 다르다면 Config per File로 개별 지정도 가능합니다.'
      ],
      targetSelector: '#guide-targets-section',
      nextButtonText: '다음 ▶'
    },

    // ── 5. Window Check (Window Check) ──
    {
      id: 'window-check',
      stepNum: 4,
      totalSteps: 6,
      stageName: 'Window Check',
      headline: 'Window Check로 서열과 유사도를 확인하세요',
      textLines: [
        '• 절단 부위 주변 서열과 설정한 윈도우 범위를 시각적으로 확인하여 Indel 누락을 방지합니다.',
        '• Homeolog 모드에서는 변형 간의 서열 유사도(Similarity Matrix)를 확인하여 Assignment Margin 파라미터 결정의 핵심 지표로 활용할 수 있습니다.'
      ],
      targetSelector: '#guide-window-check-btn',
      nextButtonText: '다음 ▶'
    },

    // ── 6. Parameters (Parameter 설정) ──
    {
      id: 'parameters',
      stepNum: 5,
      totalSteps: 6,
      stageName: '파라미터 설정',
      headline: '분석 파라미터 및 고급 옵션을 조정하세요',
      textLines: [
        '• Window Size(분석 폭), Phred 품질 점수, Margin(할당 마진), Indel Threshold(노이즈 필터)를 설정합니다.',
        '• Advanced에서는 절단 부위 기준 비대칭 윈도우, Cut-site 근처 제외(Exclusion), 거리 가중치(Distance Weight)를 주어 대형 결실이 할당을 왜곡하지 않도록 방지할 수 있습니다.'
      ],
      targetSelector: '#guide-controls-grid',
      nextButtonText: '다음 ▶'
    },

    // ── 7. Run & Beyond (실행 및 결과/뷰어/벤치마크) ──
    {
      id: 'run-and-view',
      stepNum: 6,
      totalSteps: 6,
      stageName: '분석 실행',
      headline: 'Start Local Analysis 버튼으로 분석을 시작하세요',
      textLines: [
        '• 분석 버튼을 누르면 브라우저 로컬 워커가 즉시 실행되며 실시간 진행률이 표시됩니다.',
        '• 분석 결과를 Excel(.xlsx)로 내보낸 뒤, 상단 Result Viewer 탭에 드롭하면 언제든 재계산 없이 결과를 다시 확인할 수 있습니다.',
        '• Benchmark 탭에서는 기존 툴과의 정밀도 비교 분석도 지원합니다.'
      ],
      targetSelector: '#guide-run-btn',
      nextButtonText: '가이드 완료 ✕'
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
    this.onStepChanged();
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.onStepChanged();
    }
  }

  goToStep(index: number) {
    if (index >= 0 && index < this.steps.length) {
      this.currentStepIndex = index;
      this.onStepChanged();
    }
  }

  closeGuide() {
    this.close.emit();
  }

  /**
   * Instantly switch target and scroll smoothly without any sluggish delays.
   */
  private onStepChanged() {
    const sel = this.currentStep.targetSelector;
    if (sel) {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // Update immediately (0ms delay!)
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
    const cardWidth = Math.min(620, Math.max(320, vw - 36));
    const cardEstimatedHeight = 250;

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
    cLeft = Math.max(18, Math.min(vw - cardWidth - 18, cLeft));
    cTop = Math.max(20, Math.min(vh - cardEstimatedHeight - 20, cTop));

    eX = Math.max(cLeft + 40, Math.min(cLeft + cardWidth - 40, sX));

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
