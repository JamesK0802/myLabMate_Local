/**
 * local-analysis.worker.ts — Web Worker entry point for Local Mode analysis.
 *
 * Receives messages from the UI thread, parses FASTQ files using the File API,
 * runs the full CRISPR analysis pipeline in the worker thread, and reports
 * progress and results back to the UI.
 *
 * Message Protocol:
 *   UI → Worker:
 *     { type: 'analyze', payload: { files: File[], genesPayload, params } }
 *     { type: 'cancel' }
 *
 *   Worker → UI:
 *     { type: 'progress', percent, stage, fileProgress }
 *     { type: 'result', payload: AnalysisPayload }
 *     { type: 'error', message }
 */

/// <reference lib="webworker" />

import { parseFastqFile, parseFastqFileInBatches, readFileAsText } from './core/fastq-parser';
import { processFile, buildFinalPayload, AnalysisParams, FileResult } from './core/analysis-pipeline';
import { findGrnaCutSite, extractWindow, cutIndexInWindow, isReadUsable } from './core/classifier';
import { GenePayload } from './core/multi-reference-assigner';
import { runBenchmark } from './core/benchmark-pipeline';
import { IlluminaFilePair } from '../models/illumina.model';
import { buildIlluminaPseudoReads, fastqReadsToString, preprocessIlluminaReads, suggestIlluminaAlignment } from './core/illumina-preprocessor';

let cancelled = false;

// Files below this size already run reliably through the normal in-memory
// path. Switch only genuinely large inputs to batch processing.
const LARGE_FASTQ_BYTES = 500 * 1024 * 1024;

function addNumericFields(target: Record<string, any>, source: Record<string, any>): void {
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === 'number') target[key] = (target[key] || 0) + value;
  }
}

function mergeTargetResult(target: any, source: any): void {
  addNumericFields(target.summary, source.summary);
  addNumericFields(target.breakdown, source.breakdown);
  target.summary.failure_reasons ||= {};
  target.breakdown.failure_reasons ||= {};
  addNumericFields(target.summary.failure_reasons, source.summary?.failure_reasons || {});
  addNumericFields(target.breakdown.failure_reasons, source.breakdown?.failure_reasons || {});

  const groups = new Map<string, any>();
  for (const group of [...(target.top_groups || []), ...(source.top_groups || [])]) {
    const existing = groups.get(group.read_inner);
    if (existing) existing.read_count += group.read_count;
    else groups.set(group.read_inner, { ...group });
  }
  target.top_groups = [...groups.values()];
}

function finalizeTargetResult(target: any): void {
  const summary = target.summary;
  const breakdown = target.breakdown;
  const aligned = summary.aligned_reads || 0;
  const pct = (value: number) => aligned ? Math.round((value / aligned) * 10000) / 100 : 0;
  summary.modified = breakdown.out_of_frame + breakdown.in_frame;
  summary.unmodified = breakdown.no_indel;
  summary.substitution_reads = breakdown.substitution;
  summary.out_of_frame_pct = pct(breakdown.out_of_frame);
  summary.in_frame_pct = pct(breakdown.in_frame);
  summary.no_indel_pct = pct(breakdown.no_indel);
  summary.substitution_pct = pct(breakdown.substitution);
  summary.editing_efficiency = pct(summary.modified);
  summary.indel_editing_efficiency = pct(summary.modified);
  target.top_groups = (target.top_groups || [])
    .sort((a: any, b: any) => b.read_count - a.read_count)
    .slice(0, 10)
    .map((group: any, index: number) => ({
      ...group,
      group_rank: index + 1,
      read_pct: pct(group.read_count),
    }));
}

function mergeMultiTargetSummary(target: any, source: any): void {
  if (!source) return;
  if (!target) return source;
  addNumericFields(target, source);
  target.edit_distribution ||= {};
  addNumericFields(target.edit_distribution, source.edit_distribution || {});
  const pairs = new Map<string, any>();
  for (const item of [...(target.co_editing_matrix || []), ...(source.co_editing_matrix || [])]) {
    const key = `${item.target_a}\u0000${item.target_b}`;
    const existing = pairs.get(key);
    if (existing) existing.co_edited_reads += item.co_edited_reads;
    else pairs.set(key, { ...item });
  }
  target.co_editing_matrix = [...pairs.values()];
}

