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

import { parseFastqFile } from './core/fastq-parser';
import { processFile, buildFinalPayload, AnalysisParams, FileResult } from './core/analysis-pipeline';
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
});
