import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SequenceFeature } from '../../models/sequence.model';

@Component({
  selector: 'app-feature-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-backdrop" (click)="onCancel()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <h3>{{ isNew ? 'Add Feature' : 'Edit Feature' }}</h3>
        
        <div class="form-group">
          <label>Name</label>
          <input type="text" [(ngModel)]="feature.name" placeholder="Feature Name" />
        </div>

        <div class="form-group">
          <label>Type</label>
          <select [(ngModel)]="feature.type">
            <option value="CDS">CDS</option>
            <option value="gene">Gene</option>
            <option value="promoter">Promoter</option>
            <option value="terminator">Terminator</option>
            <option value="primer_bind">Primer Bind</option>
            <option value="misc_feature">Misc Feature</option>
          </select>
        </div>

        <div class="form-group">
          <label>Start Position (1-indexed)</label>
          <input type="number" [(ngModel)]="displayStart" (ngModelChange)="updateStart($event)" />
        </div>

        <div class="form-group">
          <label>End Position (1-indexed)</label>
          <input type="number" [(ngModel)]="displayEnd" (ngModelChange)="updateEnd($event)" />
        </div>

        <div class="form-group">
          <label>Strand</label>
          <select [(ngModel)]="feature.strand">
            <option [ngValue]="1">Forward (+)</option>
            <option [ngValue]="-1">Reverse (-)</option>
          </select>
        </div>

        <div class="form-group">
          <label>Color</label>
          <input type="color" [(ngModel)]="feature.color" />
        </div>

        <div class="modal-actions">
          <button class="btn-cancel" (click)="onCancel()">Cancel</button>
          <button class="btn-delete" *ngIf="!isNew" (click)="onDelete()">Delete Feature</button>
          <button class="btn-save" (click)="onSave()">Save Feature</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-backdrop { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 2000; display: flex; justify-content: center; align-items: center; }
    .modal-content { background: white; padding: 24px; border-radius: 8px; width: 400px; max-width: 90%; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    h3 { margin-top: 0; margin-bottom: 20px; font-size: 18px; color: #2c3e50; }
    .form-group { margin-bottom: 16px; display: flex; flex-direction: column; }
    .form-group label { font-size: 13px; font-weight: 500; color: #4a5568; margin-bottom: 6px; }
    .form-group input, .form-group select { padding: 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 14px; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    button { padding: 8px 16px; border: none; border-radius: 4px; font-size: 14px; cursor: pointer; font-weight: 500; }
    .btn-cancel { background: white; border: 1px solid #cbd5e0; color: #4a5568; }
    .btn-cancel:hover { background: #f7fafc; }
    .btn-delete { background: #e74c3c; color: white; margin-right: auto; }
    .btn-delete:hover { background: #c0392b; }
    .btn-save { background: #3498db; color: white; }
    .btn-save:hover { background: #2980b9; }
  `]
})
export class FeatureEditorComponent {
  @Input() set initialFeature(f: SequenceFeature | null) {
    if (f) {
      this.feature = { ...f };
      this.isNew = false;
    } else {
      this.feature = {
        id: Math.random().toString(36).substring(2, 9),
        name: 'New Feature',
        type: 'misc_feature',
        start: 0,
        end: 1,
        strand: 1,
        color: '#95a5a6'
      };
      this.isNew = true;
    }
  }

  feature!: SequenceFeature;
  isNew = false;

  @Output() save = new EventEmitter<SequenceFeature>();
  @Output() delete = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  get displayStart() { return this.feature.start + 1; }
  get displayEnd() { return this.feature.end; }

  updateStart(val: number) { this.feature.start = val - 1; }
  updateEnd(val: number) { this.feature.end = val; }

  onSave() { this.save.emit(this.feature); }
  onDelete() { this.delete.emit(this.feature.id); }
  onCancel() { this.cancel.emit(); }
}