/** Combine independently analysed FASTQ batches into one file-level result. */
function mergeFileResult(target: FileResult | null, source: FileResult): FileResult {
  if (!target) return source;
  const current = target.multi_reference_result as any;
  const incoming = source.multi_reference_result as any;
  current.ambiguous_read_count += incoming.ambiguous_read_count || 0;
  for (const key of [
    'total_reads_parsed', 'phred_passed_count', 'anchor_matched_count',
    'usable_for_assignment_count', 'assignment_filtered_count',
  ]) {
    current.debug[key] = (current.debug[key] || 0) + (incoming.debug?.[key] || 0);
  }

  const genes = new Map<string, any>((current.genes || []).map((gene: any) => [gene.gene, gene]));
  for (const incomingGene of incoming.genes || []) {
    const gene = genes.get(incomingGene.gene);
    if (!gene) {
      const copy = structuredClone(incomingGene);
      current.genes.push(copy);
      genes.set(copy.gene, copy);
      continue;
    }
    gene.assigned_read_count += incomingGene.assigned_read_count || 0;
    const targets = new Map((gene.analysis_result.targets || []).map((item: any) => [item.target_id, item]));
    for (const incomingTarget of incomingGene.analysis_result.targets || []) {
      const existing = targets.get(incomingTarget.target_id);
      if (existing) mergeTargetResult(existing, incomingTarget);
      else gene.analysis_result.targets.push(structuredClone(incomingTarget));
    }
    if (incomingGene.analysis_result.multi_target_summary) {
      const existingSummary = gene.analysis_result.multi_target_summary;
      gene.analysis_result.multi_target_summary = mergeMultiTargetSummary(existingSummary, incomingGene.analysis_result.multi_target_summary);
    }
  }
  const debugGenes = new Map<string, any>((current.debug.genes || []).map((gene: any) => [gene.gene, gene]));
  for (const incomingGene of incoming.debug?.genes || []) {
    const existing = debugGenes.get(incomingGene.gene);
    if (existing) existing.assigned_reads_analyzed += incomingGene.assigned_reads_analyzed || 0;
    else current.debug.genes.push(structuredClone(incomingGene));
  }
  return target;
}

function finalizeFileResult(result: FileResult): FileResult {
  for (const gene of result.multi_reference_result.genes as any[]) {
    for (const target of gene.analysis_result.targets || []) finalizeTargetResult(target);
  }
  return result;
}

