import { FastqRead, normalizeFastqReadId } from './fastq-parser';
import {
  ReadResult,
  cutIndexInWindow,
  extractWindow,
  findGrnaCutSite,
  isReadUsableUncached,
  reverseComplement,
  scoreReadAgainstWindow,
} from './classifier';
import { GenePayload } from './multi-reference-assigner';

export interface IlluminaPreprocessOptions {
  windowSize: number;
  phredThreshold: number;
  marginThreshold?: number;
  cutSiteDistanceWeight?: number;
  cutSiteExclusionFlank?: number;
  minOverlapBases?: number;
  minOverlapIdentity?: number;
}

export const DEFAULT_ILLUMINA_MIN_OVERLAP_BASES = 10;
export const DEFAULT_ILLUMINA_MIN_OVERLAP_IDENTITY = 0.90;

interface TargetContext {
  key: string;
  gene: string;
  targetId: string;
  refSeq: string;
  refWindow: string;
  sgrnaSeq: string;
  windowSize: number;
  cutIndex: number;
}

export interface IlluminaAlignmentHint {
  gene: string;
  targetId: string;
  windowSeq: string;
  refSeq: string;
  grnaSeq: string;
  winSize: number;
}

interface MatePass {
  context: TargetContext;
  result: ReadResult;
  score: number;
}

export type IlluminaMateFailureReason = 'quality' | 'no_anchor' | 'no_coverage' | 'no_alignment' | 'no_target_window';

export interface IlluminaFilteredMoleculeDiagnostic {
  recordNumber: number;
  readId: string;
  reason: IlluminaMateFailureReason;
  r1Reason: IlluminaMateFailureReason;
  r2Reason: IlluminaMateFailureReason;
}

export interface IlluminaPreprocessDiagnostics {
  filteredMolecules: IlluminaFilteredMoleculeDiagnostic[];
  reasonCounts: Record<IlluminaMateFailureReason, number>;
}

export interface IlluminaWindowEvidence {
  key: string;
  gene: string;
  targetId: string;
  r1Score: number | null;
  r2Score: number | null;
}

export function combineIlluminaMateScores(r1Score: number | null, r2Score: number | null): number | null {
  if (r1Score === null) return r2Score;
  if (r2Score === null) return r1Score;
  return (r1Score + r2Score) / 2;
}

/**
 * Select a representative target from scored evidence. Pair normalization no
 * longer calls this function; it remains for post-normalization Sequence Viewer
 * alignment hints, while gene assignment stays in the shared analysis pipeline.
 */
export function selectIlluminaConsensusEvidence(
  evidence: IlluminaWindowEvidence[],
  marginThreshold: number
): IlluminaWindowEvidence | null {
  const scored = evidence
    .map(item => ({ item, score: combineIlluminaMateScores(item.r1Score, item.r2Score) }))
    .filter((entry): entry is { item: IlluminaWindowEvidence; score: number } => entry.score !== null);
  if (scored.length === 0) return null;

  // Match the Nanopore classifier: target windows are collapsed as evidence
  // within a gene, then the best genes are compared by their score margin.
  const bestByGene = new Map<string, { item: IlluminaWindowEvidence; score: number }>();
  for (const entry of scored) {
    const current = bestByGene.get(entry.item.gene);
    if (!current || entry.score > current.score) bestByGene.set(entry.item.gene, entry);
  }
  const genes = [...bestByGene.values()].sort((a, b) => b.score - a.score);
  if (genes.length > 1 && genes[0].score - genes[1].score < marginThreshold) return null;

  const winningGene = genes[0].item.gene;
  const targetCandidates = scored
    .filter(entry => entry.item.gene === winningGene)
    .sort((a, b) => b.score - a.score);

  // A consensus needs one concrete coordinate system. If two target windows
  // inside the winning gene are effectively tied, keep the mates X-separated.
  if (targetCandidates.length > 1 && targetCandidates[0].score - targetCandidates[1].score < marginThreshold) {
    return null;
  }
  return targetCandidates[0].item;
}

export interface IlluminaPreprocessStats {
  inputMolecules: number;
  normalizedMolecules: number;
  filteredMolecules: number;
  consensusMolecules: number;
  paddedMolecules: number;
}

