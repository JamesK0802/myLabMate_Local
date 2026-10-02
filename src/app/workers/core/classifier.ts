/**
 * classifier.ts — X-Padding Classification Core for CRISPR Analysis.
 *
 * 1:1 TypeScript port of backend/core/classifier.py.
 *
 * Pipeline:
 * 1. gRNA-based coordinate alignment between read and reference window.
 * 2. Cut-site ±15bp coverage gate (minimum requirement).
 * 3. Anchor search for precise inner-region extraction (indel detection).
 * 4. X-padding for unobserved terminal positions.
 * 5. X-aware anchor comparison (skip X, exact on observed).
 * 6. X-aware alignment scoring for gene classification.
 *
 * Core principle:
 *   Observed bases are evidence.
 *   X bases are unknown separators and ignored regardless of origin.
 *   Cut-site ±15bp must be present for analysis.
 */

import { SequenceMatcher } from './sequence-matcher';
import type { QualityScores } from './fastq-parser';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CUT_SITE_MIN_FLANK = 15;
const ANCHOR_LEN = 12;
// PCR primer sequence can replace the genomic bases at an amplicon boundary.
// When a terminal anchor is absent, scan inward for the nearest exact anchor
// and treat only the skipped terminal bases as unobserved. The cap prevents a
// read from discarding an arbitrarily large, potentially diagnostic region.
const MAX_TERMINAL_ANCHOR_INSET = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Type Helpers & Basic Utilities
// ─────────────────────────────────────────────────────────────────────────────

function toStr(seq: string | Uint8Array): string {
  if (typeof seq === 'string') return seq;
  return new TextDecoder().decode(seq);
}

const COMP: Record<string, string> = {
  A: 'T', T: 'A', G: 'C', C: 'G', N: 'N', X: 'X',
  a: 't', t: 'a', g: 'c', c: 'g', n: 'n', x: 'x',
};

export function reverseComplement(seq: string): string {
  const s = toStr(seq).toUpperCase();
  let result = '';
  for (let i = s.length - 1; i >= 0; i--) {
    result += COMP[s[i]] || 'N';
  }
  return result;
}

export function avgPhred(qual: QualityScores | null): number {
  if (!qual || qual.length === 0) return 40.0;
  let sum = 0;
  for (let i = 0; i < qual.length; i++) sum += qual[i];
  return sum / qual.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference Optimization
// ─────────────────────────────────────────────────────────────────────────────

export interface CutSiteInfo {
  strand: string;
  grna_start: number;
  grna_end: number;
  cut_site: number;
  pam: string;
  pam_found: boolean;
}

export function findGrnaCutSite(reference: string, grna: string): CutSiteInfo {
  const refUp = toStr(reference).toUpperCase();
  const grnaUp = toStr(grna).toUpperCase();
  const grnaRc = reverseComplement(grnaUp);
  const refLen = refUp.length;
  const grnaLen = grnaUp.length;

  if (grnaLen === 0) {
    return { strand: 'unknown', grna_start: -1, grna_end: -1, cut_site: Math.floor(refLen / 2), pam: 'N/A', pam_found: false };
  }

  // Forward: gRNA + [NGG]
  for (let pos = 0; pos < refLen - grnaLen; pos++) {
    if (refUp.substring(pos, pos + grnaLen) === grnaUp) {
      const ps = pos + grnaLen;
      if (ps + 3 <= refLen) {
        const pam = refUp.substring(ps, ps + 3);
        if (pam[1] === 'G' && pam[2] === 'G') {
          return { strand: 'forward', grna_start: pos, grna_end: pos + grnaLen, cut_site: pos + grnaLen - 3, pam, pam_found: true };
        }
      }
    }
  }

  // Reverse: [CCN] + gRNA_RC
  for (let pos = 0; pos < refLen - grnaRc.length; pos++) {
    if (refUp.substring(pos, pos + grnaRc.length) === grnaRc) {
      const pe = pos;
      const ps2 = pe - 3;
      if (ps2 >= 0) {
        const pam = refUp.substring(ps2, pe);
        if (pam[0] === 'C' && pam[1] === 'C') {
          return { strand: 'reverse', grna_start: pos, grna_end: pos + grnaRc.length, cut_site: pos + 3, pam, pam_found: true };
        }
      }
    }
  }

  // Fallback
  let idx = refUp.indexOf(grnaUp);
  if (idx !== -1) {
    return { strand: 'forward', grna_start: idx, grna_end: idx + grnaLen, cut_site: idx + grnaLen - 3, pam: 'NOT_FOUND', pam_found: false };
  }
  idx = refUp.indexOf(grnaRc);
  if (idx !== -1) {
    return { strand: 'reverse', grna_start: idx, grna_end: idx + grnaRc.length, cut_site: idx + 3, pam: 'NOT_FOUND', pam_found: false };
  }

  return { strand: 'unknown', grna_start: -1, grna_end: -1, cut_site: Math.floor(refLen / 2), pam: 'N/A', pam_found: false };
}

export function getWindowBounds(reference: string, cutSite: number, windowSize: number, leftSize?: number, rightSize?: number): [number, number] {
  if (leftSize !== undefined && rightSize !== undefined) {
    const start = Math.max(0, cutSite - Math.max(0, leftSize));
    const end = Math.min(reference.length, cutSite + Math.max(0, rightSize));
    return [start, end];
  }
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, cutSite - half);
  const end = Math.min(reference.length, cutSite + half);
  return [start, end];
}

