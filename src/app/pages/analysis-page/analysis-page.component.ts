import { Component, ChangeDetectorRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { AppStateService } from '../../services/app-state.service';
import { ResultDashboardComponent } from '../../components/result-dashboard/result-dashboard.component';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

@Component({
  selector: 'app-analysis-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ResultDashboardComponent],
  templateUrl: './analysis-page.component.html'
})
export class AnalysisPageComponent implements OnInit {
  isSaving = false;
  showAutofill = false;

  constructor(
    public state: AppStateService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit() {
    this.state.activateSlot('analysis');
  }

  async downloadTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('References');
    worksheet.columns = [
      { header: 'Gene Name', key: 'geneName', width: 20 },
      { header: 'Gene Sequence', key: 'geneSeq', width: 50 },
      { header: 'Target Name', key: 'targetName', width: 20 },
      { header: 'gRNA Sequence', key: 'targetSeq', width: 30 }
    ];
    
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), 'CRISPR_Reference_Template.xlsx');
  }

  async onTemplateUpload(event: any) {
    const file = event.target.files[0];
    if (!file) return;
    const workbook = new ExcelJS.Workbook();
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      const buffer = e.target.result;
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.getWorksheet(1);
      const rows: any[] = [];
      worksheet?.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const geneName = row.getCell(1).text;
        const geneSeq = row.getCell(2).text;
        const targetName = row.getCell(3).text;
        const targetSeq = row.getCell(4).text;
        if (geneName && geneSeq && targetSeq) rows.push({ geneName, geneSeq, targetName, targetSeq });
      });
      if (rows.length > 0) {
        this.state.setGenesBulk(rows);
        this.showAutofill = false;
        this.cdr.detectChanges();
        alert(`Successfully loaded ${rows.length} reference targets!`);
      } else {
        alert('No valid data found in Excel. Please check the template.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.match(/\.(fastq|fq)$/)) this.state.selectedFiles.push(files[i]);
    }
  }

  onFileDropped(event: DragEvent) {
    event.preventDefault();
    this.state.isDragging = false;
    if (event.dataTransfer?.files) {
      const files = event.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        if (files[i].name.match(/\.(fastq|fq)$/)) this.state.selectedFiles.push(files[i]);
      }
    }
  }

  onDragOver(event: DragEvent) { event.preventDefault(); this.state.isDragging = true; }
  onDragLeave(event: DragEvent) { event.preventDefault(); this.state.isDragging = false; }
  removeFile(i: number) { this.state.selectedFiles.splice(i, 1); }

  runAnalysis() {
    const rawValue = this.state.analysisForm.value;
    const formInvalid = this.state.analysisForm.get('genes')?.invalid || this.state.analysisForm.get('interestRegion')?.invalid;

    if (formInvalid || this.state.selectedFiles.length === 0) {
      this.state.error = 'Validation failed. Check files and parameters.';
      return;
    }

    this.state.error = null;

    const phredVal = rawValue.phredThreshold ?? 20;
    const rescueThreshold = rawValue.rescueThreshold ?? 20;
    const indelVal = (rawValue.indelPercent ?? 1) * 1.0;
    const marginVal = (rawValue.marginPercent ?? 3) / 100;

    this.state.lastRunParams = {
      windowSize: rawValue.interestRegion ?? 90,
      phredThreshold: phredVal,
      indelThreshold: indelVal,
      assignmentMargin: (rawValue.marginPercent ?? 3),
      rescueThreshold: rescueThreshold,
      analyzeAmbiguous: rawValue.analyzeAmbiguous || false,
      rescueAmbiguous: rawValue.rescueAmbiguous || false,
      dataType: 'single-end',
      fileCount: this.state.selectedFiles.length
    };

    const genesPayload = rawValue.genes.map((g: any, gi: number) => ({
      gene: g.gene_name?.trim() || `G${gi + 1}`,
      sequence: g.gene_reference,
      targets: g.geneTargets.map((t: any, ti: number) => ({
        target_id: t.target_id?.trim() || `T${ti + 1}`,
        sgrna_seq: t.gRNA,
        reference_seq: g.gene_reference,
        window_size: Number(rawValue.interestRegion ?? 90)
      }))
    }));

    // ── Local Mode: run entirely in browser ──────────────────────────────────
    this.state.runLocalAnalysis(
      [...this.state.selectedFiles],
      genesPayload,
      {
        phredThreshold: phredVal,
        indelThreshold: indelVal,
        marginThreshold: marginVal,
        windowSize: Number(rawValue.interestRegion ?? 90),
        analyzeAmbiguous: rawValue.analyzeAmbiguous || false,
        rescueAmbiguous: rawValue.rescueAmbiguous || false,
        rescueThreshold: rescueThreshold,
      }
    );
  }
}