export interface IlluminaPreprocessResult {
  reads: FastqRead[];
  stats: IlluminaPreprocessStats;
  diagnostics: IlluminaPreprocessDiagnostics;
}

function targetContexts(genes: GenePayload[], defaultWindowSize: number): TargetContext[] {
  const contexts: TargetContext[] = [];
  for (const gene of genes) {
    for (const target of gene.targets || []) {
      const windowSize = target.window_size ?? defaultWindowSize;
      const cut = findGrnaCutSite(gene.sequence, target.sgrna_seq);
      if (cut.grna_start < 0) continue;
      contexts.push({
        key: `${gene.gene}\u0000${target.target_id}`,
        gene: gene.gene,
        targetId: target.target_id,
        refSeq: gene.sequence,
        refWindow: extractWindow(gene.sequence, cut.cut_site, windowSize, target.window_left, target.window_right),
        sgrnaSeq: target.sgrna_seq,
        windowSize,
        cutIndex: cutIndexInWindow(gene.sequence, cut.cut_site, windowSize, target.window_left, target.window_right),
      });
    }
  }
  return contexts;
}

function primaryFailureReason(reasons: string[]): IlluminaMateFailureReason {
  if (reasons.includes('quality')) return 'quality';
  if (reasons.includes('no_anchor')) return 'no_anchor';
  if (reasons.includes('no_coverage')) return 'no_coverage';
  if (reasons.includes('no_alignment')) return 'no_alignment';
  return 'no_target_window';
}

function evaluateMate(
  read: FastqRead,
  contexts: TargetContext[],
  options: IlluminaPreprocessOptions
): { passes: MatePass[]; failureReason: IlluminaMateFailureReason } {
  const passes: MatePass[] = [];
  const failures: string[] = [];
  for (const context of contexts) {
    const [usable, failureReason, result] = isReadUsableUncached(
      read.seq,
      read.qual,
      context.refWindow,
      options.phredThreshold,
      context.sgrnaSeq,
      context.cutIndex
    );
    if (usable && result) {
      passes.push({
        context,
        result,
        score: scoreReadAgainstWindow(
          result.read_window,
          context.refWindow,
          context.cutIndex,
          options.cutSiteDistanceWeight ?? 0.0,
          options.cutSiteExclusionFlank ?? 0
        ),
      });
    } else {
      failures.push(failureReason);
    }
  }
  return { passes, failureReason: primaryFailureReason(failures) };
}

function findPasses(read: FastqRead, contexts: TargetContext[], options: IlluminaPreprocessOptions): MatePass[] {
  return evaluateMate(read, contexts, options).passes;
}

function reverseComplementRead(read: FastqRead): FastqRead {
  return {
    id: read.id,
    seq: reverseComplement(read.seq),
    qual: [...read.qual].reverse(),
  };
}

export interface IlluminaPairNormalization {
  read: FastqRead;
  merged: boolean;
  overlapBases: number;
  overlapIdentity: number;
}

/**
 * Normalize a pair without reference or target information. R2 must already be
 * reverse-complemented. The longest suffix(R1)-prefix(R2rc) overlap satisfying
 * both thresholds is collapsed; otherwise the mates remain separated by X.
 */