addEventListener('message', async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'cancel') {
    cancelled = true;
    return;
  }

  if (type === 'analyze') {
    cancelled = false;
    const { files, genesPayload, params, illuminaPairs = [] } = payload as {
      files: File[];
      genesPayload: GenePayload[];
      params: AnalysisParams;
      illuminaPairs?: IlluminaFilePair[];
    };

    try {
      const isIllumina = params.sequencingPlatform === 'illumina';
      const totalFiles = isIllumina ? illuminaPairs.length : files.length;
      const fileProgress: Record<string, number> = {};
      if (isIllumina) {
        for (const pair of illuminaPairs) fileProgress[pair.name] = 0;
      } else {
        for (const f of files) fileProgress[f.name] = 0;
      }

      const allResults: FileResult[] = [];

      if (isIllumina) {
        for (let i = 0; i < totalFiles; i++) {
          if (cancelled) {
            postMessage({ type: 'error', message: 'Analysis canceled by user.' });
            return;
          }

          const pair = illuminaPairs[i];
          fileProgress[pair.name] = 5;
          postMessage({
            type: 'progress',
            percent: Math.round(10 + (i / totalFiles) * 85),
            stage: `Parsing paired sample ${pair.name} (${i + 1}/${totalFiles})…`,
            fileProgress: { ...fileProgress },
          });

          // Read mates one at a time. Parallel parsing doubles the peak memory
          // for every paired sample and was enough for Safari to reload a tab.
          const r1Reads = pair.r1 ? await parseFastqFile(pair.r1) : null;
          const r2Reads = pair.r2 ? await parseFastqFile(pair.r2) : null;
          const normalized = preprocessIlluminaReads(r1Reads, r2Reads, genesPayload, {
            windowSize: params.windowSize,
            phredThreshold: params.phredThreshold,
            marginThreshold: params.marginThreshold,
            cutSiteDistanceWeight: params.cutSiteDistanceWeight,
            cutSiteExclusionFlank: params.cutSiteExclusionFlank,
          });

          if (cancelled) {
            postMessage({ type: 'error', message: 'Analysis canceled by user.' });
            return;
          }

          fileProgress[pair.name] = 20;
          postMessage({
            type: 'progress',
            percent: Math.round(10 + ((i + 0.2) / totalFiles) * 85),
            stage: `Analyzing ${normalized.reads.length.toLocaleString()} normalized molecules from ${pair.name}…`,
            fileProgress: { ...fileProgress },
          });

          allResults.push(processFile(pair.name, normalized.reads, genesPayload, params));
          fileProgress[pair.name] = 100;
          postMessage({
            type: 'progress',
            percent: Math.round(10 + ((i + 1) / totalFiles) * 85),
            stage: `Completed ${pair.name} (${i + 1}/${totalFiles})`,
            fileProgress: { ...fileProgress },
          });
        }
      } else for (let i = 0; i < totalFiles; i++) {
        if (cancelled) {
          postMessage({ type: 'error', message: 'Analysis canceled by user.' });
          return;
        }

        const file = files[i];
        const fileName = file.name;

        // Progress: parsing
        fileProgress[fileName] = 5;
        const overallParsing = Math.round(10 + (i / totalFiles) * 85);
        postMessage({
          type: 'progress',
          percent: overallParsing,
          stage: `Parsing ${fileName} (file ${i + 1}/${totalFiles})…`,
          fileProgress: { ...fileProgress },
        });

        let fileResult: FileResult;
        if (file.size >= LARGE_FASTQ_BYTES) {
          // Keep large FASTQ files out of a single JavaScript array. Each batch
          // is classified and released before the next batch is read.
          let merged: FileResult | null = null;
          let parsedReads = 0;
          const estimatedBatches = Math.max(1, Math.ceil(file.size / (20 * 1024 * 1024)));
          await parseFastqFileInBatches(file, async batch => {
            if (cancelled) throw new Error('Analysis canceled by user.');
            parsedReads += batch.length;
            merged = mergeFileResult(merged, processFile(fileName, batch, genesPayload, params));
            const batchProgress = Math.min(78, 20 + Math.round((parsedReads / Math.max(1, estimatedBatches * 10000)) * 58));
            fileProgress[fileName] = batchProgress;
            postMessage({
              type: 'progress',
              percent: Math.round(10 + ((i + batchProgress / 100) / totalFiles) * 85),
              stage: `Analyzing ${parsedReads.toLocaleString()} reads from large file ${fileName}…`,
              fileProgress: { ...fileProgress },
            });
          });
          if (!merged) throw new Error(`No FASTQ reads were found in ${fileName}.`);
          fileResult = finalizeFileResult(merged);
        } else {
          const reads = await parseFastqFile(file);
          if (cancelled) {
            postMessage({ type: 'error', message: 'Analysis canceled by user.' });
            return;
          }
          fileProgress[fileName] = 20;
          postMessage({
            type: 'progress',
            percent: Math.round(10 + ((i + 0.2) / totalFiles) * 85),
            stage: `Analyzing ${reads.length.toLocaleString()} reads from ${fileName} (file ${i + 1}/${totalFiles})…`,
            fileProgress: { ...fileProgress },
          });
          fileResult = processFile(fileName, reads, genesPayload, params);
        }

        // Progress: complete for this file
        fileProgress[fileName] = 100;
        const overallComplete = Math.round(10 + ((i + 1) / totalFiles) * 85);
        postMessage({
          type: 'progress',
          percent: overallComplete,
          stage: `Completed ${fileName} (file ${i + 1}/${totalFiles})`,
          fileProgress: { ...fileProgress },
        });

        allResults.push(fileResult);
      }

      if (cancelled) {
        postMessage({ type: 'error', message: 'Analysis canceled by user.' });
        return;
      }

      // Build final payload
      const inputFilenames = isIllumina
        ? illuminaPairs.flatMap(pair => [pair.r1?.name, pair.r2?.name].filter((name): name is string => Boolean(name)))
        : files.map(f => f.name);
      const finalPayload = buildFinalPayload(allResults, genesPayload, params, inputFilenames);

      postMessage({ type: 'result', payload: finalPayload });

    } catch (err: any) {
      postMessage({
        type: 'error',
        message: err?.message || 'Unknown error during local analysis.',
      });
    }
  }

  if (type === 'benchmark-run') {
    cancelled = false;
    const { dataset, genesPayload, params } = payload as {
      dataset: Array<{ file?: File | null; r1File?: File | null; r2File?: File | null; gene: string; target: string; reference: string; grna: string }>;
      genesPayload: GenePayload[];
      params: {
        platform: 'nanopore' | 'illumina'; phredThreshold: number; windowSize: number; marginThreshold: number;
        cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number; customWindowLeft?: number; customWindowRight?: number;
      };
    };

    try {
      const parsedDataset = [];
      const totalFiles = dataset.length;
      const prepTotals = { inputMolecules: 0, normalizedMolecules: 0, filteredMolecules: 0, consensusMolecules: 0, paddedMolecules: 0 };
      for (let i = 0; i < totalFiles; i++) {
        if (cancelled) {
          postMessage({ type: 'error', message: 'Benchmark canceled by user.' });
          return;
        }
        const row = dataset[i];
        postMessage({
          type: 'progress',
          percent: Math.round((i / totalFiles) * 15),
          stage: `Parsing FASTQ file for ${row.gene} › ${row.target} (${i + 1}/${totalFiles})…`
        });
        let reads;
        if (params.platform === 'illumina') {
          const r1Reads = row.r1File ? await parseFastqFile(row.r1File) : null;
          const r2Reads = row.r2File ? await parseFastqFile(row.r2File) : null;
          const prepared = preprocessIlluminaReads(r1Reads, r2Reads, genesPayload, params);
          reads = prepared.reads;
          prepTotals.inputMolecules += prepared.stats.inputMolecules;
          prepTotals.normalizedMolecules += prepared.stats.normalizedMolecules;
          prepTotals.filteredMolecules += prepared.stats.filteredMolecules;
          prepTotals.consensusMolecules += prepared.stats.consensusMolecules;
          prepTotals.paddedMolecules += prepared.stats.paddedMolecules;
        } else {
          if (!row.file) throw new Error(`Missing FASTQ file for ${row.gene} › ${row.target}.`);
          reads = await parseFastqFile(row.file);
        }
        parsedDataset.push({
          gene: row.gene,
          target: row.target,
          reference: row.reference,
          grna: row.grna,
          reads: reads
        });
      }

      if (cancelled) {
        postMessage({ type: 'error', message: 'Benchmark canceled by user.' });
        return;
      }

      const res = runBenchmark(
        parsedDataset,
        { ...params, preprocessing: params.platform === 'illumina' ? prepTotals : undefined },
        (pct, stage) => {
          const finalPct = Math.round(15 + (pct / 100) * 85);
          postMessage({ type: 'progress', percent: finalPct, stage });
        }
      );

      postMessage({ type: 'benchmark-result', payload: res });

    } catch (err: any) {
      postMessage({ type: 'error', message: err?.message || 'Failed to run benchmark classification.' });
    }
  }

  if (type === 'illumina-merge-bench') {
    cancelled = false;
    const { r1File, r2File, r1Sequence, r2Sequence, genesPayload, params } = payload as {
      r1File?: File | null; r2File?: File | null; r1Sequence?: string; r2Sequence?: string;
      genesPayload: GenePayload[];
      params: { windowSize: number; phredThreshold: number; marginThreshold: number; cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number };
    };
    try {
      postMessage({ type: 'progress', percent: 10, stage: 'Reading Illumina mates…' });
      const manualRead = (sequence: string | undefined, mate: number) => {
        const seq = (sequence || '').replace(/\s+/g, '').toUpperCase();
        return seq ? [{ id: `manual/` + mate, seq, qual: new Array(seq.length).fill(40) }] : null;
      };
      const r1Reads = r1File ? await parseFastqFile(r1File) : manualRead(r1Sequence, 1);
      const r2Reads = r2File ? await parseFastqFile(r2File) : manualRead(r2Sequence, 2);
      if (!r1Reads && !r2Reads) throw new Error('Provide at least one mate file or sequence.');
      postMessage({ type: 'progress', percent: 35, stage: 'Building stage-1 X-padded pseudo reads…' });
      const stage1 = buildIlluminaPseudoReads(r1Reads, r2Reads, params.windowSize);
      postMessage({ type: 'progress', percent: 60, stage: 'Running window and anchor guided consensus…' });
      const stage2 = preprocessIlluminaReads(r1Reads, r2Reads, genesPayload, params);
      const stage1AutoAlign = suggestIlluminaAlignment(stage1, genesPayload, params);
      const stage2AutoAlign = suggestIlluminaAlignment(stage2.reads, genesPayload, params);
      postMessage({
        type: 'illumina-merge-result',
        payload: {
          stage1Fastq: fastqReadsToString(stage1),
          stage2Fastq: fastqReadsToString(stage2.reads),
          stage1AutoAlign,
          stage2AutoAlign,
          stats: stage2.stats,
          diagnostics: stage2.diagnostics,
        },
      });
    } catch (err: any) {
      postMessage({ type: 'error', message: err?.message || 'Failed to run Illumina merge bench.' });
    }
  }

