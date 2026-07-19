import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SequenceDocument, SequenceFeature } from '../../models/sequence.model';

interface ArcFeature {
  feat: SequenceFeature;
  path: string;
  midAngle: number;
  labelX: number;
  labelY: number;
}

@Component({
  selector: 'app-plasmid-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="plasmid-container">
      <svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        
        <circle cx="200" cy="200" r="140" fill="none" stroke="#e0e0e0" stroke-width="8" />
        
        <text x="200" y="195" text-anchor="middle" class="map-title">{{ document.name || 'Plasmid' }}</text>
        <text x="200" y="215" text-anchor="middle" class="map-length">{{ document.sequence.length }} bp</text>

        <!-- Features -->
        <g *ngFor="let a of arcs" class="feature-arc">
          <path [attr.d]="a.path" [attr.fill]="a.feat.color || '#3498db'" opacity="0.8">
            <title>{{ a.feat.name }} ({{ a.feat.start + 1 }}..{{ a.feat.end }})</title>
          </path>
          
          <text 
            [attr.x]="a.labelX" 
            [attr.y]="a.labelY" 
            [attr.text-anchor]="a.labelX > 200 ? 'start' : 'end'"
            class="feature-label">
            {{ a.feat.name }}
          </text>
        </g>

      </svg>
    </div>
  `,
  styles: [`
    .plasmid-container { display: flex; justify-content: center; align-items: center; width: 100%; height: 100%; }
    .map-title { font-size: 14px; font-weight: bold; fill: #34495e; font-family: sans-serif; }
    .map-length { font-size: 12px; fill: #7f8c8d; font-family: sans-serif; }
    .feature-arc { cursor: pointer; transition: opacity 0.2s; }
    .feature-arc:hover { opacity: 1; stroke: #333; stroke-width: 1; }
    .feature-label { font-size: 10px; fill: #2c3e50; font-family: sans-serif; pointer-events: none; }
  `]
})
export class PlasmidMapComponent implements OnChanges {
  @Input() document!: SequenceDocument;
  
  arcs: ArcFeature[] = [];

  ngOnChanges() {
    this.buildMap();
  }

  buildMap() {
    this.arcs = [];
    if (!this.document || !this.document.features) return;

    const len = this.document.sequence.length;
    if (len === 0) return;

    const cx = 200;
    const cy = 200;
    const r = 140;

    this.document.features.forEach(feat => {
      // Normalize start and end
      const start = feat.start % len;
      const end = feat.end % len;
      
      let startAngle = (start / len) * 360 - 90;
      let endAngle = (end / len) * 360 - 90;

      if (end < start) {
        endAngle += 360; // Crosses origin
      }

      // Convert to radians
      const startRad = (startAngle * Math.PI) / 180;
      const endRad = (endAngle * Math.PI) / 180;

      // Inner and outer radius for the arc block
      const rOuter = r + 6;
      const rInner = r - 6;

      const x1O = cx + rOuter * Math.cos(startRad);
      const y1O = cy + rOuter * Math.sin(startRad);
      const x2O = cx + rOuter * Math.cos(endRad);
      const y2O = cy + rOuter * Math.sin(endRad);

      const x1I = cx + rInner * Math.cos(startRad);
      const y1I = cy + rInner * Math.sin(startRad);
      const x2I = cx + rInner * Math.cos(endRad);
      const y2I = cy + rInner * Math.sin(endRad);

      const largeArc = endAngle - startAngle > 180 ? 1 : 0;
      
      // Basic wedge shape for feature
      // SVG Path: Move to inner start -> Line to outer start -> Arc to outer end -> Line to inner end -> Arc to inner start
      const path = `M ${x1I} ${y1I} L ${x1O} ${y1O} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2O} ${y2O} L ${x2I} ${y2I} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x1I} ${y1I} Z`;

      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const midRad = (midAngle * Math.PI) / 180;
      const labelX = cx + (rOuter + 10) * Math.cos(midRad);
      const labelY = cy + (rOuter + 10) * Math.sin(midRad);

      this.arcs.push({
        feat,
        path,
        midAngle,
        labelX,
        labelY
      });
    });
  }
}
