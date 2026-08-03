/**
 * analysis-pipeline.ts — Main CRISPR analysis pipeline for Local Mode.
 *
 * Port of backend/run_local.py's core functions:
 *   - run_analysis_on_reads()
 *   - run_multi_reference_analysis()
 *
 * Produces the exact same JSON structure (target_results, summary,
 * breakdown, top_groups) so the existing ResultDashboardComponent
 * works unchanged.
 */

import {
  findGrnaCutSite,
  extractWindow,
  cutIndexInWindow,
  isReadUsable,
  reverseComplement,
  scoreReadAgainstWindow,
  clearClassifierCache,
  ClassInfo,
} from './classifier';
import { classifyMutationWithAlignment, AlignmentToken } from './analyzer';
import { assignReadsToReferences, GenePayload, DemuxResult } from './multi-reference-assigner';
import { FastqRead } from './fastq-parser';

const SUBSTITUTION_POLICY = 'separate_category_indel_editing_excludes_substitutions';

// ─────────────────────────────────────────────────────────────────────────────
// Types matching the backend JSON output
// ─────────────────────────────────────────────────────────────────────────────

export interface TargetConfig {
  target_id: string;
  reference_seq: string;
  sgrna_seq: string;
  window_size?: number;
}

export interface TopGroup {
  group_rank: number;
  read_inner: string;
  read_count: number;
  read_pct: number;
  classification: string;
  net_indel: number;
  tokens: AlignmentToken[];
}

export interface TargetResult {
  target_id: string;
  summary: {
    total_reads: number;
    matched_reads: number;
    aligned_reads: number;
    out_of_frame_pct: number;
    in_frame_pct: number;
    no_indel_pct: number;
    substitution_pct: number;
    modified: number;
    unmodified: number;
    substitution_reads: number;
    editing_efficiency: number;
    indel_editing_efficiency: number;
    substitution_policy: string;
    read_ambiguous: number;
    low_frequency_filtered: number;
    failed_reads: number;
    failure_reasons: Record<string, number>;
  };
  breakdown: {
    out_of_frame: number;
    in_frame: number;
    no_indel: number;
    substitution: number;
    ambiguous: number;
    failed: number;
    failure_reasons: Record<string, number>;
  };
  sgrna_seq: string;
  display_sgrna_seq: string;
  is_rc: boolean;
  strand: string;
  grna_start_index: number;
  ref_sequence: string;
  cut_site_index: number;
  top_groups: TopGroup[];
  error?: string;
}

export interface MultiTargetSummary {
  total_reads: number;
  reads_evaluated: number;
  reads_with_0_edits: number;
  reads_with_1_edit: number;
  reads_with_2_edits: number;
  reads_with_3_plus_edits: number;
  edit_distribution: Record<number, number>;
  co_editing_matrix: Array<{ target_a: string; target_b: string; co_edited_reads: number }>;
}

export interface GeneResult {
  gene: string;
  assigned_read_count: number;
  ambiguous_excluded: boolean;
  is_ambiguous_derived?: boolean;
  is_rescued_derived?: boolean;
  analysis_result: {
    targets: TargetResult[];
    multi_target_summary?: MultiTargetSummary;
  };
}

export interface MultiReferenceResult {
  genes: GeneResult[];
  ambiguous_read_count: number;
  debug: {
    total_reads_parsed: number;
    phred_passed_count: number;
    anchor_matched_count: number;
    usable_for_assignment_count: number;
    assignment_filtered_count: number;
    assignment_margin_threshold_used: number;
    genes: Array<{
      gene: string;
      reference_length: number;
      assigned_reads_analyzed: number;
      number_of_targets_analyzed: number;
    }>;
  };
}

export interface FileResult {
  fastq_file: string;
  multi_reference_result: MultiReferenceResult;
}

