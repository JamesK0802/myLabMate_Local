/**
 * multi-reference-assigner.ts — Unified Demultiplexing for Multi-Gene Analysis.
 *
 * 1:1 TypeScript port of backend/core/multi_reference_assigner.py.
 *
 * Gene/reference-level assignment algorithm:
 *   1. Score each read against ALL target windows across ALL genes.
 *   2. Collapse scores by gene: gene_score = max(target window scores for that gene).
 *      Target windows within the same gene are evidence, NOT competitors.
 *   3. Margin check between top-1 and top-2 gene-level scores only.
 *   4. After assignment, downstream analysis runs against every target within the gene.
 */

import {
  findGrnaCutSite,
  extractWindow,
  cutIndexInWindow,
  avgPhred,
  applyGeneClassification,
  ClassInfo,
} from './classifier';

export interface GenePayload {
  gene: string;
  sequence: string;
  targets: Array<{
    target_id: string;
    sgrna_seq: string;
    window_size?: number;
    window_left?: number;
    window_right?: number;
  }>;
}

export interface ReadObj {
  read_index: number;
  seq: string;
  qual: number[] | null;
  best_score: number;
}

export interface GeneBucket {
  gene: string;
  assigned_reads: ReadObj[];
  count: number;
  average_score: number;
}

export interface DemuxResult {
  genes: GeneBucket[];
  ambiguous_reads: ReadObj[];
  debug_logs: {
    total_reads: number;
    assigned_count: number;
    ambiguous_count: number;
    filtered_count: number;
    phred_passed_count: number;
    anchor_matched_count: number;
    usable_for_assignment_count: number;
    assignment_filtered_count: number;
    per_gene_counts: Record<string, number>;
    outcome_counts: Record<string, number>;
  };
}

export function assignReadsToReferences(
  readsData: Array<[string, number[] | null]>,
  genePayloads: GenePayload[],
  phredThreshold: number = 10,
  marginThreshold: number = 0.05,
  cutSiteDistanceWeight: number = 0.0,
  cutSiteExclusionFlank: number = 0
): DemuxResult {
  // 1. Prepare gene-grouped target windows
  const geneClasses: Record<string, ClassInfo[]> = {};
  for (const g of genePayloads) {
    const geneName = g.gene;
    const geneRef = g.sequence;
    geneClasses[geneName] = [];
    for (const t of g.targets || []) {
      const cutInfo = findGrnaCutSite(geneRef, t.sgrna_seq);
      const winSize = t.window_size ?? 90;
      const refWin = extractWindow(geneRef, cutInfo.cut_site, winSize, t.window_left, t.window_right);
      const cutIdx = cutIndexInWindow(geneRef, cutInfo.cut_site, winSize, t.window_left, t.window_right);
      geneClasses[geneName].push({
        target: t.target_id,
        gene: geneName,
        ref_window: refWin,
        sgrna_seq: t.sgrna_seq,
        cut_index_in_window: cutIdx,
      });
    }
  }

  const results: Record<string, ReadObj[]> = {};
  for (const g of genePayloads) results[g.gene] = [];
  const ambiguousReads: ReadObj[] = [];

  const totalReads = readsData.length;
  let ambiguousCount = 0;
  let filteredCount = 0;
  let phredPassedCount = 0;
  const assignedCounts: Record<string, number> = {};
  for (const g of genePayloads) assignedCounts[g.gene] = 0;
  const outcomeCounts: Record<string, number> = {};

  // 2. Iterate and classify
  for (let i = 0; i < readsData.length; i++) {
    const [seq, qual] = readsData[i];

    // Global Phred check
    if (qual !== null) {
      const avgQ = avgPhred(qual);
      if (avgQ >= phredThreshold) phredPassedCount++;
    }

    const res = applyGeneClassification(seq, qual, geneClasses, phredThreshold, marginThreshold, cutSiteDistanceWeight, cutSiteExclusionFlank);

    // Track outcome distribution
    const dbg = res.debug || {};
    const outcome: string = dbg.outcome || 'unknown';
    outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;

    const readObj: ReadObj = {
      read_index: i,
      seq,
      qual,
      best_score: res.top1_score || 0.0,
    };

    if (res.assigned) {
      results[res.predicted_gene!].push(readObj);
      assignedCounts[res.predicted_gene!]++;
    } else {
      if (res.reason === 'filtered') {
        filteredCount++;
      } else {
        ambiguousReads.push(readObj);
        ambiguousCount++;
      }
    }
  }

  // 3. Format output
  const outputGenes: GeneBucket[] = [];
  for (const [geneName, reads] of Object.entries(results)) {
    outputGenes.push({
      gene: geneName,
      assigned_reads: reads,
      count: reads.length,
      average_score: reads.length > 0
        ? reads.reduce((s, r) => s + r.best_score, 0) / reads.length
        : 0.0,
    });
  }

  const totalAssigned = Object.values(assignedCounts).reduce((s, c) => s + c, 0);
  const usableForAssignmentCount = totalReads - filteredCount;

  return {
    genes: outputGenes,
    ambiguous_reads: ambiguousReads,
    debug_logs: {
      total_reads: totalReads,
      assigned_count: totalAssigned,
      ambiguous_count: ambiguousCount,
      filtered_count: filteredCount,
      phred_passed_count: phredPassedCount,
      anchor_matched_count: usableForAssignmentCount,
      usable_for_assignment_count: usableForAssignmentCount,
      assignment_filtered_count: filteredCount,
      per_gene_counts: assignedCounts,
      outcome_counts: outcomeCounts,
    },
  };
}
