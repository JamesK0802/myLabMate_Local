import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequenceDocument, SequenceFeature } from '../../models/sequence.model';

interface LinearFeature {
  feat: SequenceFeature;
  leftPct: number;
  widthPct: number;
}

@Component({
  selector: 'app-linear-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="linear-container">
      <div class="map-header">
        <span class="map-title">{{ document.name || 'Sequence' }}</span>
        <span class="map-length">{{ document.sequence.length }} bp</span>
      </div>
      
      <div class="linear-track-container">
        <!-- Main axis -->
        <div class="linear-axis"></div>
        
        <!-- Feature blocks -->
        <div *ngFor="let lf of features" 
             class="feature-block"
             [style.left.%]="lf.leftPct"
             [style.width.%]="lf.widthPct"
             [style.background]="lf.feat.color || '#3498db'"
             [title]="lf.feat.name + ' (' + (lf.feat.start + 1) + '..' + lf.feat.end + ')'">
          <span class="feature-label">{{ lf.feat.name }}</span>
        </div>
      </div>
      
      <div class="axis-labels">
        <span>1</span>
        <span>{{ document.sequence.length }}</span>
      </div>
    </div>
  `,
  styles: [`
    .linear-container { width: 100%; max-width: 800px; padding: 20px; }
    .map-header { display: flex; justify-content: space-between; margin-bottom: 24px; }
    .map-title { font-weight: 600; color: #2c3e50; }
    .map-length { color: #7f8c8d; font-size: 0.9rem; }
    
    .linear-track-container {
      position: relative;
      height: 40px;
      margin-bottom: 8px;
    }
    .linear-axis {
      position: absolute;
      top: 19px;
      left: 0;
      right: 0;
      height: 2px;
      background: #bdc3c7;
    }
    .feature-block {
      position: absolute;
      top: 10px;
      height: 20px;
      border-radius: 3px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      opacity: 0.85;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .feature-block:hover { opacity: 1; outline: 1px solid #333; }
    .feature-label {
      font-size: 10px; color: white; font-weight: 600; font-family: sans-serif;
      pointer-events: none; white-space: nowrap; padding: 0 4px;
    }
    .axis-labels {
      display: flex; justify-content: space-between; font-size: 0.8rem; color: #95a5a6;
    }
  `]
})
export class LinearMapComponent implements OnChanges {
  @Input() document!: SequenceDocument;
  
  features: LinearFeature[] = [];

  ngOnChanges() {
    this.buildMap();
  }

  buildMap() {
    this.features = [];
    if (!this.document || !this.document.features) return;
    
    const len = this.document.sequence.length;
    if (len === 0) return;

    this.document.features.forEach(feat => {
      // Linear map doesn't normally wrap, but just in case, we clamp
      const start = Math.max(0, Math.min(feat.start, len));
      const end = Math.max(0, Math.min(feat.end, len));
      
      if (end >= start) {
        this.features.push({
          feat,
          leftPct: (start / len) * 100,
          widthPct: ((end - start) / len) * 100
        });
      } else {
        // Feature crosses origin (shouldn't happen for linear, but handle it by drawing two blocks)
        this.features.push({
          feat,
          leftPct: (start / len) * 100,
          widthPct: ((len - start) / len) * 100
        });
        this.features.push({
          feat,
          leftPct: 0,
          widthPct: (end / len) * 100
        });
      }
    });
  }
}