export function cutIndexInWindow(reference: string, cutSite: number, windowSize: number, leftSize?: number, rightSize?: number): number {
  const [start] = getWindowBounds(reference, cutSite, windowSize, leftSize, rightSize);
  return Math.max(0, cutSite - start);
}

export function extractWindow(reference: string, cutSite: number, windowSize: number, leftSize?: number, rightSize?: number): string {
  const [start, end] = getWindowBounds(reference, cutSite, windowSize, leftSize, rightSize);
  return reference.substring(start, end);
}

// ─────────────────────────────────────────────────────────────────────────────
// X-Padding Pipeline
// ─────────────────────────────────────────────────────────────────────────────

function buildSeedPositionIndex(seqUp: string): Map<string, number[]> {
  const positionsBySeed = new Map<string, number[]>();
  for (let pos = 0; pos <= seqUp.length - ANCHOR_LEN; pos++) {
    const seed = seqUp.substring(pos, pos + ANCHOR_LEN);
    if (seed.includes('N') || seed.includes('X')) continue;
    const positions = positionsBySeed.get(seed);
    if (positions) positions.push(pos);
    else positionsBySeed.set(seed, [pos]);
  }
  return positionsBySeed;
}

function findOffset(seqUp: string, refUp: string, sgrnaSeq: string): number | null {
  if (sgrnaSeq) {
    const sgrnaUp = sgrnaSeq.toUpperCase();
    const sgrnaRc = reverseComplement(sgrnaUp);
    for (const search of [sgrnaUp, sgrnaRc]) {
      const ri = seqUp.indexOf(search);
      if (ri === -1) continue;
      const rr = refUp.indexOf(search);
      if (rr === -1) continue;
      return ri - rr;
    }
  }

  // Left anchor fallback
  const leftAnchor = refUp.substring(0, ANCHOR_LEN);
  const li = seqUp.indexOf(leftAnchor);
  if (li !== -1) return li;

  // Right anchor fallback
  const rightAnchor = refUp.substring(refUp.length - ANCHOR_LEN);
  const ri2 = seqUp.indexOf(rightAnchor);
  if (ri2 !== -1) return ri2 - (refUp.length - ANCHOR_LEN);

  // Edited gRNAs and primer-overwritten window ends can remove all three
  // preferred seeds. Recover the coordinate from the most consistently
  // observed internal 12-mers instead of declaring the read unalignable.
  const readSeedPositions = buildSeedPositionIndex(seqUp);
  const offsetVotes = new Map<number, number>();
  for (let refPos = 1; refPos <= refUp.length - ANCHOR_LEN - 1; refPos++) {
    const seed = refUp.substring(refPos, refPos + ANCHOR_LEN);
    if (seed.includes('N') || seed.includes('X')) continue;
    for (const readPos of readSeedPositions.get(seed) || []) {
      const candidateOffset = readPos - refPos;
      offsetVotes.set(candidateOffset, (offsetVotes.get(candidateOffset) || 0) + 1);
    }
  }
  const bestOffset = [...offsetVotes.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0];
  if (bestOffset && bestOffset[1] >= 2) return bestOffset[0];

  return null;
}

interface AlignResult {
  fail: string | null;
  observed_read?: string;
  read_window?: string;
  qual_observed?: QualityScores | null;
  left_x?: number;
  right_x?: number;
}

interface AnchorHit {
  read_pos: number;
  ref_pos: number;
}

function anchorHits(refUp: string, refPositions: number[], readSeedPositions: Map<string, number[]>): AnchorHit[] {
  const hits: AnchorHit[] = [];
  const seen = new Set<string>();
  for (const refPos of refPositions) {
    const anchor = refUp.substring(refPos, refPos + ANCHOR_LEN);
    if (anchor.length !== ANCHOR_LEN || anchor.includes('N') || anchor.includes('X')) continue;
    for (const readPos of readSeedPositions.get(anchor) || []) {
      const key = `${readPos}:${refPos}`;
      if (!seen.has(key)) {
        hits.push({ read_pos: readPos, ref_pos: refPos });
        seen.add(key);
      }
    }
  }
  return hits;
}