export function normalizeIlluminaPairByOverlap(
  r1: FastqRead,
  r2rc: FastqRead,
  windowSize: number,
  minOverlapBases: number = DEFAULT_ILLUMINA_MIN_OVERLAP_BASES,
  minOverlapIdentity: number = DEFAULT_ILLUMINA_MIN_OVERLAP_IDENTITY,
): IlluminaPairNormalization {
  const aSeq = r1.seq.toUpperCase();
  const bSeq = r2rc.seq.toUpperCase();
  const maximumOverlap = Math.min(aSeq.length, bSeq.length);
  const minimumOverlap = Math.max(1, Math.floor(minOverlapBases));

  for (let overlap = maximumOverlap; overlap >= minimumOverlap; overlap--) {
    const aStart = aSeq.length - overlap;
    let comparable = 0;
    let matches = 0;
    for (let offset = 0; offset < overlap; offset++) {
      const a = aSeq[aStart + offset];
      const b = bSeq[offset];
      if (a === 'X' || b === 'X' || a === 'N' || b === 'N') continue;
      comparable++;
      if (a === b) matches++;
    }
    const identity = comparable > 0 ? matches / comparable : 0;
    if (comparable < minimumOverlap || identity < minOverlapIdentity) continue;

    const sequence = aSeq.slice(0, aStart).split('');
    const quality = Array.from(r1.qual).slice(0, aStart);
    for (let offset = 0; offset < overlap; offset++) {
      const ai = aStart + offset;
      const qa = r1.qual[ai] ?? 0;
      const qb = r2rc.qual[offset] ?? 0;
      if (aSeq[ai] === bSeq[offset] || qa >= qb) {
        sequence.push(aSeq[ai]);
        quality.push(Math.max(qa, qb));
      } else {
        sequence.push(bSeq[offset]);
        quality.push(qb);
      }
    }
    sequence.push(...bSeq.slice(overlap).split(''));
    quality.push(...Array.from(r2rc.qual).slice(overlap));
    return {
      read: { id: r1.id || r2rc.id, seq: sequence.join(''), qual: quality },
      merged: true,
      overlapBases: overlap,
      overlapIdentity: identity,
    };
  }

  const paddingLength = Math.max(1, windowSize);
  return {
    read: {
      id: r1.id || r2rc.id,
      seq: `${aSeq}${'X'.repeat(paddingLength)}${bSeq}`,
      qual: [...Array.from(r1.qual), ...new Array(paddingLength).fill(0), ...Array.from(r2rc.qual)],
    },
    merged: false,
    overlapBases: 0,
    overlapIdentity: 0,
  };
}

function validatePair(r1: FastqRead, r2: FastqRead, index: number): void {
  const id1 = normalizeFastqReadId(r1.id || '');
  const id2 = normalizeFastqReadId(r2.id || '');
  if (id1 && id2 && id1 !== id2) {
    throw new Error(`Paired FASTQ record mismatch at record ${index + 1}: "${r1.id}" does not match "${r2.id}".`);
  }
}

/** Build target-independent overlap consensus or X-guarded representations. */
export function buildIlluminaPseudoReads(
  r1Reads: FastqRead[] | null,
  r2Reads: FastqRead[] | null,
  windowSize: number
): FastqRead[] {
  if (!r1Reads && !r2Reads) return [];
  if (!r1Reads) return (r2Reads || []).map(reverseComplementRead);
  if (!r2Reads) return r1Reads.map(read => ({ ...read, qual: [...read.qual] }));
  if (r1Reads.length !== r2Reads.length) {
    throw new Error(`Paired FASTQ files contain different record counts (${r1Reads.length} R1 vs ${r2Reads.length} R2).`);
  }

  return r1Reads.map((r1, index) => {
    validatePair(r1, r2Reads[index], index);
    const r2rc = reverseComplementRead(r2Reads[index]);
    return normalizeIlluminaPairByOverlap(r1, r2rc, windowSize).read;
  });
}

export function fastqReadsToString(reads: FastqRead[]): string {
  return reads.map((read, index) => {
    const id = read.id || `read_${index + 1}`;
    const quality = Array.from(read.qual, score => String.fromCharCode(Math.max(0, Math.min(93, score)) + 33)).join('');
    return `@${id}\n${read.seq}\n+\n${quality}`;
  }).join('\n') + (reads.length ? '\n' : '');
}

/**
 * Choose the reference/window that best represents a generated FASTQ file in
 * Sequence Viewer. Every read votes only after passing the same window and
 * anchor checks used by Illumina preprocessing. This avoids blindly aligning
 * a multi-reference export to the first configured target.
 */