export interface AnalysisPayload {
  metadata: {
    phred_threshold: number;
    indel_threshold: number;
    margin_threshold?: number;
    is_multi_reference: boolean;
    code_version: string;
    input_filenames: string[];
    thresholds: Record<string, any>;
    references?: any[];
    substitution_policy: string;
  };
  results: FileResult[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress callback type
// ─────────────────────────────────────────────────────────────────────────────
export type ProgressCallback = (percent: number, stage: string) => void;

// ─────────────────────────────────────────────────────────────────────────────
// Core Analysis: run_analysis_on_reads
// ─────────────────────────────────────────────────────────────────────────────

interface ReadResult {
  read_index: number;
  target_results: Array<{
    target_id: string;
    evaluated: boolean;
    eval_fail_reason: string;
    classification: string | null;
    has_substitution: boolean;
    net_indel: number;
    edited: boolean;
  }>;
}

function runAnalysisOnReads(
  data: Array<[string, number[] | null]>,
  targets: TargetConfig[],
  phredThreshold: number = 10,
  indelThreshold: number = 1.0
): { target_results: TargetResult[]; multi_target_summary?: MultiTargetSummary } {
  const totalReads = data.length;
  const targetResultsList: TargetResult[] = [];
  const hasMultipleTargets = targets.length > 1;
  const readResults: Record<number, ReadResult> = {};

  for (const target of targets) {
    const targetId = target.target_id;
    const referenceSeq = target.reference_seq;
    const sgrnaSeq = target.sgrna_seq;
    const windowSize = target.window_size ?? 90;

    if (!referenceSeq) continue;

    // Step 1 & 2: Locate gRNA and Build Reference Window
    const cutInfo = findGrnaCutSite(referenceSeq, sgrnaSeq);
    const isRcInRef = cutInfo.strand === 'reverse';
    const refSgrnaStart = cutInfo.grna_start;
    const refCutSite = cutInfo.cut_site;

    if (refSgrnaStart === -1) {
      targetResultsList.push({
        target_id: targetId,
        error: 'gRNA not found in reference',
        summary: { total_reads: totalReads, matched_reads: 0, aligned_reads: 0 } as any,
      } as any);
      continue;
    }

    const refWindow = extractWindow(referenceSeq, refCutSite, windowSize);
    const cutSiteIndexFixed = cutIndexInWindow(referenceSeq, refCutSite, windowSize);
    const refInnerFixed = refWindow.toUpperCase();

    // Calculate gRNA position in window
    const searchSgrna = isRcInRef ? reverseComplement(sgrnaSeq).toUpperCase() : sgrnaSeq.toUpperCase();
    const grnaMatchIdx = refWindow.toUpperCase().indexOf(searchSgrna);
    const grnaStartInInner = grnaMatchIdx !== -1 ? grnaMatchIdx : -1;

    // Step 3: Counters
    const counts: Record<string, number> = {
      total_reads: totalReads,
      forward_aligned: 0,
      reverse_aligned: 0,
      aligned_reads: 0,
      out_of_frame: 0,
      in_frame: 0,
      no_indel: 0,
      substitution: 0,
      fail_no_anchor: 0,
      fail_quality: 0,
      fail_no_coverage: 0,
      fail_no_alignment: 0,
    };

    const groupsDict: Record<string, {
      read_inner: string;
      read_count: number;
      classification: string;
      net_indel: number;
      has_sub: boolean;
      tokens: AlignmentToken[];
    }> = {};

    // Step 4: Process each read
    for (let i = 0; i < data.length; i++) {
      const [seq, qual] = data[i];
      const [usable, reason, bestRes] = isReadUsable(seq, qual, refWindow, phredThreshold, sgrnaSeq, cutSiteIndexFixed);

      if (!usable) {
        if (reason === 'quality') counts['fail_quality']++;
        else counts[`fail_${reason}`]++;

        if (hasMultipleTargets) {
          if (!readResults[i]) readResults[i] = { read_index: i, target_results: [] };
          readResults[i].target_results.push({
            target_id: targetId,
            evaluated: false,
            eval_fail_reason: reason,
            classification: null,
            has_substitution: false,
            net_indel: 0,
            edited: false,
          });
        }
        continue;
      }

      counts['aligned_reads']++;
      if (bestRes!.is_rc) counts['reverse_aligned']++;
      else counts['forward_aligned']++;

      const readWindow = bestRes!.read_window;
      const observedRead = bestRes!.observed_read;
      const leftX = bestRes!.left_x;
      const rightX = bestRes!.right_x;

      // Classify
      const { category, has_sub: hasSub, net_indel: netIndel, tokens: readTokens } =
        classifyMutationWithAlignment(refWindow.toUpperCase(), observedRead.toUpperCase(), leftX, rightX);

      counts[category]++;
      if (hasSub) counts['substitution']++;

      // Grouping for Annotation View
      const key = readWindow.toUpperCase();
      if (!groupsDict[key]) {
        groupsDict[key] = {
          read_inner: key,
          read_count: 0,
          classification: category,
          net_indel: netIndel,
          has_sub: hasSub,
          tokens: readTokens,
        };
      }
      groupsDict[key].read_count++;

      // Multi-Target tracking
      if (hasMultipleTargets) {
        const isEdited = category !== 'no_indel' || hasSub;
        if (!readResults[i]) readResults[i] = { read_index: i, target_results: [] };
        readResults[i].target_results.push({
          target_id: targetId,
          evaluated: true,
          eval_fail_reason: 'ok',
          classification: category,
          has_substitution: hasSub,
          net_indel: netIndel,
          edited: isEdited,
        });
      }
    }

    // Step 5: Indel Threshold Filter
    const aligned = counts['aligned_reads'];
    const thresholdCount = aligned * (indelThreshold / 100.0);

    const passedGroupsDict: Record<string, typeof groupsDict[string]> = {};
    for (const [k, g] of Object.entries(groupsDict)) {
      if (g.read_count >= thresholdCount) passedGroupsDict[k] = g;
    }

    const newAligned = Object.values(passedGroupsDict).reduce((s, g) => s + g.read_count, 0);
    const newOutOfFrame = Object.values(passedGroupsDict)
      .filter(g => g.classification === 'out_of_frame')
      .reduce((s, g) => s + g.read_count, 0);
    const newInFrame = Object.values(passedGroupsDict)
      .filter(g => g.classification === 'in_frame')
      .reduce((s, g) => s + g.read_count, 0);
    const newNoIndel = Object.values(passedGroupsDict)
      .filter(g => g.classification === 'no_indel')
      .reduce((s, g) => s + g.read_count, 0);
    const newSubstitution = Object.values(passedGroupsDict)
      .filter(g => g.classification === 'no_indel' && g.has_sub)
      .reduce((s, g) => s + g.read_count, 0);
    const newPureNoIndel = newNoIndel - newSubstitution;
    const newModified = newOutOfFrame + newInFrame;
    const failedReads =
      counts['fail_no_anchor'] + counts['fail_quality'] +
      counts['fail_no_coverage'] + counts['fail_no_alignment'];

    counts['read_ambiguous'] = aligned - newAligned;
    counts['aligned_passed'] = newAligned;

    const pct = (val: number) => newAligned > 0 ? Math.round((val / newAligned) * 10000) / 100 : 0.0;

    // Step 5b: Top Groups
    const sortedGroups = Object.values(passedGroupsDict)
      .sort((a, b) => b.read_count - a.read_count)
      .slice(0, 10);

    const topGroups: TopGroup[] = sortedGroups.map((g, idx) => {
      let displayClass: string;
      if (g.classification === 'out_of_frame') displayClass = 'Out-of-frame indel';
      else if (g.classification === 'in_frame') displayClass = 'In-frame indel';
      else if (g.classification === 'no_indel' && g.has_sub) displayClass = 'Substitution';
      else displayClass = 'No indel';

      return {
        group_rank: idx + 1,
        read_inner: g.read_inner,
        read_count: g.read_count,
        read_pct: pct(g.read_count),
        classification: displayClass,
        net_indel: g.net_indel,
        tokens: g.tokens,
      };
    });

    // Step 6: Build result payload
    const failureReasons = {
      fail_no_anchor: counts['fail_no_anchor'],
      fail_quality: counts['fail_quality'],
      fail_no_coverage: counts['fail_no_coverage'],
      fail_no_alignment: counts['fail_no_alignment'],
      low_frequency_filtered: counts['read_ambiguous'],
    };

    const targetResult: TargetResult = {
      target_id: targetId,
      summary: {
        total_reads: totalReads,
        matched_reads: aligned,
        aligned_reads: newAligned,
        out_of_frame_pct: pct(newOutOfFrame),
        in_frame_pct: pct(newInFrame),
        no_indel_pct: pct(newPureNoIndel),
        substitution_pct: pct(newSubstitution),
        modified: newModified,
        unmodified: newPureNoIndel,
        substitution_reads: newSubstitution,
        editing_efficiency: pct(newModified),
        indel_editing_efficiency: pct(newModified),
        substitution_policy: SUBSTITUTION_POLICY,
        read_ambiguous: counts['read_ambiguous'],
        low_frequency_filtered: counts['read_ambiguous'],
        failed_reads: failedReads,
        failure_reasons: failureReasons,
      },
      breakdown: {
        out_of_frame: newOutOfFrame,
        in_frame: newInFrame,
        no_indel: newPureNoIndel,
        substitution: newSubstitution,
        ambiguous: failedReads,
        failed: failedReads,
        failure_reasons: failureReasons,
      },
      sgrna_seq: sgrnaSeq,
      display_sgrna_seq: isRcInRef ? reverseComplement(sgrnaSeq) : sgrnaSeq,
      is_rc: isRcInRef,
      strand: cutInfo.strand,
      grna_start_index: grnaStartInInner,
      ref_sequence: refInnerFixed,
      cut_site_index: cutSiteIndexFixed,
      top_groups: topGroups,
    };

    targetResultsList.push(targetResult);
  }

  // Multi-Target Summary
  if (hasMultipleTargets && Object.keys(readResults).length > 0) {
    const editDistribution: Record<number, number> = {};
    const coEditingMatrix: Record<string, number> = {};

    for (const rr of Object.values(readResults)) {
      const evaluatedTargets = rr.target_results.filter(tr => tr.evaluated);
      const editedTargets = evaluatedTargets.filter(tr => tr.edited);
      const nEdited = editedTargets.length;
      editDistribution[nEdited] = (editDistribution[nEdited] || 0) + 1;

      const editedIds = editedTargets.map(tr => tr.target_id);
      for (let ai = 0; ai < editedIds.length; ai++) {
        for (let bi = ai + 1; bi < editedIds.length; bi++) {
          const pair = [editedIds[ai], editedIds[bi]].sort().join('|');
          coEditingMatrix[pair] = (coEditingMatrix[pair] || 0) + 1;
        }
      }
    }

    const multiTargetSummary: MultiTargetSummary = {
      total_reads: totalReads,
      reads_evaluated: Object.keys(readResults).length,
      reads_with_0_edits: editDistribution[0] || 0,
      reads_with_1_edit: editDistribution[1] || 0,
      reads_with_2_edits: editDistribution[2] || 0,
      reads_with_3_plus_edits: Object.entries(editDistribution)
        .filter(([k]) => parseInt(k) >= 3)
        .reduce((s, [, v]) => s + v, 0),
      edit_distribution: editDistribution,
      co_editing_matrix: Object.entries(coEditingMatrix)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pair, count]) => {
          const [ta, tb] = pair.split('|');
          return { target_a: ta, target_b: tb, co_edited_reads: count };
        }),
    };