function alignReadToWindow(
  seq: string,
  qual: QualityScores | null,
  refWindow: string,
  cutIdxInWindow: number,
  sgrnaSeq: string
): AlignResult {
  const seqUp = seq.toUpperCase();
  const refUp = refWindow.toUpperCase();
  const winLen = refWindow.length;

  // Step 1: Find coordinate offset
  const offset = findOffset(seqUp, refUp, sgrnaSeq);
  if (offset === null) return { fail: 'no_alignment' };

  // Step 2: Cut-site ±15bp coverage gate
  const cutInRead = offset + cutIdxInWindow;
  if (cutInRead - CUT_SITE_MIN_FLANK < 0 || cutInRead + CUT_SITE_MIN_FLANK > seq.length) {
    return { fail: 'no_coverage' };
  }

  // Step 3: Find terminal anchors and, if needed, exact inset anchors. Inset
  // anchors make primer-overwritten terminal bases equivalent to X padding;
  // the observed internal sequence remains mandatory evidence.
  const leftAnchor = refUp.substring(0, ANCHOR_LEN);
  const rightAnchor = refUp.substring(refUp.length - ANCHOR_LEN);

  // Find all anchor positions
  const leftPositions: number[] = [];
  let idx = seqUp.indexOf(leftAnchor);
  while (idx !== -1) {
    leftPositions.push(idx);
    idx = seqUp.indexOf(leftAnchor, idx + 1);
  }

  const rightPositions: number[] = [];
  idx = seqUp.indexOf(rightAnchor);
  while (idx !== -1) {
    rightPositions.push(idx);
    idx = seqUp.indexOf(rightAnchor, idx + 1);
  }

  const maxLeftInset = Math.min(
    MAX_TERMINAL_ANCHOR_INSET,
    Math.max(0, cutIdxInWindow - CUT_SITE_MIN_FLANK - ANCHOR_LEN),
  );
  const maxRightInset = Math.min(
    MAX_TERMINAL_ANCHOR_INSET,
    Math.max(0, winLen - ANCHOR_LEN - (cutIdxInWindow + CUT_SITE_MIN_FLANK)),
  );
  const leftRefPositions = Array.from({ length: maxLeftInset + 1 }, (_, i) => i);
  const rightRefPositions = Array.from(
    { length: maxRightInset + 1 },
    (_, i) => winLen - ANCHOR_LEN - i,
  );
  const readSeedPositions = buildSeedPositionIndex(seqUp);
  const leftHits = anchorHits(refUp, leftRefPositions, readSeedPositions);
  const rightHits = anchorHits(refUp, rightRefPositions, readSeedPositions);

  // Find best anchor pair
  let bestLeftHit: AnchorHit | null = null;
  let bestRightHit: AnchorHit | null = null;
  let bestDiff = Infinity;
  let bestTerminalSkip = Infinity;

  // Preserve the original path whenever both true terminal anchors exist.
  // Never prefer inner anchors merely because they avoid a real cut-site
  // indel, since that would erase useful assignment evidence.
  const refInnerLen = winLen - 2 * ANCHOR_LEN;
  for (const leftPos of leftPositions) {
    for (const rightPos of rightPositions) {
      if (rightPos >= leftPos + ANCHOR_LEN) {
        const observedInnerLen = rightPos - leftPos - ANCHOR_LEN;
        const diff = Math.abs(observedInnerLen - refInnerLen);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestTerminalSkip = 0;
          bestLeftHit = { read_pos: leftPos, ref_pos: 0 };
          bestRightHit = { read_pos: rightPos, ref_pos: winLen - ANCHOR_LEN };
        }
      }
    }
  }

  // Adaptive clipping is preferred with at least one true terminal anchor.
  // If both PCR primers overwrite genomic ends, two inset anchors are also
  // accepted when they retain a substantial internal span. Final homoeolog
  // assignment then relies on observed diagnostic bases, so a primer sequence
  // cannot make only the coincidentally matching reference eligible.
  if (!bestLeftHit || !bestRightHit) for (const leftHit of leftHits) {
    for (const rightHit of rightHits) {
      const hasTerminalEvidence = leftHit.ref_pos === 0 || rightHit.ref_pos === winLen - ANCHOR_LEN;
      const grnaUp = sgrnaSeq.toUpperCase();
      const hasExactGrnaSeed = !!grnaUp && (seqUp.includes(grnaUp) || seqUp.includes(reverseComplement(grnaUp)));
      const retainedReferenceSpan = rightHit.ref_pos + ANCHOR_LEN - leftHit.ref_pos;
      const hasStrongInternalSpan = retainedReferenceSpan >= Math.max(60, CUT_SITE_MIN_FLANK * 2 + ANCHOR_LEN);
      if ((hasTerminalEvidence || hasExactGrnaSeed || hasStrongInternalSpan) && rightHit.read_pos >= leftHit.read_pos + ANCHOR_LEN && rightHit.ref_pos >= leftHit.ref_pos + ANCHOR_LEN) {
        const observedInnerLen = rightHit.read_pos - leftHit.read_pos - ANCHOR_LEN;
        const referenceInnerLen = rightHit.ref_pos - leftHit.ref_pos - ANCHOR_LEN;
        const diff = Math.abs(observedInnerLen - referenceInnerLen);
        const terminalSkip = leftHit.ref_pos + (winLen - rightHit.ref_pos - ANCHOR_LEN);
        if (diff < bestDiff || (diff === bestDiff && terminalSkip < bestTerminalSkip)) {
          bestDiff = diff;
          bestTerminalSkip = terminalSkip;
          bestLeftHit = leftHit;
          bestRightHit = rightHit;
        }
      }
    }
  }

  // Step 4: Build observed_read + read_window
  let observedRead: string;
  let readWindow: string;
  let leftX: number;
  let rightX: number;
  let qualObserved: QualityScores | null;

  if (bestLeftHit && bestRightHit) {
    // CASE A: Both terminal or inset anchors found. Bases outside inset
    // anchors are deliberately represented as X instead of being interpreted
    // as genomic mismatches introduced by PCR primers.
    observedRead = seq.substring(bestLeftHit.read_pos, bestRightHit.read_pos + ANCHOR_LEN).toUpperCase();
    leftX = bestLeftHit.ref_pos;
    rightX = winLen - bestRightHit.ref_pos - ANCHOR_LEN;
    readWindow = 'X'.repeat(leftX) + observedRead + 'X'.repeat(rightX);
    qualObserved = qual ? qual.slice(bestLeftHit.read_pos, bestRightHit.read_pos + ANCHOR_LEN) : null;

  } else if (leftPositions.length > 0) {
    // CASE B: Left anchor found, right truncated
    const bestLeft = leftPositions.reduce((best, x) => Math.abs(x - offset) < Math.abs(best - offset) ? x : best);
    observedRead = seq.substring(bestLeft).toUpperCase();
    leftX = 0;
    rightX = Math.max(0, bestLeft + winLen - seq.length);
    readWindow = observedRead + 'X'.repeat(rightX);
    qualObserved = qual ? qual.slice(bestLeft) : null;

  } else if (rightPositions.length > 0) {
    // CASE C: Right anchor found, left truncated
    const bestRight = rightPositions.reduce((best, x) =>
      Math.abs(x - (offset + winLen - ANCHOR_LEN)) < Math.abs(best - (offset + winLen - ANCHOR_LEN)) ? x : best
    );
    const endPos = bestRight + ANCHOR_LEN;
    const winStart = bestRight - (winLen - ANCHOR_LEN);
    const actualStart = Math.max(0, winStart);
    observedRead = seq.substring(actualStart, endPos).toUpperCase();
    leftX = Math.max(0, -winStart);
    rightX = 0;
    readWindow = 'X'.repeat(leftX) + observedRead;
    qualObserved = qual ? qual.slice(actualStart, endPos) : null;

  } else {
    // CASE D: No anchors found — offset-based extraction
    const rwStart = offset;
    const rwEnd = offset + winLen;
    leftX = Math.max(0, -rwStart);
    rightX = Math.max(0, rwEnd - seq.length);
    const actualStart = Math.max(0, rwStart);
    const actualEnd = Math.min(seq.length, rwEnd);
    observedRead = seq.substring(actualStart, actualEnd).toUpperCase();
    readWindow = 'X'.repeat(leftX) + observedRead + 'X'.repeat(rightX);
    qualObserved = qual ? qual.slice(actualStart, actualEnd) : null;
  }

  return {
    fail: null,
    observed_read: observedRead,
    read_window: readWindow,
    qual_observed: qualObserved,
    left_x: leftX,
    right_x: rightX,
  };
}

