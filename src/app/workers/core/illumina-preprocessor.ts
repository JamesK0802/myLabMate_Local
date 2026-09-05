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
import { SequenceMatcher } from './sequence-matcher';

export interface IlluminaPreprocessOptions {
  windowSize: number;
  phredThreshold: number;
  marginThreshold?: number;
  cutSiteDistanceWeight?: number;
  cutSiteExclusionFlank?: number;
}

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
 * Pick the target window used only as the paired-consensus coordinate system.
 * Gene assignment still happens later in the shared multi-reference pipeline.
 * A low-margin gene or target choice deliberately returns null so the pair is
 * preserved with an X guard instead of being merged against an arbitrary window.
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
          10,
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

function orientedRead(read: FastqRead, pass: MatePass): FastqRead {
  return pass.result.is_rc ? reverseComplementRead(read) : read;
}

function mergeByTargetCoordinates(r1: FastqRead, p1: MatePass, r2: FastqRead, p2: MatePass): FastqRead {
  const a = orientedRead(r1, p1);
  const b = orientedRead(r2, p2);
  const aObservedStart = a.seq.toUpperCase().indexOf(p1.result.observed_read.toUpperCase());
  const bObservedStart = b.seq.toUpperCase().indexOf(p2.result.observed_read.toUpperCase());

  if (aObservedStart < 0 || bObservedStart < 0) {
    throw new Error('Unable to align paired reads to their validated target window.');
  }

  // Both origins represent reference-window coordinate zero. Trim the earlier
  // mate to that shared target-relative start, then align the remaining
  // sequences so an indel in either mate does not shift all later bases.
  const aOrigin = aObservedStart - p1.result.left_x;
  const bOrigin = bObservedStart - p2.result.left_x;
  const aStartCoordinate = -aOrigin;
  const bStartCoordinate = -bOrigin;
  const sharedStart = Math.max(aStartCoordinate, bStartCoordinate);
  const aAlignStart = sharedStart - aStartCoordinate;
  const bAlignStart = sharedStart - bStartCoordinate;
  const sequence: string[] = [];
  const quality: number[] = [];

  if (aStartCoordinate < bStartCoordinate) {
    sequence.push(...a.seq.slice(0, aAlignStart).toUpperCase());
    quality.push(...a.qual.slice(0, aAlignStart));
  } else if (bStartCoordinate < aStartCoordinate) {
    sequence.push(...b.seq.slice(0, bAlignStart).toUpperCase());
    quality.push(...b.qual.slice(0, bAlignStart));
  }

  const aSeq = a.seq.slice(aAlignStart).toUpperCase();
  const bSeq = b.seq.slice(bAlignStart).toUpperCase();
  const aQual = a.qual.slice(aAlignStart);
  const bQual = b.qual.slice(bAlignStart);
  const matcher = new SequenceMatcher(null, aSeq, bSeq);

  const appendPreferred = (baseA: string, qa: number, baseB: string, qb: number) => {
    if (baseA === baseB) {
      sequence.push(baseA);
      quality.push(Math.max(qa, qb));
    } else if (qb > qa) {
      sequence.push(baseB);
      quality.push(qb);
    } else {
      sequence.push(baseA);
      quality.push(qa);
    }
  };

  for (const [tag, i1, i2, j1, j2] of matcher.getOpcodes()) {
    if (tag === 'equal') {
      for (let offset = 0; offset < i2 - i1; offset++) {
        appendPreferred(aSeq[i1 + offset], aQual[i1 + offset] ?? 0, bSeq[j1 + offset], bQual[j1 + offset] ?? 0);
      }
    } else if (tag === 'replace') {
      const shared = Math.min(i2 - i1, j2 - j1);
      for (let offset = 0; offset < shared; offset++) {
        appendPreferred(aSeq[i1 + offset], aQual[i1 + offset] ?? 0, bSeq[j1 + offset], bQual[j1 + offset] ?? 0);
      }
      for (let ai = i1 + shared; ai < i2; ai++) {
        sequence.push(aSeq[ai]);
        quality.push(aQual[ai] ?? 0);
      }
      for (let bi = j1 + shared; bi < j2; bi++) {
        sequence.push(bSeq[bi]);
        quality.push(bQual[bi] ?? 0);
      }
    } else if (tag === 'delete') {
      sequence.push(...aSeq.slice(i1, i2));
      quality.push(...aQual.slice(i1, i2));
    } else if (tag === 'insert') {
      sequence.push(...bSeq.slice(j1, j2));
      quality.push(...bQual.slice(j1, j2));
    }
  }

  return { id: r1.id || r2.id, seq: sequence.join(''), qual: quality };
}

