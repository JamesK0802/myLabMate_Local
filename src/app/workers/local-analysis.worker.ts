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

import { parseFastqFile, readFileAsText } from './core/fastq-parser';
import { processFile, buildFinalPayload, AnalysisParams, FileResult } from './core/analysis-pipeline';
import { findGrnaCutSite, extractWindow, cutIndexInWindow, isReadUsable } from './core/classifier';
import { GenePayload } from './core/multi-reference-assigner';
import { runSplitPreview, runBenchmark } from './core/benchmark-pipeline';

let cancelled = false;

addEventListener('message', async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'cancel') {
    cancelled = true;
    return;
  }

  if (type === 'analyze') {
    cancelled = false;
    const { files, genesPayload, params } = payload as {
      files: File[];
      genesPayload: GenePayload[];
      params: AnalysisParams;
    };

    try {
      const totalFiles = files.length;
      const fileProgress: Record<string, number> = {};
      for (const f of files) fileProgress[f.name] = 0;

      const allResults: FileResult[] = [];

      for (let i = 0; i < totalFiles; i++) {
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

        // Parse FASTQ
        const reads = await parseFastqFile(file);

        if (cancelled) {
          postMessage({ type: 'error', message: 'Analysis canceled by user.' });
          return;
        }

        // Progress: analyzing
        fileProgress[fileName] = 20;
        postMessage({
          type: 'progress',
          percent: Math.round(10 + ((i + 0.2) / totalFiles) * 85),
          stage: `Analyzing ${reads.length.toLocaleString()} reads from ${fileName} (file ${i + 1}/${totalFiles})…`,
          fileProgress: { ...fileProgress },
        });

        // Run analysis
        const fileResult = processFile(fileName, reads, genesPayload, params);

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
      const inputFilenames = files.map(f => f.name);
      const finalPayload = buildFinalPayload(allResults, genesPayload, params, inputFilenames);

      postMessage({ type: 'result', payload: finalPayload });

    } catch (err: any) {
      postMessage({
        type: 'error',
        message: err?.message || 'Unknown error during local analysis.',
      });
    }
  }

  if (type === 'benchmark-split') {
    const { dataset } = payload as { dataset: Array<{ file: File; gene: string; target: string; reference: string; grna: string }> };
    try {
      const parsedDataset = [];
      for (const row of dataset) {
        const reads = await parseFastqFile(row.file);
        parsedDataset.push({
          gene: row.gene,
          target: row.target,
          reference: row.reference,
          grna: row.grna,
          reads: reads
        });
      }
      const splitPreview = runSplitPreview(parsedDataset);
      postMessage({ type: 'benchmark-split-result', payload: splitPreview });
    } catch (err: any) {
      postMessage({ type: 'error', message: err?.message || 'Failed to compute split preview.' });
    }
  }

  if (type === 'benchmark-run') {
    cancelled = false;
    const { dataset, params, subset } = payload as {
      dataset: Array<{ file: File; gene: string; target: string; reference: string; grna: string }>;
      params: { phredThreshold: number; windowSize: number; marginThreshold: number };
      subset: 'train' | 'test';
    };

    try {
      const parsedDataset = [];
      const totalFiles = dataset.length;
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
        const reads = await parseFastqFile(row.file);
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
        params.phredThreshold,
        params.windowSize,
        params.marginThreshold,
        subset,
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

  if (type === 'export-group-fastq') {
    const { file, target, readInner, params } = payload as {
      file: File;
      target: any;
      readInner: string;
      params: any;
    };

    try {
      postMessage({ type: 'progress', percent: 10, stage: 'Reading FASTQ file...' });
      const text = await readFileAsText(file);
      postMessage({ type: 'progress', percent: 40, stage: 'Filtering reads for group...' });
      const lines = text.split('\n');
      const filteredLines: string[] = [];

      const referenceSeq = target.ref_sequence || target.reference_seq;
      const sgrnaSeq = target.sgrna_seq;
      const windowSize = target.window_size ?? 90;

      const cutInfo = findGrnaCutSite(referenceSeq, sgrnaSeq);
      const refCutSite = cutInfo.cut_site;
      const refWindow = extractWindow(referenceSeq, refCutSite, windowSize);
      const cutSiteIndexFixed = cutIndexInWindow(referenceSeq, refCutSite, windowSize);

      let i = 0;
      let processed = 0;
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          i++;
          continue;
        }
        if (!lines[i].startsWith('@')) {
          i++;
          continue;
        }
        if (i + 3 >= lines.length) break;

        const seq = lines[i + 1].trim();
        const qualStr = lines[i + 3].trim();

        if (seq.length > 0 && qualStr.length > 0) {
          const qual: number[] = new Array(qualStr.length);
          for (let q = 0; q < qualStr.length; q++) {
            qual[q] = qualStr.charCodeAt(q) - 33;
          }

          const [usable, , bestRes] = isReadUsable(seq, qual, refWindow, params.phredThreshold || 10, sgrnaSeq, cutSiteIndexFixed);
          
          if (usable && bestRes && bestRes.read_window.toUpperCase() === readInner.toUpperCase()) {
            filteredLines.push(lines[i].trim());
            filteredLines.push(lines[i + 1].trim());
            filteredLines.push(lines[i + 2].trim());
            filteredLines.push(lines[i + 3].trim());
          }
        }
        i += 4;
        processed++;
        if (processed % 5000 === 0) {
          postMessage({ type: 'progress', percent: 40 + Math.round((i / lines.length) * 50), stage: 'Filtering reads for group...' });
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