const fileTextCache = new Map<string, string>();

  if (type === 'export-group-fastq') {
    const { file, target, readInner, params } = payload as {
      file: File;
      target: any;
      readInner: string;
      params: any;
    };

    try {
      const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
      let text = fileTextCache.get(cacheKey);

      if (!text) {
        postMessage({ type: 'progress', percent: 10, stage: 'Reading & decompressing FASTQ file...' });
        text = await readFileAsText(file);
        fileTextCache.set(cacheKey, text);
      }

      postMessage({ type: 'progress', percent: 40, stage: 'Filtering reads for export...' });
      const lines = text.split(/\r?\n/);
      const filteredLines: string[] = [];

      const sgrnaSeq = target.sgrna_seq || '';
      const windowSize = target.window_size ?? 90;
      const windowLeft = target.window_left;
      const windowRight = target.window_right;
      let refWindow = target.ref_window || target.ref_sequence || target.reference_seq || '';
      let cutSiteIndexFixed = target.cut_site_index ?? -1;

      // Extract window if full reference was passed
      if (refWindow.length > (windowSize + 30)) {
        const cutInfo = findGrnaCutSite(refWindow, sgrnaSeq);
        const refCutSite = cutInfo.cut_site;
        refWindow = extractWindow(refWindow, refCutSite, windowSize, windowLeft, windowRight);
        cutSiteIndexFixed = cutIndexInWindow(target.ref_sequence || target.reference_seq, refCutSite, windowSize, windowLeft, windowRight);
      }

      if (cutSiteIndexFixed < 0) {
        cutSiteIndexFixed = Math.floor(refWindow.length / 2);
      }

      const targetReadInner = (readInner || '').trim().toUpperCase();

      // Collect valid Annotation group keys for All Target Reads export
      const validGroupKeys = new Set<string>();
      if (!targetReadInner && target && target.top_groups && Array.isArray(target.top_groups)) {
        for (const g of target.top_groups) {
          if (g && g.read_inner) {
            validGroupKeys.add(g.read_inner.trim().toUpperCase());
          }
        }
      }

      let i = 0;
      let processed = 0;
      while (i < lines.length) {
        if (lines[i].trim() === '' || !lines[i].startsWith('@')) {
          i++;
          continue;
        }
        if (i + 3 >= lines.length) break;

        const seq = lines[i + 1].trim();

        if (seq.length > 0) {
          const [usable, , bestRes] = isReadUsable(seq, null, refWindow, 0, sgrnaSeq, cutSiteIndexFixed);
          
          if (usable && bestRes) {
            const readWin = bestRes.read_window.toUpperCase();
            let shouldInclude = false;
            
            if (targetReadInner) {
              shouldInclude = (readWin === targetReadInner);
            } else if (validGroupKeys.size > 0) {
              shouldInclude = validGroupKeys.has(readWin);
            } else {
              shouldInclude = true;
            }

            if (shouldInclude) {
              filteredLines.push(lines[i].trim());
              filteredLines.push(lines[i + 1].trim());
              filteredLines.push(lines[i + 2].trim());
              filteredLines.push(lines[i + 3].trim());
            }
          }
        }
        i += 4;
        processed++;
        if (processed % 5000 === 0) {
          postMessage({ type: 'progress', percent: 40 + Math.round((i / lines.length) * 50), stage: 'Filtering reads...' });
        }
      }

      postMessage({ type: 'progress', percent: 100, stage: 'Generating FASTQ file...' });
      const blob = new Blob([filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : '')], { type: 'text/plain' });
      postMessage({ type: 'export-group-fastq-result', payload: blob });
    } catch (err: any) {
      postMessage({ type: 'error', message: err?.message || 'Failed to extract group FASTQ.' });
    }
  }
});