export function suggestIlluminaAlignment(
  reads: FastqRead[],
  genes: GenePayload[],
  options: IlluminaPreprocessOptions
): IlluminaAlignmentHint | null {
  const contexts = targetContexts(genes, options.windowSize);
  if (!reads.length || !contexts.length) return null;

  const votes = new Map<string, { context: TargetContext; count: number; score: number }>();
  for (const read of reads) {
    const passes = findPasses(read, contexts, options);
    const evidence = passes.map(pass => ({
      key: pass.context.key,
      gene: pass.context.gene,
      targetId: pass.context.targetId,
      r1Score: pass.score,
      r2Score: null,
    }));
    const selected = selectIlluminaConsensusEvidence(evidence, options.marginThreshold ?? 0.05);
    if (!selected) continue;
    const pass = passes.find(item => item.context.key === selected.key);
    if (!pass) continue;
    const current = votes.get(selected.key) || { context: pass.context, count: 0, score: 0 };
    current.count++;
    current.score += pass.score;
    votes.set(selected.key, current);
  }

  const dominant = [...votes.values()].sort((a, b) => b.count - a.count || b.score - a.score)[0];
  if (!dominant) return null;
  return {
    gene: dominant.context.gene,
    targetId: dominant.context.targetId,
    windowSeq: dominant.context.refWindow,
    refSeq: dominant.context.refSeq,
    grnaSeq: dominant.context.sgrnaSeq,
    winSize: dominant.context.windowSize,
  };
}

/** Convert one Illumina sample into logical reads consumed by processFile(). */
export function preprocessIlluminaReads(
  r1Reads: FastqRead[] | null,
  r2Reads: FastqRead[] | null,
  genes: GenePayload[],
  options: IlluminaPreprocessOptions
): IlluminaPreprocessResult {
  const inputCount = Math.max(r1Reads?.length || 0, r2Reads?.length || 0);
  const stats: IlluminaPreprocessStats = {
    inputMolecules: inputCount,
    normalizedMolecules: 0,
    filteredMolecules: 0,
    consensusMolecules: 0,
    paddedMolecules: 0,
  };
  const diagnostics: IlluminaPreprocessDiagnostics = {
    filteredMolecules: [],
    reasonCounts: {
      quality: 0,
      no_anchor: 0,
      no_coverage: 0,
      no_alignment: 0,
      no_target_window: 0,
    },
  };

  if (!r1Reads && !r2Reads) return { reads: [], stats, diagnostics };
  if (!r1Reads) {
    const reads = (r2Reads || []).map(reverseComplementRead);
    stats.normalizedMolecules = reads.length;
    return { reads, stats, diagnostics };
  }
  if (!r2Reads) {
    stats.normalizedMolecules = r1Reads.length;
    return { reads: r1Reads.map(read => ({ ...read, qual: [...read.qual] })), stats, diagnostics };
  }
  if (r1Reads.length !== r2Reads.length) {
    throw new Error(`Paired FASTQ files contain different record counts (${r1Reads.length} R1 vs ${r2Reads.length} R2).`);
  }

  const contexts = targetContexts(genes, options.windowSize);
  const output: FastqRead[] = [];
  for (let i = 0; i < r1Reads.length; i++) {
    const r1 = r1Reads[i];
    const r2rc = reverseComplementRead(r2Reads[i]);
    validatePair(r1, r2Reads[i], i);

    const normalized = normalizeIlluminaPairByOverlap(
      r1,
      r2rc,
      options.windowSize,
      options.minOverlapBases,
      options.minOverlapIdentity,
    );
    const normalizedEvaluation = evaluateMate(normalized.read, contexts, options);

    if (normalizedEvaluation.passes.length > 0) {
      output.push(normalized.read);
      if (normalized.merged) stats.consensusMolecules++;
      else stats.paddedMolecules++;
    } else {
      const r1Evaluation = evaluateMate(r1, contexts, options);
      const r2Evaluation = evaluateMate(r2rc, contexts, options);
      stats.filteredMolecules++;
      const reason = normalizedEvaluation.failureReason;
      diagnostics.filteredMolecules.push({
        recordNumber: i + 1,
        readId: r1.id || r2Reads[i].id || `read_${i + 1}`,
        reason,
        r1Reason: r1Evaluation.failureReason,
        r2Reason: r2Evaluation.failureReason,
      });
      diagnostics.reasonCounts[reason]++;
    }
  }

  stats.normalizedMolecules = output.length;
  return { reads: output, stats, diagnostics };
}
