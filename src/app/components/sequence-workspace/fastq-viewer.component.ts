import { Component, Input, OnChanges, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FastqDocument, FastqRead } from '../../models/sequence.model';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-fastq-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="fastq-viewer">
      <div class="stats-panel">
        <div class="stat-box">
          <div class="stat-label">Total Reads</div>
          <div class="stat-value">{{ document.stats.readCount | number }}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Avg Length</div>
          <div class="stat-value">{{ document.stats.avgLength | number:'1.0-1' }} bp</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Length Range</div>
          <div class="stat-value">{{ document.stats.minLength }} - {{ document.stats.maxLength }} bp</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Avg GC%</div>
          <div class="stat-value">{{ document.stats.avgGC | number:'1.1-1' }}%</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Avg Quality</div>
          <div class="stat-value">Q{{ document.stats.avgQuality | number:'1.1-1' }}</div>
        </div>
      </div>

      <div class="charts-panel">
        <div class="chart-container">
          <h4>Read Length Distribution</h4>
          <canvas #lengthChart></canvas>
        </div>
        <div class="chart-container">
          <h4>Quality Score Distribution</h4>
          <canvas #qualChart></canvas>
        </div>
      </div>

      <div class="reads-panel">
        <div class="reads-header">
          <h3>Reads</h3>
          <div class="search-box">
            <input type="text" [(ngModel)]="searchQuery" (keyup.enter)="searchReads()" placeholder="Search by ID...">
            <button (click)="searchReads()">Search</button>
            <button (click)="clearSearch()" *ngIf="searchQuery">Clear</button>
          </div>
        </div>
        
        <div class="reads-list">
          <div class="read-card" *ngFor="let read of visibleReads">
            <div class="read-header">
              <span class="read-id">{{ '@' + read.id }}</span>
              <span class="read-len">{{ read.seq.length }} bp</span>
            </div>
            <div class="read-seq">{{ read.seq }}</div>
            <div class="read-qual">{{ read.qualString }}</div>
            <div class="read-actions">
              <button (click)="copyText(read.seq)">Copy Seq</button>
              <button (click)="copyText(read.qualString)">Copy Qual</button>
            </div>
          </div>
          
          <div class="load-more" *ngIf="hasMore">
            <button (click)="loadMore()">Load More (Showing {{ visibleReads.length }} of {{ filteredReads.length }})</button>
          </div>
          
          <div class="empty-state" *ngIf="visibleReads.length === 0">
            No reads found matching "{{ searchQuery }}"
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; width: 100%; }
    .fastq-viewer {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: #f8f9fa;
    }
    .stats-panel {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .stat-box {
      background: white;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 16px;
      flex: 1;
      min-width: 150px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .stat-label {
      font-size: 0.85rem;
      color: #7f8c8d;
      margin-bottom: 4px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .stat-value {
      font-size: 1.4rem;
      font-weight: bold;
      color: #2c3e50;
    }
    .charts-panel {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .chart-container {
      background: white;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 16px;
      flex: 1;
      min-width: 300px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .chart-container h4 {
      margin: 0 0 12px 0;
      color: #34495e;
    }
    .reads-panel {
      background: white;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .reads-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .reads-header h3 { margin: 0; }
    .search-box {
      display: flex;
      gap: 8px;
    }
    .search-box input {
      padding: 6px 12px;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      width: 250px;
    }
    .search-box button {
      padding: 6px 12px;
      background: #f1f5f9;
      border: 1px solid var(--color-border);
      border-radius: 4px;
      cursor: pointer;
    }
    .search-box button:hover { background: #e2e8f0; }
    .reads-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .read-card {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px;
      background: #fafbfc;
    }
    .read-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 0.9rem;
    }
    .read-id { font-weight: bold; color: #34495e; }
    .read-len { color: #7f8c8d; }
    .read-seq, .read-qual {
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      word-break: break-all;
      background: white;
      padding: 8px;
      border: 1px solid #edf2f7;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .read-qual { color: #718096; }
    .read-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    .read-actions button {
      padding: 4px 8px;
      font-size: 0.8rem;
      background: white;
      border: 1px solid #cbd5e0;
      border-radius: 4px;
      cursor: pointer;
    }
    .read-actions button:hover { background: #f7fafc; }
    .load-more {
      text-align: center;
      margin-top: 16px;
    }
    .load-more button {
      padding: 8px 16px;
      background: #3498db;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
    }
    .load-more button:hover { background: #2980b9; }
    .empty-state {
      text-align: center;
      padding: 32px;
      color: #7f8c8d;
    }
  `]
})
export class FastqViewerComponent implements OnChanges, AfterViewInit {
  @Input() document!: FastqDocument;
  
  @ViewChild('lengthChart') lengthChartRef!: ElementRef;
  @ViewChild('qualChart') qualChartRef!: ElementRef;
  
  lengthChartInst: Chart | null = null;
  qualChartInst: Chart | null = null;

  filteredReads: FastqRead[] = [];
  visibleReads: FastqRead[] = [];
  searchQuery = '';
  chunkSize = 50;
  hasMore = false;

  ngOnChanges() {
    this.clearSearch();
    if (this.lengthChartRef && this.qualChartRef) {
      this.renderCharts();
    }
  }

  ngAfterViewInit() {
    this.renderCharts();
  }

  searchReads() {
    if (!this.searchQuery.trim()) {
      this.clearSearch();
      return;
    }
    const q = this.searchQuery.toLowerCase();
    this.filteredReads = this.document.reads.filter(r => r.id.toLowerCase().includes(q));
    this.visibleReads = this.filteredReads.slice(0, this.chunkSize);
    this.hasMore = this.filteredReads.length > this.chunkSize;
  }

  clearSearch() {
    this.searchQuery = '';
    this.filteredReads = this.document.reads;
    this.visibleReads = this.filteredReads.slice(0, this.chunkSize);
    this.hasMore = this.filteredReads.length > this.chunkSize;
  }

  loadMore() {
    const currLen = this.visibleReads.length;
    const nextChunk = this.filteredReads.slice(currLen, currLen + this.chunkSize);
    this.visibleReads = [...this.visibleReads, ...nextChunk];
    this.hasMore = this.filteredReads.length > this.visibleReads.length;
  }

  copyText(text: string) {
    navigator.clipboard.writeText(text);
  }

  renderCharts() {
    if (!this.document) return;

    if (this.lengthChartInst) this.lengthChartInst.destroy();
    if (this.qualChartInst) this.qualChartInst.destroy();

    const lenLabels = Object.keys(this.document.stats.lengthDistribution).map(Number).sort((a,b) => a-b);
    const lenData = lenLabels.map(l => this.document.stats.lengthDistribution[l]);

    this.lengthChartInst = new Chart(this.lengthChartRef.nativeElement, {
      type: 'bar',
      data: {
        labels: lenLabels.map(l => `${l}-${l+9}`),
        datasets: [{
          label: 'Reads',
          data: lenData,
          backgroundColor: '#3498db'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Length (bp)' } },
          y: { title: { display: true, text: 'Count' } }
        }
      }
    });

    const qualLabels = Object.keys(this.document.stats.qualityDistribution).map(Number).sort((a,b) => a-b);
    const qualData = qualLabels.map(l => this.document.stats.qualityDistribution[l]);

    this.qualChartInst = new Chart(this.qualChartRef.nativeElement, {
      type: 'bar',
      data: {
        labels: qualLabels.map(l => `Q${l}`),
        datasets: [{
          label: 'Bases',
          data: qualData,
          backgroundColor: '#2ecc71'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { title: { display: true, text: 'Quality Score' } },
          y: { title: { display: true, text: 'Base Count' } }
        }
      }
    });
  }
}