function xawareAnchorCheck(readWindow: string, refWindow: string): boolean {
  const rw = readWindow.toUpperCase();
  const rf = refWindow.toUpperCase();
  const wl = Math.min(rw.length, rf.length);

  // Left anchor
  for (let i = 0; i < Math.min(ANCHOR_LEN, wl); i++) {
    if (rw[i] === 'X') continue;
    if (rw[i] !== rf[i]) return false;
  }

  // Right anchor
  for (let i = 1; i <= Math.min(ANCHOR_LEN, wl); i++) {
    if (rw[rw.length - i] === 'X') continue;
    if (rw[rw.length - i] !== rf[rf.length - i]) return false;
  }

  return true;
}

/** X is an unobserved separator, never nucleotide evidence. */
function observedSegments(
  seq: string,
  qual: QualityScores | null,
): Array<{ seq: string; qual: QualityScores | null }> {
  const segments: Array<{ seq: string; qual: QualityScores | null }> = [];
  const seqUp = seq.toUpperCase();
  const matcher = /[^X]+/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(seqUp)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    segments.push({
      seq: match[0],
      qual: qual ? Array.from(qual).slice(start, end) : null,
    });
  }
  return segments;
}

// ─────────────────────────────────────────────────────────────────────────────
// Usability Filter
// ─────────────────────────────────────────────────────────────────────────────

// Map-based memoization (replaces Python's lru_cache)
const usabilityCache = new Map<string, [boolean, string, ReadResult | null]>();
const diagnosticPositionsCache = new Map<string, number[]>();

export interface ReadResult {
  fail: null;
  observed_read: string;
  read_window: string;
  qual_observed: QualityScores | null;
  left_x: number;
  right_x: number;
  is_rc: boolean;
}