    return { target_results: targetResultsList, multi_target_summary: multiTargetSummary };
  }

  return { target_results: targetResultsList };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Reference Analysis Pipeline
// ─────────────────────────────────────────────────────────────────────────────

export function runMultiReferenceAnalysis(
  data: Array<[string, number[] | null]>,
  genesPayload: GenePayload[],
  assignmentMarginThreshold: number = 0.05,
  phredThreshold: number = 10,
  indelThreshold: number = 1.0,
  analyzeAmbiguous: boolean = false,
  rescueAmbiguous: boolean = false,
  rescueThreshold: number = 20,
  cutSiteDistanceWeight: number = 0.0,
  cutSiteExclusionFlank: number = 0
): MultiReferenceResult {
  const totalReadsInitial = data.length;

  // Demultiplex
  const demuxResult = assignReadsToReferences(
    data, genesPayload, phredThreshold, assignmentMarginThreshold, cutSiteDistanceWeight, cutSiteExclusionFlank
  );

  const ambiguousReadsCount = demuxResult.ambiguous_reads.length;

  const output: MultiReferenceResult = {
    genes: [],
    ambiguous_read_count: ambiguousReadsCount,
    debug: {
      total_reads_parsed: totalReadsInitial,
      phred_passed_count: demuxResult.debug_logs.phred_passed_count,
      anchor_matched_count: demuxResult.debug_logs.anchor_matched_count,
      usable_for_assignment_count: demuxResult.debug_logs.usable_for_assignment_count,
      assignment_filtered_count: demuxResult.debug_logs.assignment_filtered_count,
      assignment_margin_threshold_used: assignmentMarginThreshold,
      genes: [],
    },
  };

  // Run analysis for each gene bucket
  for (const geneBucket of demuxResult.genes) {
    const geneName = geneBucket.gene;
    const assignedReadsInfo = geneBucket.assigned_reads;

    const genePayload = genesPayload.find(g => g.gene === geneName);
    if (!genePayload) continue;

    const targets: TargetConfig[] = (genePayload.targets || []).map(t => ({
      target_id: t.target_id,
      reference_seq: genePayload.sequence,
      sgrna_seq: t.sgrna_seq,
      window_size: t.window_size ?? 90,
    }));

    const geneReadsData: Array<[string, number[] | null]> = assignedReadsInfo.map(r => [r.seq, r.qual]);
    const assignedCount = geneReadsData.length;

    const rawAnalysis = runAnalysisOnReads(geneReadsData, targets, phredThreshold, indelThreshold);

    const geneEntry: GeneResult = {
      gene: geneName,
      assigned_read_count: assignedCount,
      ambiguous_excluded: true,
      analysis_result: {
        targets: rawAnalysis.target_results,
      },
    };
    if (rawAnalysis.multi_target_summary) {
      geneEntry.analysis_result.multi_target_summary = rawAnalysis.multi_target_summary;
    }
    output.genes.push(geneEntry);

    output.debug.genes.push({
      gene: geneName,
      reference_length: genePayload.sequence.length,
      assigned_reads_analyzed: assignedCount,
      number_of_targets_analyzed: targets.length,
    });
  }

  // ── Step 5c: OPTIONAL: Analyze Ambiguous Reads separately for each class ──
  if (analyzeAmbiguous && demuxResult.ambiguous_reads.length > 0) {
    const ambReadsData: Array<[string, number[] | null]> = demuxResult.ambiguous_reads.map(r => [r.seq, r.qual]);

    let ambReadsToAnalyze = ambReadsData;

    if (rescueAmbiguous) {
      const rescuedByClass: Record<string, Array<[string, number[] | null]>> = {};
      for (const g of genesPayload) rescuedByClass[g.gene] = [];
      const unresolvedReads: Array<[string, number[] | null]> = [];

      const classifierClasses: Array<{
        gene: string;
        target: string;
        ref_window: string;
        sgrna_seq: string;
        cut_index_in_window: number;
      }> = [];

      for (const g of genesPayload) {
        for (const t of g.targets || []) {
          const cutInfo = findGrnaCutSite(g.sequence, t.sgrna_seq);
          const winSize = t.window_size ?? 90;
          const refWin = extractWindow(g.sequence, cutInfo.cut_site, winSize);
          const cutIdx = cutIndexInWindow(g.sequence, cutInfo.cut_site, winSize);
          classifierClasses.push({
            gene: g.gene,
            target: t.target_id,
            ref_window: refWin,
            sgrna_seq: t.sgrna_seq,
            cut_index_in_window: cutIdx,
          });
        }
      }

      // 1. Loosely assign each read to a target and extract read_window
      const geneReadGroups: Record<string, Record<string, Array<[[string, number[] | null], string]>>> = {};
      for (const g of genesPayload) geneReadGroups[g.gene] = {};

      for (const r of ambReadsData) {
        const [seq, qual] = r;
        const scores: Array<{ score: number; gene: string; readWindow: string }> = [];

        for (const c of classifierClasses) {
          const [usable, reason, bestRes] = isReadUsable(
            seq, qual, c.ref_window, phredThreshold, c.sgrna_seq, c.cut_index_in_window
          );
          if (usable) {
            const score = scoreReadAgainstWindow(seq, c.ref_window);
            scores.push({ score, gene: c.gene, readWindow: bestRes!.read_window });
          }
        }

        scores.sort((a, b) => b.score - a.score);
        if (scores.length === 0) {
          unresolvedReads.push(r);
          continue;
        }

        const top1 = scores[0];
        const key = top1.readWindow.toUpperCase();
        if (!geneReadGroups[top1.gene][key]) {
          geneReadGroups[top1.gene][key] = [];
        }
        geneReadGroups[top1.gene][key].push([r, key]);
      }

      // 2. Filter Exact Match clusters < rescueThreshold and finalize rescue
      for (const gName of Object.keys(geneReadGroups)) {
        for (const [key, readsList] of Object.entries(geneReadGroups[gName])) {
          if (readsList.length < rescueThreshold) {
            for (const item of readsList) {
              unresolvedReads.push(item[0]);
            }
          } else {
            for (const item of readsList) {
              rescuedByClass[gName].push(item[0]);
            }
          }
        }
      }

      for (const genePayload of genesPayload) {
        const gName = genePayload.gene;
        const rescuedReads = rescuedByClass[gName];
        if (rescuedReads.length > 0) {
          const gTargets: TargetConfig[] = (genePayload.targets || []).map(t => ({
            target_id: t.target_id,
            reference_seq: genePayload.sequence,
            sgrna_seq: t.sgrna_seq,
            window_size: t.window_size ?? 90,
          }));

          const rawRescued = runAnalysisOnReads(rescuedReads, gTargets, phredThreshold, indelThreshold);

          const rescuedEntry: GeneResult = {
            gene: `${gName}-rescued`,
            assigned_read_count: rescuedReads.length,
            ambiguous_excluded: false,
            is_rescued_derived: true,
            analysis_result: {
              targets: rawRescued.target_results,
            },
          };
          if (rawRescued.multi_target_summary) {
            rescuedEntry.analysis_result.multi_target_summary = rawRescued.multi_target_summary;
          }
          output.genes.push(rescuedEntry);
        }
      }

      ambReadsToAnalyze = unresolvedReads;
    } else {
      ambReadsToAnalyze = ambReadsData;
    }

    if (ambReadsToAnalyze.length > 0) {
      for (const genePayload of genesPayload) {
        const gName = genePayload.gene;
        const gTargets: TargetConfig[] = (genePayload.targets || []).map(t => ({
          target_id: t.target_id,
          reference_seq: genePayload.sequence,
          sgrna_seq: t.sgrna_seq,
          window_size: t.window_size ?? 90,
        }));

        const rawAmb = runAnalysisOnReads(ambReadsToAnalyze, gTargets, phredThreshold, indelThreshold);

        const ambEntry: GeneResult = {
          gene: `${gName}-ambiguous`,
          assigned_read_count: ambReadsToAnalyze.length,
          ambiguous_excluded: false,
          is_ambiguous_derived: true,
          analysis_result: {
            targets: rawAmb.target_results,
          },
        };
        if (rawAmb.multi_target_summary) {
          ambEntry.analysis_result.multi_target_summary = rawAmb.multi_target_summary;
        }
        output.genes.push(ambEntry);
      }
    }
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-Level Entry Point for Web Worker
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalysisParams {
  phredThreshold: number;
  indelThreshold: number;
  marginThreshold: number;
  windowSize: number;
  analyzeAmbiguous?: boolean;
  rescueAmbiguous?: boolean;
  rescueThreshold?: number;
  cutSiteDistanceWeight?: number;
  cutSiteExclusionFlank?: number;
}

export function processFile(
  fileName: string,
  reads: FastqRead[],
  genesPayload: GenePayload[],
  params: AnalysisParams
): FileResult {
  clearClassifierCache();

  const data: Array<[string, number[] | null]> = reads.map(r => [r.seq, r.qual]);

  // Ensure all targets have window_size from params
  for (const g of genesPayload) {
    for (const t of g.targets) {
      if (!t.window_size) t.window_size = params.windowSize;
    }
  }

  const multiRefResult = runMultiReferenceAnalysis(
    data,
    genesPayload,
    params.marginThreshold,
    params.phredThreshold,
    params.indelThreshold,
    params.analyzeAmbiguous ?? false,
    params.rescueAmbiguous ?? false,
    params.rescueThreshold ?? 20,
    params.cutSiteDistanceWeight ?? 0.0,
    params.cutSiteExclusionFlank ?? 0
  );

  return {
    fastq_file: fileName,
    multi_reference_result: multiRefResult,
  };
}

export function buildFinalPayload(
  fileResults: FileResult[],
  genesPayload: GenePayload[],
  params: AnalysisParams,
  inputFilenames: string[]
): AnalysisPayload {
  return {
    metadata: {
      phred_threshold: params.phredThreshold,
      indel_threshold: params.indelThreshold,
      margin_threshold: params.marginThreshold,
      is_multi_reference: true,
      code_version: 'local-mode',
      input_filenames: inputFilenames,
      thresholds: {
        phred_threshold: params.phredThreshold,
        indel_threshold: params.indelThreshold,
        assignment_margin_threshold: params.marginThreshold,
        rescue_filtering_threshold: params.rescueThreshold,
        analyze_ambiguous: params.analyzeAmbiguous ?? false,
        rescue_ambiguous: params.rescueAmbiguous ?? false,
      },
      references: genesPayload.map(g => ({
        gene: g.gene,
        target_ids: g.targets.map(t => t.target_id),
      })),
      substitution_policy: SUBSTITUTION_POLICY,
    },
    results: fileResults,
  };
}

