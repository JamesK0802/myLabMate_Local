import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SequenceWorkspaceService } from '../../services/sequence-workspace.service';
import { searchSequence, SearchMatch } from '../../utils/search.utils';
import { SequenceDocument } from '../../models/sequence.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-search-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="search-panel">
      <div class="search-input-group">
        <input 
          type="text" 
          [(ngModel)]="query" 
          (keyup.enter)="performSearch()"
          (input)="onInputChange()"
          placeholder="Search DNA (IUPAC supported)..." 
          class="search-input">
        <button class="search-btn" (click)="performSearch()">Search</button>
      </div>
      
      <div class="search-options">
        <label><input type="checkbox" [(ngModel)]="searchRevComp" (change)="performSearch()"> Both strands</label>
      </div>

      <div class="results-header" *ngIf="hasSearched">
        <span>{{ results.length }} matches found</span>
        <button *ngIf="results.length > 0" class="clear-btn" (click)="clear()">Clear</button>
      </div>

      <div class="results-list" *ngIf="results.length > 0">
        <div class="result-item" 
             *ngFor="let res of results; let i = index"
             [class.active]="selectedIndex === i"
             (click)="selectResult(i)">
          <div class="res-meta">
            <span class="res-loc">{{ res.start + 1 }}..{{ res.end }}</span>
            <span class="res-strand" [class.rev]="res.strand === -1">{{ res.strand === 1 ? '+' : '-' }}</span>
          </div>
          <div class="res-match">{{ res.match }}</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    .search-panel { display: flex; flex-direction: column; height: 100%; padding: 12px; }
    .search-input-group { display: flex; gap: 8px; margin-bottom: 8px; }
    .search-input { flex: 1; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; font-size: 0.85rem; }
    .search-btn { padding: 6px 12px; background: var(--color-primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; }
    .search-btn:hover { background: #2980b9; }
    .search-options { font-size: 0.8rem; color: #7f8c8d; margin-bottom: 12px; }
    .search-options label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    
    .results-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: #34495e; font-weight: bold; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid var(--color-border); }
    .clear-btn { background: none; border: none; color: #e74c3c; cursor: pointer; font-size: 0.8rem; padding: 0; }
    .clear-btn:hover { text-decoration: underline; }
    
    .results-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .result-item { padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 4px; cursor: pointer; background: white; transition: 0.2s; }
    .result-item:hover { border-color: var(--color-primary); }
    .result-item.active { border-color: var(--color-primary); background: #ebf5fb; }
    
    .res-meta { display: flex; justify-content: space-between; font-size: 0.75rem; color: #7f8c8d; margin-bottom: 4px; }
    .res-strand { font-weight: bold; color: #27ae60; }
    .res-strand.rev { color: #e74c3c; }
    .res-match { font-family: 'Courier New', Courier, monospace; font-size: 0.8rem; color: #2c3e50; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `]
})
export class SearchPanelComponent implements OnInit, OnDestroy {
  query = '';
  searchRevComp = true;
  results: SearchMatch[] = [];
  hasSearched = false;
  selectedIndex = -1;

  private currentDoc: SequenceDocument | null = null;
  private sub: Subscription | null = null;

  constructor(private workspace: SequenceWorkspaceService) {}

  ngOnInit() {
    this.sub = this.workspace.selectedItem$.subscribe(item => {
      if (item && item.type === 'sequence') {
        this.currentDoc = item;
        if (this.query) this.performSearch(); // Re-search on document change
      } else {
        this.currentDoc = null;
        this.clear();
      }
    });
  }

  ngOnDestroy() {
    if (this.sub) this.sub.unsubscribe();
  }

  onInputChange() {
    if (!this.query) {
      this.clear();
    }
  }

  performSearch() {
    if (!this.query.trim() || !this.currentDoc) {
      this.clear();
      return;
    }
    
    this.hasSearched = true;
    this.results = searchSequence(this.query, this.currentDoc.sequence, this.searchRevComp);
    this.selectedIndex = -1;
  }

  clear() {
    this.results = [];
    this.hasSearched = false;
    this.selectedIndex = -1;
  }

  selectResult(index: number) {
    this.selectedIndex = index;
    const res = this.results[index];
    this.workspace.selectRegion(res.start, res.end);
  }
}