function isReadUsableCached(
  seq: string,
  qualTuple: QualityScores | null,
  refWindow: string,
  phredThreshold: number,
  sgrnaSeq: string,
  cutIdxInWindow: number
): [boolean, string, ReadResult | null] {
  const winLen = refWindow.length;
  if (cutIdxInWindow < 0) cutIdxInWindow = Math.floor(winLen / 2);

  const candidates: Array<{ res: AlignResult; isRc: boolean }> = [];
  const failReasons = new Set<string>();

  // Evaluate each contiguous observed segment independently. This makes an
  // Illumina inter-mate X guard equivalent to terminal X padding: X never
  // supplies coverage, anchor, quality, scoring, or mutation evidence.
  for (const segment of observedSegments(seq, qualTuple)) {
    const fwRes = alignReadToWindow(segment.seq, segment.qual, refWindow, cutIdxInWindow, sgrnaSeq);
    const rcSeq = reverseComplement(segment.seq);
    const rcQual = segment.qual ? Array.from(segment.qual).reverse() : null;
    const rcRes = alignReadToWindow(rcSeq, rcQual, refWindow, cutIdxInWindow, sgrnaSeq);

    for (const [res, isRc] of [[fwRes, false], [rcRes, true]] as [AlignResult, boolean][]) {
      if (res.fail !== null) {
        failReasons.add(res.fail);
        continue;
      }

      if (!xawareAnchorCheck(res.read_window!, refWindow)) {
        failReasons.add('no_anchor');
        continue;
      }

      if (res.qual_observed) {
        const observedQuals = Array.from(res.qual_observed);
        if (observedQuals.length > 0) {
          const avgQ = observedQuals.reduce((sum, value) => sum + value, 0) / observedQuals.length;
          if (avgQ < phredThreshold) {
            failReasons.add('quality');
            continue;
          }
        }
      }

      candidates.push({ res, isRc });
    }
  }

  if (candidates.length === 0) {
    let reason: string;
    if (failReasons.has('quality')) reason = 'quality';
    else if (failReasons.has('no_anchor')) reason = 'no_anchor';
    else if (failReasons.has('no_coverage')) reason = 'no_coverage';
    else reason = 'no_alignment';
    return [false, reason, null];
  }

  // Prefer the candidate with least missing sequence, then most observed bases.
  const best = candidates.reduce((a, b) => {
    const aMissing = a.res.left_x! + a.res.right_x!;
    const bMissing = b.res.left_x! + b.res.right_x!;
    if (aMissing !== bMissing) return aMissing < bMissing ? a : b;
    return a.res.observed_read!.length >= b.res.observed_read!.length ? a : b;
  });

  const result: ReadResult = {
    fail: null,
    observed_read: best.res.observed_read!,
    read_window: best.res.read_window!,
    qual_observed: best.res.qual_observed || null,
    left_x: best.res.left_x!,
    right_x: best.res.right_x!,
    is_rc: best.isRc,
  };

  return [true, 'ok', result];
}

export function isReadUsable(
  seq: string,
  qual: QualityScores | null,
  refWindow: string,
  phredThreshold: number,
  sgrnaSeq: string = '',
  cutIdxInWin: number = -1
): [boolean, string, ReadResult | null] {
  // Use cache for repeated reads
  const cacheKey = `${seq}|${refWindow}|${phredThreshold}|${sgrnaSeq}|${cutIdxInWin}`;
  const cached = usabilityCache.get(cacheKey);
  if (cached) return [cached[0], cached[1], cached[2] ? { ...cached[2] } : null];

  const result = isReadUsableCached(seq, qual, refWindow, phredThreshold, sgrnaSeq, cutIdxInWin);
  // Only cache if the map isn't too large (prevents memory issues)
  // A cache entry retains the full read sequence. A large limit turns a
  // multi-file run into an accidental in-memory FASTQ copy, especially on
  // Safari. This still captures common duplicate reads without risking a tab
  // reload.
  if (usabilityCache.size < 8192) {
    usabilityCache.set(cacheKey, result);
  }
  return [result[0], result[1], result[2] ? { ...result[2] } : null];
}

/** Illumina preprocessing needs each mate's own quality array, not the shared
 * Nanopore memoized result for another read with the same sequence. */
export function isReadUsableUncached(
  seq: string,
  qual: QualityScores | null,
  refWindow: string,
  phredThreshold: number,
  sgrnaSeq: string = '',
  cutIdxInWin: number = -1
): [boolean, string, ReadResult | null] {
  return isReadUsableCached(seq, qual, refWindow, phredThreshold, sgrnaSeq, cutIdxInWin);
}