function validatePair(r1: FastqRead, r2: FastqRead, index: number): void {
  const id1 = normalizeFastqReadId(r1.id || '');
  const id2 = normalizeFastqReadId(r2.id || '');
  if (id1 && id2 && id1 !== id2) {
    throw new Error(`Paired FASTQ record mismatch at record ${index + 1}: "${r1.id}" does not match "${r2.id}".`);
  }
}

/** Build the stage-1 representation before any target/window decision. */
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

  const paddingLength = Math.max(1, windowSize);
  const padding = 'X'.repeat(paddingLength);
  const paddingQuality = new Array(paddingLength).fill(0);
  return r1Reads.map((r1, index) => {
    validatePair(r1, r2Reads[index], index);
    const r2rc = reverseComplementRead(r2Reads[index]);
    return {
      id: r1.id || r2Reads[index].id,
      seq: `${r1.seq.toUpperCase()}${padding}${r2rc.seq.toUpperCase()}`,
      qual: [...r1.qual, ...paddingQuality, ...r2rc.qual],
    };
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
  const padding = 'X'.repeat(Math.max(1, options.windowSize));
  const paddingQuality = new Array(padding.length).fill(0);

  for (let i = 0; i < r1Reads.length; i++) {
    const r1 = r1Reads[i];
    const r2rc = reverseComplementRead(r2Reads[i]);
    validatePair(r1, r2Reads[i], i);

    const r1Evaluation = evaluateMate(r1, contexts, options);
    const r2Evaluation = evaluateMate(r2rc, contexts, options);
    const r1Passes = r1Evaluation.passes;
    const r2Passes = r2Evaluation.passes;
    const r1ByKey = new Map(r1Passes.map(pass => [pass.context.key, pass]));
    const r2ByKey = new Map(r2Passes.map(pass => [pass.context.key, pass]));
    const evidence: IlluminaWindowEvidence[] = contexts
      .filter(context => r1ByKey.has(context.key) || r2ByKey.has(context.key))
      .map(context => ({
        key: context.key,
        gene: context.gene,
        targetId: context.targetId,
        r1Score: r1ByKey.get(context.key)?.score ?? null,
        r2Score: r2ByKey.get(context.key)?.score ?? null,
      }));
    const selected = selectIlluminaConsensusEvidence(evidence, options.marginThreshold ?? 0.05);
    const selectedR1 = selected ? r1ByKey.get(selected.key) : undefined;
    const selectedR2 = selected ? r2ByKey.get(selected.key) : undefined;

    if (selectedR1 && selectedR2) {
      output.push(mergeByTargetCoordinates(r1, selectedR1, r2rc, selectedR2));
      stats.consensusMolecules++;
    } else if (r1Passes.length > 0 || r2Passes.length > 0) {
      output.push({
        id: r1.id || r2Reads[i].id,
        seq: `${r1.seq.toUpperCase()}${padding}${r2rc.seq.toUpperCase()}`,
        qual: [...r1.qual, ...paddingQuality, ...r2rc.qual],
      });
      stats.paddedMolecules++;
    } else {
      stats.filteredMolecules++;
      const reason = primaryFailureReason([r1Evaluation.failureReason, r2Evaluation.failureReason]);
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
