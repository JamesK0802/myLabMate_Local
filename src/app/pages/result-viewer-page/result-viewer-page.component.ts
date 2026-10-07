import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppStateService } from '../../services/app-state.service';
import { ResultDashboardComponent } from '../../components/result-dashboard/result-dashboard.component';
import { ExcelExportService } from '../../services/excel-export.service';

@Component({
  selector: 'app-result-viewer-page',
  standalone: true,
  imports: [CommonModule, ResultDashboardComponent],
  templateUrl: './result-viewer-page.component.html'
})
export class ResultViewerPageComponent implements OnInit {
  constructor(
    public state: AppStateService,
    private excelExportService: ExcelExportService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.state.activateSlot('viewer');
    window.addEventListener('casmango:guide-load-excel', this.onGuideLoadExcel as EventListener);
  }

  ngOnDestroy() {
    window.removeEventListener('casmango:guide-load-excel', this.onGuideLoadExcel as EventListener);
  }

  private onGuideLoadExcel = (event: CustomEvent<{ file: File }>) => {
    if (event.detail?.file) {
      this.loadExcelResult(event.detail.file);
    }
  };

  onExcelDropped(event: DragEvent) {
    event.preventDefault();
    this.state.isDragging = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) this.loadExcelResult(files[0]);
  }

  onExcelSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) this.loadExcelResult(input.files[0]);
  }

  onDragOver(event: DragEvent) { event.preventDefault(); this.state.isDragging = true; }
  onDragLeave(event: DragEvent) { event.preventDefault(); this.state.isDragging = false; }

  async loadExcelResult(file: File) {
    try {
      this.state.addLog(`Loading excel file: ${file.name}`);
      const data = await this.excelExportService.importFromExcel(file);
      
      this.state.loadResultData(data);
      this.cdr.detectChanges();
      this.state.addLog(`Excel report imported successfully.`);
    } catch (e: any) {
      console.error('Excel import failed:', e);
      this.state.addLog(`Excel import failed: ${e.message}`);
    }
  }
}