export function clearClassifierCache(): void {
  usabilityCache.clear();
  diagnosticPositionsCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring (X-aware with optional Cut-Site Distance Weighting)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Scoring (X-aware with optional Cut-Site Distance Weighting & Exclusion Flank)
// ─────────────────────────────────────────────────────────────────────────────

function calcSeagullWeight(d: number, maxDist: number, distanceWeight: number): number {
  if (distanceWeight <= 0.0) return 1.0;
  // Seagull / Sigmoidal S-curve centered around d = 10 bp
  // Rises steeply between d = 5 to d = 15 bp, then saturates
  const s0 = 1.0 / (1.0 + Math.exp(-0.35 * (-10)));
  const sMax = 1.0 / (1.0 + Math.exp(-0.35 * (maxDist - 10)));
  const sD = 1.0 / (1.0 + Math.exp(-0.35 * (d - 10)));
  const normSig = Math.max(0.0, Math.min(1.0, (sD - s0) / (sMax - s0)));
  return 1.0 + (distanceWeight * normSig);
}

function computeAlignmentScoreWithDynamicExclusion(
  strand: string,
  refUp: string,
  cutSitePos: number,
  maxDist: number,
  distanceWeight: number,
  exclusionFlank: number
): number {
  const cleanStrand = strand;
  const cleanRef = refUp.replace(/X/g, '');
  if (!cleanStrand || !cleanRef) return 0.0;

  const sm = new SequenceMatcher(null, cleanStrand, cleanRef);
  const opcodes = sm.getOpcodes();
  const excludedRefIndices = new Set<number>();

  // 1. User-configured cut-site exclusion flank (disabled when set to 0)
  if (exclusionFlank > 0 && cutSitePos >= 0) {
    const sStart = Math.max(0, cutSitePos - exclusionFlank);
    const sEnd = Math.min(cleanRef.length - 1, cutSitePos + exclusionFlank);
    for (let r = sStart; r <= sEnd; r++) {
      excludedRefIndices.add(r);
    }
  }

  // 2. Expand the configured exclusion to the full span of an intersecting
  // indel or substitution. No mutation span is excluded at the default 0 bp.
  if (exclusionFlank > 0 && cutSitePos >= 0) {
    for (const [tag, , , j1, j2] of opcodes) {
      if (tag !== 'equal') {
        const nearCutSite = (j1 <= cutSitePos + exclusionFlank && j2 >= cutSitePos - exclusionFlank);
        if (nearCutSite) {
          for (let r = j1; r < j2; r++) {
            excludedRefIndices.add(r);
          }
        }
      }
    }
  }

  let matchedWeight = 0.0;
  let totalMaxWeight = 0.0;

  for (const [tag, i1, i2, j1, j2] of opcodes) {
    if (tag === 'equal') {
      const len = i2 - i1;
      for (let k = 0; k < len; k++) {
        const refIdx = j1 + k;
        if (excludedRefIndices.has(refIdx)) continue;
        const refChar = cleanRef[refIdx];
        if (refChar === 'N') continue;
        const d = Math.abs(refIdx - cutSitePos);
        const w = calcSeagullWeight(d, maxDist, distanceWeight);
        totalMaxWeight += w;
        matchedWeight += w;
      }
    } else if (tag === 'replace' || tag === 'insert') {
      // SequenceMatcher compares read (a) with reference (b). `insert`
      // therefore means reference bases are absent from the read. Penalize
      // the reference span; the previous implementation used the empty read
      // span and accidentally gave deletions a zero cost.
      const refLen = j2 - j1;
      for (let k = 0; k < refLen; k++) {
        const refIdx = j1 + k;
        if (excludedRefIndices.has(refIdx)) continue;
        const refChar = cleanRef[refIdx];
        if (refChar === 'N') continue;
        const d = Math.abs(refIdx - cutSitePos);
        const w = calcSeagullWeight(d, maxDist, distanceWeight);
        totalMaxWeight += w;
      }
      // A replacement can also contain extra read bases beyond the replaced
      // reference span. Count only that excess here; the shared span above is
      // already represented by the reference positions.
      const excessReadBases = Math.max(0, (i2 - i1) - refLen);
      if (excessReadBases > 0 && !excludedRefIndices.has(Math.min(j1, cleanRef.length - 1))) {
        const refIdx = Math.min(j1, cleanRef.length - 1);
        const d = Math.abs(refIdx - cutSitePos);
        totalMaxWeight += calcSeagullWeight(d, maxDist, distanceWeight) * excessReadBases;
      }
    } else if (tag === 'delete') {
      // `delete` means extra bases exist in the read at reference coordinate
      // j1. Penalize the read span unless that coordinate is excluded.
      const refIdx = j1;
      const boundedRefIdx = Math.max(0, Math.min(refIdx, cleanRef.length - 1));
      if (!excludedRefIndices.has(boundedRefIdx)) {
        const d = Math.abs(boundedRefIdx - cutSitePos);
        const w = calcSeagullWeight(d, maxDist, distanceWeight);
        totalMaxWeight += w * (i2 - i1);
      }
    }
  }

  return totalMaxWeight > 0.0 ? (matchedWeight / totalMaxWeight) : 0.0;
}

export function scoreReadAgainstWindow(
  read: string,
  refWindow: string,
  cutIndexInWindow: number = -1,
  distanceWeight: number = 0.0,
  exclusionFlank: number = 0
): number {
  let readUp = toStr(read).toUpperCase();
  let refUp = toStr(refWindow).toUpperCase();
  if (!readUp || !refUp) return 0.0;

  // Terminal X padding denotes bases outside read coverage. Remove the same
  // coordinates from the reference so unobserved bases neither help nor hurt
  // assignment. Real substitutions and indels remain in the alignment.
  let adjustedCutIndex = cutIndexInWindow;
  if (readUp.length === refUp.length) {
    const leadingX = readUp.match(/^X+/)?.[0].length || 0;
    const trailingX = readUp.match(/X+$/)?.[0].length || 0;
    const end = Math.max(leadingX, readUp.length - trailingX);
    readUp = readUp.slice(leadingX, end);
    refUp = refUp.slice(leadingX, end);
    if (adjustedCutIndex >= 0) adjustedCutIndex -= leadingX;
  }

  const cutSitePos = adjustedCutIndex >= 0 ? adjustedCutIndex : Math.floor(refUp.length / 2);
  const maxDist = Math.max(cutSitePos, refUp.length - cutSitePos, 1);

  const segments = readUp.split(/X+/).filter(Boolean);
  if (!segments.length) return 0.0;

  const rcRefUp = reverseComplement(refUp);
  const rcCutSitePos = refUp.length - 1 - cutSitePos;
  const rcMaxDist = Math.max(rcCutSitePos, rcRefUp.length - rcCutSitePos, 1);
  let bestScore = 0.0;
  for (const segment of segments) {
    const fwScore = computeAlignmentScoreWithDynamicExclusion(segment, refUp, cutSitePos, maxDist, distanceWeight, exclusionFlank);
    const rcScore = computeAlignmentScoreWithDynamicExclusion(reverseComplement(segment), rcRefUp, rcCutSitePos, rcMaxDist, distanceWeight, exclusionFlank);
    bestScore = Math.max(bestScore, fwScore, rcScore);
  }

  return Math.min(1.0, bestScore);
}

interface DiagnosticEvidenceScore {
  score: number;
  observed: number;
  total: number;
}

/**
 * Score only coordinates that distinguish members of one homoeolog group.
 * X/missing bases contribute no evidence (rather than a mismatch), while an
 * observed match contributes +1 and an observed mismatch -1. Normalizing by
 * all diagnostic coordinates prevents a candidate from gaining confidence by
 * clipping away the positions that would disprove it.
 */
function scoreDiagnosticEvidence(
  readWindow: string,
  refWindow: string,
  peerWindows: string[],
  cutIndex: number,
  exclusionFlank: number,
): DiagnosticEvidenceScore {
  const readUp = readWindow.toUpperCase();
  const refUp = refWindow.toUpperCase();
  const comparablePeers = peerWindows.map(peer => peer.toUpperCase()).filter(peer => peer.length === refUp.length);
  const diagnosticKey = `${refUp}|${comparablePeers.join('|')}|${cutIndex}|${exclusionFlank}`;
  let diagnosticPositions = diagnosticPositionsCache.get(diagnosticKey);
  if (!diagnosticPositions) {
    diagnosticPositions = [];
    for (let pos = 0; pos < refUp.length; pos++) {
      if (exclusionFlank > 0 && Math.abs(pos - cutIndex) <= exclusionFlank) continue;
      if (comparablePeers.some(peer => peer[pos] !== refUp[pos])) diagnosticPositions.push(pos);
    }
    diagnosticPositionsCache.set(diagnosticKey, diagnosticPositions);
  }
  if (!diagnosticPositions.length) return { score: 0, observed: 0, total: 0 };

  const observedByReference = new Map<number, string>();
  if (readUp.length === refUp.length) {
    for (let pos = 0; pos < refUp.length; pos++) {
      if (readUp[pos] !== 'X' && readUp[pos] !== 'N') observedByReference.set(pos, readUp[pos]);
    }
  } else {
    const matcher = new SequenceMatcher(null, readUp, refUp);
    for (const [tag, i1, i2, j1, j2] of matcher.getOpcodes()) {
      if (tag !== 'equal' && tag !== 'replace') continue;
      const shared = Math.min(i2 - i1, j2 - j1);
      for (let offset = 0; offset < shared; offset++) {
        const base = readUp[i1 + offset];
        if (base !== 'X' && base !== 'N') observedByReference.set(j1 + offset, base);
      }
    }
  }

  let support = 0;
  let observed = 0;
  for (const pos of diagnosticPositions) {
    const base = observedByReference.get(pos);
    if (!base) continue;
    observed++;
    support += base === refUp[pos] ? 1 : -1;
  }
  return {
    score: (support / diagnosticPositions.length + 1) / 2,
    observed,
    total: diagnosticPositions.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassInfo {
  gene: string;
  target: string;
  ref_window: string;
  sgrna_seq?: string;
  cut_index_in_window?: number;
  homoeolog_group?: string;
}

export interface ClassificationResult {
  assigned: boolean;
  reason?: string;
  predicted_gene?: string;
  predicted_target?: string;
  top1_score?: number;
  top2_score?: number;
  gap?: number;
  debug?: any;
}

export function applyClassification(
  readSeq: string,
  readQual: QualityScores | null,
  classes: ClassInfo[],
  phredThreshold: number,
  margin: number,
  cutSiteDistanceWeight: number = 0.0,
  cutSiteExclusionFlank: number = 0
): ClassificationResult {
  const eligibleClasses: Array<{ classInfo: ClassInfo; targetSeq: string }> = [];
  for (const c of classes) {
    const [usable, , res] = isReadUsable(
      readSeq, readQual, c.ref_window, phredThreshold,
      c.sgrna_seq || '', c.cut_index_in_window ?? -1
    );
    if (usable) {
      eligibleClasses.push({ classInfo: c, targetSeq: res?.read_window || readSeq });
    }
  }

  if (eligibleClasses.length === 0) {
    return { assigned: false, reason: 'filtered' };
  }

  const scores: Array<[number, string, string]> = eligibleClasses.map(item => [
    scoreReadAgainstWindow(item.targetSeq, item.classInfo.ref_window, item.classInfo.cut_index_in_window ?? -1, cutSiteDistanceWeight, cutSiteExclusionFlank),
    item.classInfo.gene,
    item.classInfo.target,
  ]);
  scores.sort((a, b) => b[0] - a[0]);

  const [top1Score, top1Gene, top1Target] = scores[0];

  if (classes.length === 1) {
    return {
      assigned: true,
      predicted_gene: top1Gene,
      predicted_target: top1Target,
      top1_score: Math.round(top1Score * 10000) / 10000,
    };
  }

  const top2Score = scores.length > 1 ? scores[1][0] : 0.0;
  const gap = top1Score - top2Score;

  if (gap >= margin) {
    return {
      assigned: true,
      predicted_gene: top1Gene,
      predicted_target: top1Target,
      top1_score: Math.round(top1Score * 10000) / 10000,
      top2_score: Math.round(top2Score * 10000) / 10000,
      gap: Math.round(gap * 10000) / 10000,
    };
  }

  return {
    assigned: false,
    reason: 'ambiguous',
    top1_score: Math.round(top1Score * 10000) / 10000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gene-Level Classification
// ─────────────────────────────────────────────────────────────────────────────

export function applyGeneClassification(
  readSeq: string,
  readQual: QualityScores | null,
  geneClasses: Record<string, ClassInfo[]>,
  phredThreshold: number,
  margin: number,
  cutSiteDistanceWeight: number = 0.0,
  cutSiteExclusionFlank: number = 0
): ClassificationResult {
  const geneNames = Object.keys(geneClasses);

  // Single-gene shortcut
  if (geneNames.length === 1) {
    const geneName = geneNames[0];
    for (const t of geneClasses[geneName]) {
      const [usable] = isReadUsable(
        readSeq, readQual, t.ref_window, phredThreshold,
        t.sgrna_seq || '', t.cut_index_in_window ?? -1
      );
      if (usable) {
        return {
          assigned: true,
          predicted_gene: geneName,
          top1_score: 1.0,
          debug: {
            gene_scores: { [geneName]: { best_score: 1.0, best_target: t.target, usable: 1, total: geneClasses[geneName].length } },
            best_gene: geneName, second_gene: null, gap: null, margin,
            outcome: 'assigned_single_gene',
          },
        };
      }
    }
    return {
      assigned: false, reason: 'filtered',
      debug: {
        gene_scores: { [geneName]: { best_score: null, best_target: null, usable: 0, total: geneClasses[geneName].length } },
        best_gene: null, second_gene: null, gap: null, margin,
        outcome: 'filtered_no_usable_window',
      },
    };
  }

  // Multi-gene: score each gene by its best target window
  const geneScores: Array<[number, string]> = [];
  const geneDebug: Record<string, any> = {};
  let anyUsable = false;

  for (const geneName of geneNames) {
    const targets = geneClasses[geneName];
    let bestScore = -1.0;
    let bestTarget: string | null = null;
    let bestDiagnostic: DiagnosticEvidenceScore | null = null;
    let geneUsable = false;
    let usableCount = 0;

    for (const t of targets) {
      const [usable, , res] = isReadUsable(
        readSeq, readQual, t.ref_window, phredThreshold,
        t.sgrna_seq || '', t.cut_index_in_window ?? -1
      );
      if (usable) {
        geneUsable = true;
        anyUsable = true;
        usableCount++;
        const targetSeq = res?.read_window || readSeq;
        const baseScore = scoreReadAgainstWindow(targetSeq, t.ref_window, t.cut_index_in_window ?? -1, cutSiteDistanceWeight, cutSiteExclusionFlank);
        const peerWindows = t.homoeolog_group
          ? Object.values(geneClasses).flat().filter(peer =>
              peer.gene !== t.gene &&
              peer.target === t.target &&
              peer.homoeolog_group === t.homoeolog_group
            ).map(peer => peer.ref_window)
          : [];
        const diagnostic = scoreDiagnosticEvidence(
          targetSeq,
          t.ref_window,
          peerWindows,
          t.cut_index_in_window ?? Math.floor(t.ref_window.length / 2),
          cutSiteExclusionFlank,
        );
        // In homoeolog mode, diagnostic bases carry the assignment decision;
        // whole-window similarity remains a small deterministic tie-breaker.
        const score = diagnostic.total > 0
          ? diagnostic.score * 0.999 + baseScore * 0.001
          : baseScore;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = t.target;
          bestDiagnostic = diagnostic.total > 0 ? diagnostic : null;
        }
      }
    }

    geneDebug[geneName] = {
      best_score: bestScore >= 0 ? Math.round(bestScore * 10000) / 10000 : null,
      best_target: bestTarget,
      usable: usableCount,
      total: targets.length,
      diagnostic_observed: bestDiagnostic?.observed ?? null,
      diagnostic_total: bestDiagnostic?.total ?? null,
    };

    if (geneUsable) geneScores.push([bestScore, geneName]);
  }

  if (!anyUsable) {
    return {
      assigned: false, reason: 'filtered',
      debug: {
        gene_scores: geneDebug,
        best_gene: null, second_gene: null, gap: null, margin,
        outcome: 'filtered_no_usable_window',
      },
    };
  }

  geneScores.sort((a, b) => b[0] - a[0]);
  const [top1Score, top1Gene] = geneScores[0];

  if (geneScores.length === 1) {
    return {
      assigned: true,
      predicted_gene: top1Gene,
      top1_score: Math.round(top1Score * 10000) / 10000,
      debug: {
        gene_scores: geneDebug,
        best_gene: top1Gene, second_gene: null, gap: null, margin,
        outcome: 'assigned_only_one_gene_usable',
      },
    };
  }

  const [top2Score, top2Gene] = geneScores[1];
  const gap = top1Score - top2Score;

  const debugBlock: any = {
    gene_scores: geneDebug,
    best_gene: top1Gene, second_gene: top2Gene,
    gap: Math.round(gap * 10000) / 10000, margin,
  };

  if (gap >= margin) {
    debugBlock.outcome = 'assigned_margin_pass';
    return {
      assigned: true,
      predicted_gene: top1Gene,
      top1_score: Math.round(top1Score * 10000) / 10000,
      top2_score: Math.round(top2Score * 10000) / 10000,
      gap: Math.round(gap * 10000) / 10000,
      debug: debugBlock,
    };
  }

  debugBlock.outcome = 'ambiguous_margin_fail';
  return {
    assigned: false, reason: 'ambiguous',
    top1_score: Math.round(top1Score * 10000) / 10000,
    top2_score: Math.round(top2Score * 10000) / 10000,
    gap: Math.round(gap * 10000) / 10000,
    debug: debugBlock,
  };
}
