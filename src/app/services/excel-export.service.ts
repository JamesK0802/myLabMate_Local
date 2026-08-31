import { Injectable } from '@angular/core';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { GeneResult } from '../models/analysis.model';
import { CurationConfig } from '../models/curation.model';

export interface ExportParams {
  windowSize: number; phredThreshold: number; indelThreshold: number;
  assignmentMargin: number; rescueThreshold: number; cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number;
  customWindowEnabled?: boolean; customWindowLeft?: number; customWindowRight?: number;
  analyzeAmbiguous: boolean; rescueAmbiguous: boolean;
  dataType: string; fileCount: number;
}

export interface ReadFlowData {
  rawReads: number; phredPassed: number; anchorMatched: number;
  usableForAssignment?: number;
  assignedReads: number; ambiguousReads: number;
}

export interface ScopeData {
  sheetName: string; readFlow: ReadFlowData; genes: GeneResult[];
}

@Injectable({ providedIn: 'root' })
export class ExcelExportService {

  private readonly HEADER_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  private readonly HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  private readonly SECTION_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF34495E' } };
  private readonly SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
  private readonly PARAM_LABEL_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } };
  private readonly STRIPE_FILL: ExcelJS.FillPattern = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
  private readonly BORDER_THIN: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
  };

  async exportToExcel(params: ExportParams, scopes: ScopeData[], chartImages?: { [scopeName: string]: { [targetId: string]: { [chartName: string]: string } } }, curationConfig?: CurationConfig): Promise<void> {
    const wb = new ExcelJS.Workbook();

    // If curated, add a Curation Info sheet first
    if (curationConfig) {
      this.buildCurationInfoSheet(wb, curationConfig);
    }

    for (const scope of scopes) this.buildSheet(wb, scope, params, chartImages?.[scope.sheetName]);
    const dataSheet = wb.addWorksheet('.metadata', { state: 'hidden' });
    const jsonData = JSON.stringify({ params, scopes, curationConfig: curationConfig || null });
    const chunkSize = 30000;
    for (let i = 0; i < jsonData.length; i += chunkSize) dataSheet.addRow([jsonData.substring(i, i + chunkSize)]);
    const buf = await wb.xlsx.writeBuffer();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 16);
    const prefix = curationConfig ? 'curated-crispr-report' : 'crispr-analysis-report';
    saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${prefix}-${ts}.xlsx`);
  }

  private buildSheet(wb: ExcelJS.Workbook, scope: ScopeData, params: ExportParams, scopeCharts?: { [targetId: string]: { [chartName: string]: string } }): void {
    const safeName = scope.sheetName.replace(/[\\/*?[\]:]/g, '_').substring(0, 31);
    const ws = wb.addWorksheet(safeName);

    ws.getColumn(1).width = 25;
    for (let i = 2; i <= 5; i++) ws.getColumn(i).width = 18;
    ws.getColumn(6).width = 4;

    let leftRow = 1;
    leftRow = this.writeSection(ws, leftRow, '1. Analysis Parameters', 1, 5);
    const paramPairs: [string, any][] = [['Date', new Date().toLocaleDateString()], ['Phred Threshold', params.phredThreshold], ['Indel Threshold (%)', params.indelThreshold], ['Assignment Margin (%)', params.assignmentMargin], ['Rescue Threshold', params.rescueThreshold], ['Analyze Ambiguous', params.analyzeAmbiguous ? 'Yes' : 'No'], ['DataType', params.dataType]];
    for (const [k, v] of paramPairs) {
      const r = ws.getRow(leftRow);
      r.getCell(1).value = k; r.getCell(1).font = { bold: true }; r.getCell(1).fill = this.PARAM_LABEL_FILL; r.getCell(1).border = this.BORDER_THIN; r.getCell(1).alignment = { horizontal: 'right' };
      r.getCell(2).value = v; r.getCell(2).border = this.BORDER_THIN; r.getCell(2).alignment = { horizontal: 'right' };
      leftRow++;
    }
    leftRow++;

    leftRow = this.writeSection(ws, leftRow, '2. Read Flow Summary', 1, 5);
    const flows: [string, number][] = [
      ['Raw Reads', scope.readFlow.rawReads],
      ['Phred Passed', scope.readFlow.phredPassed],
      ['Usable for Assignment', scope.readFlow.usableForAssignment ?? scope.readFlow.anchorMatched],
      ['Assigned Reads', scope.readFlow.assignedReads]
    ];
    for (const [k, v] of flows) {
      const r = ws.getRow(leftRow); r.getCell(1).value = k; r.getCell(1).font = { bold: true }; r.getCell(1).fill = this.PARAM_LABEL_FILL; r.getCell(1).border = this.BORDER_THIN; r.getCell(1).alignment = { horizontal: 'right' };
      r.getCell(2).value = v; r.getCell(2).numFmt = '#,##0'; r.getCell(2).border = this.BORDER_THIN; r.getCell(2).alignment = { horizontal: 'right' };
      leftRow++;
    }
    leftRow++;

    leftRow = this.writeSection(ws, leftRow, '3. Per-Class Summary', 1, 5);
    if (scopeCharts?.['SUMMARY']?.['bar']) {
      ws.addImage(wb.addImage({ base64: scopeCharts['SUMMARY']['bar'], extension: 'png' }), { tl: { col: 0.1, row: leftRow }, ext: { width: 750, height: 400 } });
      leftRow += 17;
    }

    const geneSummaryRows: { geneName: string; row: number; detailRow?: number }[] = [];
    const hdr1 = ws.getRow(leftRow);
    const h1 = ['Gene', 'Source', 'Target', 'Total Reads', 'Aligned Reads'];
    for (let i = 0; i < h1.length; i++) {
      const c = hdr1.getCell(i + 1); c.value = h1[i]; c.fill = this.HEADER_FILL; c.font = this.HEADER_FONT; c.border = this.BORDER_THIN; c.alignment = { horizontal: 'center' };
    }
    leftRow++;
    if (scope.genes) {
      for (const gene of scope.genes) {
        // Gene Sub-header for Table 3A
        const gHdr = ws.getRow(leftRow);
        ws.mergeCells(leftRow, 1, leftRow, 5);
        gHdr.getCell(1).value = `Gene: ${gene.gene}`;
        gHdr.getCell(1).font = { bold: true, size: 10 };
        gHdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F6' } };
        gHdr.getCell(1).alignment = { horizontal: 'left' };
        for (let i = 1; i <= 5; i++) gHdr.getCell(i).border = this.BORDER_THIN;
        geneSummaryRows.push({ geneName: gene.gene, row: leftRow });
        leftRow++;

        const src = gene.is_rescued_derived ? 'Rescued' : gene.is_ambiguous_derived ? 'Ambiguous' : 'Normal';
        for (const t of (gene.analysis_result?.targets ?? [])) {
          const r = ws.getRow(leftRow);
          r.getCell(1).value = gene.gene; r.getCell(2).value = src; r.getCell(3).value = t.target_id;
          r.getCell(4).value = t.summary?.total_reads ?? 0; r.getCell(4).numFmt = '#,##0';
          r.getCell(5).value = t.summary?.aligned_reads ?? 0; r.getCell(5).numFmt = '#,##0';
          for (let i = 1; i <= 5; i++) { r.getCell(i).border = this.BORDER_THIN; r.getCell(i).alignment = { horizontal: 'right' }; }
          if (leftRow % 2 === 1) { for (let i = 1; i <= 5; i++) r.getCell(i).fill = this.STRIPE_FILL; }
          leftRow++;
        }
      }
    }
    leftRow++;

    const percentageStartRow = leftRow;
    const h2 = ['Gene', 'Out-of-frame %', 'In-frame %', 'No Indel %', 'Substitution %'];
    const hdr2 = ws.getRow(leftRow);
    for (let i = 0; i < h2.length; i++) {
      const c = hdr2.getCell(i + 1); c.value = h2[i]; c.fill = this.HEADER_FILL; c.font = this.HEADER_FONT; c.border = this.BORDER_THIN; c.alignment = { horizontal: 'center' };
    }
    leftRow++;
    let stripeIdx = 0;
    if (scope.genes) {
      for (const gene of scope.genes) {
        // Gene Sub-header for Table 3B
        const gHdr = ws.getRow(leftRow);
        ws.mergeCells(leftRow, 1, leftRow, 5);
        gHdr.getCell(1).value = `Gene: ${gene.gene}`;
        gHdr.getCell(1).font = { bold: true, size: 10 };
        gHdr.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F6' } };
        gHdr.getCell(1).alignment = { horizontal: 'left' };
        for (let i = 1; i <= 5; i++) gHdr.getCell(i).border = this.BORDER_THIN;
        leftRow++;

        for (const t of (gene.analysis_result?.targets ?? [])) {
          const r = ws.getRow(leftRow); r.getCell(1).value = gene.gene;
          r.getCell(2).value = (t.summary?.out_of_frame_pct ?? 0) / 100; r.getCell(2).numFmt = '0.00%';
          r.getCell(3).value = (t.summary?.in_frame_pct ?? 0) / 100; r.getCell(3).numFmt = '0.00%';
          r.getCell(4).value = (t.summary?.no_indel_pct ?? 0) / 100; r.getCell(4).numFmt = '0.00%';
          r.getCell(5).value = (t.summary?.substitution_pct ?? 0) / 100; r.getCell(5).numFmt = '0.00%';
          for (let i = 1; i <= 5; i++) { r.getCell(i).border = this.BORDER_THIN; r.getCell(i).alignment = { horizontal: 'right' }; }
          if (leftRow % 2 === 1) { for (let i = 1; i <= 5; i++) r.getCell(i).fill = this.STRIPE_FILL; }
          leftRow++;
        }
      }
    }

    // ── RIGHT SIDE: DETAILED ANALYSIS (G-...) ──────────────────────────────────
    let rightRow = 1;
    const dStart = 7;
    ws.getColumn(dStart).width = 18; ws.getColumn(dStart + 1).width = 15; ws.getColumn(dStart + 2).width = 20;
    rightRow = this.writeSection(ws, rightRow, '4. Detailed Analysis (Scroll Right)', dStart, dStart + 2);
    rightRow++;

    if (scope.genes) {
      for (const gene of scope.genes) {
        const gIdx = geneSummaryRows.findIndex(e => e.geneName === gene.gene);
        if (gIdx !== -1) geneSummaryRows[gIdx].detailRow = rightRow;
        const gHdr = ws.getRow(rightRow); ws.mergeCells(rightRow, dStart, rightRow, dStart + 6);
        gHdr.getCell(dStart).value = `Gene: ${gene.gene}`; gHdr.getCell(dStart).font = { bold: true, size: 12, color: { argb: 'FF2C3E50' } };
        gHdr.getCell(dStart).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDFE6ED' } } as ExcelJS.FillPattern;
        rightRow++;

        for (const t of (gene.analysis_result?.targets ?? [])) {
          const tHdr = ws.getRow(rightRow); ws.mergeCells(rightRow, dStart, rightRow, dStart + 6);
          tHdr.getCell(dStart).value = `Target: ${t.target_id}`; tHdr.getCell(dStart).font = { bold: true, size: 11, color: { argb: 'FF2980B9' } };
          rightRow++;

          const strand = (t as any).is_rc ? 'REVERSE (-)' : 'FORWARD (+)';
          ws.getRow(rightRow).getCell(dStart).value = `Strand: ${strand} | Cut Site: Pos ${t.cut_site_index ?? 'N/A'}`;
          ws.getRow(rightRow).getCell(dStart).font = { italic: true, size: 9, color: { argb: 'FF7F8C8D' } };
          rightRow++;

          const mPairs: [string, any][] = [['Total Reads', t.summary?.total_reads ?? 0], ['Aligned Reads', t.summary?.aligned_reads ?? 0], ['Indel Editing %', (t.summary?.indel_editing_efficiency ?? t.summary?.editing_efficiency ?? 0) / 100], ['Out-of-frame %', (t.summary?.out_of_frame_pct ?? 0) / 100], ['In-frame %', (t.summary?.in_frame_pct ?? 0) / 100], ['No Indel %', (t.summary?.no_indel_pct ?? 0) / 100], ['Substitution %', (t.summary?.substitution_pct ?? 0) / 100]];
          const mBaseRow = rightRow;
          for (const [k, v] of mPairs) {
            const mr = ws.getRow(rightRow); mr.getCell(dStart).value = k; mr.getCell(dStart).font = { bold: true }; mr.getCell(dStart).fill = this.PARAM_LABEL_FILL; mr.getCell(dStart).border = this.BORDER_THIN; mr.getCell(dStart).alignment = { horizontal: 'right' };
            mr.getCell(dStart + 1).value = v; mr.getCell(dStart + 1).border = this.BORDER_THIN; mr.getCell(dStart + 1).alignment = { horizontal: 'right' };
            if (k.includes('%')) mr.getCell(dStart + 1).numFmt = '0.00%'; else mr.getCell(dStart + 1).numFmt = '#,##0';
            rightRow++;
          }
          const chartKey = `${gene.gene}::${t.target_id}`;
          if (scopeCharts?.[chartKey]) {
            const tc = scopeCharts[chartKey];
            if (tc['pie']) ws.addImage(wb.addImage({ base64: tc['pie'], extension: 'png' }), { tl: { col: dStart + 2, row: mBaseRow - 1 }, ext: { width: 450, height: 280 } });
            if (tc['donut']) ws.addImage(wb.addImage({ base64: tc['donut'], extension: 'png' }), { tl: { col: dStart + 20, row: mBaseRow - 1 }, ext: { width: 450, height: 280 } });
          }
          rightRow = Math.max(rightRow, mBaseRow + 13);

          const seqLbl = ws.getRow(rightRow);
          seqLbl.getCell(dStart).value = 'Rank'; seqLbl.getCell(dStart + 1).value = 'Reads (%)'; seqLbl.getCell(dStart + 2).value = 'Type'; seqLbl.getCell(dStart + 3).value = 'Sequence Visualization';
          for (let i = 0; i < 3; i++) { const c = seqLbl.getCell(dStart + i); c.font = { bold: true, size: 10 }; c.fill = this.PARAM_LABEL_FILL; c.alignment = { horizontal: 'right' }; }
          rightRow++;

          const refR = ws.getRow(rightRow); refR.getCell(dStart + 2).value = 'REFERENCE'; refR.getCell(dStart + 2).font = { bold: true, size: 9 }; refR.getCell(dStart + 2).alignment = { horizontal: 'right' };
          const refSeq = t.ref_sequence || '';
          for (let i = 0; i < refSeq.length; i++) {
            const cell = refR.getCell(dStart + 3 + i); cell.value = refSeq[i]; cell.font = { name: 'Courier New', size: 11, bold: true }; cell.alignment = { horizontal: 'center' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2F6' } };
            ws.getColumn(dStart + 3 + i).width = 2.8;
            if (t.cut_site_index != null && i === t.cut_site_index - 1) cell.border = { right: { style: 'thick', color: { argb: 'FFFF0000' } } };
          }
          rightRow++;

          for (const grp of (t.top_groups ?? [])) {
            const gr = ws.getRow(rightRow); gr.getCell(dStart).value = grp.group_rank; gr.getCell(dStart + 1).value = (grp.read_pct ?? 0) / 100; gr.getCell(dStart + 1).numFmt = '0.0%'; gr.getCell(dStart + 2).value = grp.classification;
            gr.getCell(dStart).alignment = { horizontal: 'right' }; gr.getCell(dStart + 1).alignment = { horizontal: 'right' }; gr.getCell(dStart + 2).alignment = { horizontal: 'right' };
            let cIdx = dStart + 3;
            if (grp.tokens) {
              for (const tok of grp.tokens) {
                for (const char of (tok.val || '').split('')) {
                  const cell = gr.getCell(cIdx); cell.value = tok.type === 'delete' ? '-' : char; cell.font = { name: 'Courier New', size: 11, color: { argb: (tok.type === 'equal' ? 'FF000000' : 'FFFFFFFF') } }; cell.alignment = { horizontal: 'center' };
                  if (tok.type !== 'equal') { const color = tok.type === 'delete' ? 'FFE74C3C' : tok.type === 'substitute' ? 'FF3498DB' : 'FF9B59B6'; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }; }
                  if (t.cut_site_index != null && (cIdx - (dStart + 3)) === t.cut_site_index - 1) cell.border = { right: { style: 'thick', color: { argb: 'FFFF0000' } } };
                  cIdx++;
                }
              }
            }
            rightRow++;
          }
          rightRow += 3;
        }
        rightRow++;
      }
    }

    // Grey Gutter (Column F)
    for (let i = 1; i <= Math.max(leftRow, rightRow); i++) { ws.getRow(i).getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1D8E0' } }; }

    if (leftRow > percentageStartRow) {
      ws.addConditionalFormatting({ ref: `B${percentageStartRow + 1}:E${leftRow}`, rules: [{ type: 'dataBar', cfvo: [{ type: 'min', value: 0 }, { type: 'max', value: 1 }], color: { argb: 'FF3498DB' } } as any] });
    }

    for (const entry of geneSummaryRows) {
      if (entry.detailRow) {
        const cell = ws.getRow(entry.row).getCell(1);
        cell.value = { text: entry.geneName, hyperlink: `#'${safeName}'!G${entry.detailRow}` } as ExcelJS.CellHyperlinkValue;
        cell.font = { bold: true, color: { argb: 'FF2980B9' }, underline: true }; cell.alignment = { horizontal: 'right' };
      }
    }
  }

  private writeSection(ws: ExcelJS.Worksheet, row: number, title: string, colStart: number, colEnd: number): number {
    const r = ws.getRow(row); ws.mergeCells(row, colStart, row, colEnd);
    r.getCell(colStart).value = title; r.getCell(colStart).fill = this.SECTION_FILL; r.getCell(colStart).font = this.SECTION_FONT; r.getCell(colStart).alignment = { horizontal: 'left' };
    return row + 1;
  }

  async importFromExcel(file: File): Promise<{ params: Partial<ExportParams>, scopes: ScopeData[] }> {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    const metaSheet = wb.getWorksheet('.metadata');
    if (metaSheet) {
      let jsonStr = ''; metaSheet.eachRow(row => { const val = row.getCell(1).text; if (val) jsonStr += val; });
      try { const r = JSON.parse(jsonStr); if (r.params && r.scopes) return r; } catch (e) { }
    }
    return { params: {}, scopes: [] };
  }

  // ── Curation Info Sheet ──────────────────────────────────────────────────────

  private buildCurationInfoSheet(wb: ExcelJS.Workbook, config: CurationConfig): void {
    const ws = wb.addWorksheet('Curation Info');
    ws.getColumn(1).width = 30;
    ws.getColumn(2).width = 60;

    let row = 1;

    // Title
    const titleRow = ws.getRow(row);
    ws.mergeCells(row, 1, row, 2);
    titleRow.getCell(1).value = 'Curated View Information';
    titleRow.getCell(1).fill = this.SECTION_FILL;
    titleRow.getCell(1).font = this.SECTION_FONT;
    row++;
    row++;

    const addPair = (label: string, value: any) => {
      const r = ws.getRow(row);
      r.getCell(1).value = label;
      r.getCell(1).font = { bold: true };
      r.getCell(1).fill = this.PARAM_LABEL_FILL;
      r.getCell(1).border = this.BORDER_THIN;
      r.getCell(1).alignment = { horizontal: 'right' };
      r.getCell(2).value = value;
      r.getCell(2).border = this.BORDER_THIN;
      row++;
    };

    addPair('Curated View Name', config.curatedViewName);
    addPair('Source Result', config.sourceResultTitle);
    addPair('Created At', config.createdAt);
    row++;

    // Exclusion summary
    const addListSection = (title: string, items: string[]) => {
      const sectionRow = ws.getRow(row);
      ws.mergeCells(row, 1, row, 2);
      sectionRow.getCell(1).value = `${title} (${items.length})`;
      sectionRow.getCell(1).fill = this.HEADER_FILL;
      sectionRow.getCell(1).font = this.HEADER_FONT;
      row++;
      if (items.length === 0) {
        ws.getRow(row).getCell(1).value = '(none)';
        ws.getRow(row).getCell(1).font = { italic: true, color: { argb: 'FF999999' } };
        row++;
      } else {
        for (const item of items) {
          ws.getRow(row).getCell(1).value = item;
          ws.getRow(row).getCell(1).border = this.BORDER_THIN;
          row++;
        }
      }
      row++;
    };

    addListSection('Excluded Files', config.excludedFiles);
    addListSection('Excluded Genes', config.excludedGenes);
    addListSection('Excluded Targets', config.excludedTargets);
    addListSection('Excluded Annotation Groups', config.excludedGroups);
  }
}
