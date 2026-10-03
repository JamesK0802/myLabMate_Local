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
const ANCHOR_LEN = 15;
const MAX_ANCHOR_ERRORS = 4;

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

export function resolveMatchedCutSite(
  reference: string,
  matchStart: number,
  matchLength: number,
  strand: 'forward' | 'reverse'
): Pick<CutSiteInfo, 'cut_site' | 'pam' | 'pam_found'> {
  const refUp = toStr(reference).toUpperCase();
  const matchEnd = matchStart + matchLength;
  if (strand === 'forward') {
    const adjacentPam = refUp.slice(matchEnd, matchEnd + 3);
    if (/^[ACGT]GG$/.test(adjacentPam)) {
      return { cut_site: matchEnd - 3, pam: adjacentPam, pam_found: true };
    }
    const includedPam = refUp.slice(matchEnd - 3, matchEnd);
    if (matchLength >= 23 && /^[ACGT]GG$/.test(includedPam)) {
      return { cut_site: matchEnd - 6, pam: includedPam, pam_found: true };
    }
    return { cut_site: matchEnd - 3, pam: 'NOT_FOUND', pam_found: false };
  }

  const adjacentPam = refUp.slice(matchStart - 3, matchStart);
  if (/^CC[ACGT]$/.test(adjacentPam)) {
    return { cut_site: matchStart + 3, pam: adjacentPam, pam_found: true };
  }
  const includedPam = refUp.slice(matchStart, matchStart + 3);
  if (matchLength >= 23 && /^CC[ACGT]$/.test(includedPam)) {
    return { cut_site: matchStart + 6, pam: includedPam, pam_found: true };
  }
  return { cut_site: matchStart + 3, pam: 'NOT_FOUND', pam_found: false };
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
      const cut = resolveMatchedCutSite(refUp, pos, grnaLen, 'forward');
      if (cut.pam_found) {
        return { strand: 'forward', grna_start: pos, grna_end: pos + grnaLen, ...cut };
      }
    }
  }

  // Reverse: [CCN] + gRNA_RC
  for (let pos = 0; pos < refLen - grnaRc.length; pos++) {
    if (refUp.substring(pos, pos + grnaRc.length) === grnaRc) {
      const cut = resolveMatchedCutSite(refUp, pos, grnaRc.length, 'reverse');
      if (cut.pam_found) {
        return { strand: 'reverse', grna_start: pos, grna_end: pos + grnaRc.length, ...cut };
      }
    }
  }

  // A 23+ bp input may already include its PAM. Accept either reference
  // orientation and use the same rule as result annotations and viewers.
  if (grnaLen >= 23) {
    const direct = refUp.indexOf(grnaUp);
    if (direct !== -1) {
      for (const strand of ['forward', 'reverse'] as const) {
        const cut = resolveMatchedCutSite(refUp, direct, grnaLen, strand);
        if (cut.pam_found) return { strand, grna_start: direct, grna_end: direct + grnaLen, ...cut };
      }
    }
    const reverse = refUp.indexOf(grnaRc);
    if (reverse !== -1) {
      for (const strand of ['reverse', 'forward'] as const) {
        const cut = resolveMatchedCutSite(refUp, reverse, grnaLen, strand);
        if (cut.pam_found) return { strand, grna_start: reverse, grna_end: reverse + grnaLen, ...cut };
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

  return null;
}

function editDistance(a: string, b: string, maxErrors: number = MAX_ANCHOR_ERRORS): number {
  if (Math.abs(a.length - b.length) > maxErrors) return maxErrors + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1);
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxErrors) return maxErrors + 1;
    previous = current;
  }
  return previous[b.length];
}

interface AlignResult {
  fail: string | null;
  observed_read?: string;
  read_window?: string;
  qual_observed?: QualityScores | null;
  left_x?: number;
  right_x?: number;
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
  // A short direct-input window cannot hold two independent 15 bp anchors.
  // Split it into non-overlapping terminal anchors instead of treating the
  // entire window as both anchors (which can never form a valid pair).
  const anchorLen = Math.min(ANCHOR_LEN, Math.max(1, Math.floor(winLen / 2)));

  // Step 1: Find coordinate offset
  const offset = findOffset(seqUp, refUp, sgrnaSeq);
  if (offset === null) return { fail: 'no_alignment' };

  // Step 2: Cut-site ±15bp coverage gate
  const cutInRead = offset + cutIdxInWindow;
  if (cutInRead - CUT_SITE_MIN_FLANK < 0 || cutInRead + CUT_SITE_MIN_FLANK > seq.length) {
    return { fail: 'no_coverage' };
  }

  // Step 3: Find anchors
  const leftAnchor = refUp.substring(0, anchorLen);
  const rightAnchor = refUp.substring(refUp.length - anchorLen);

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

  // Find best anchor pair
  const refInnerLen = winLen - 2 * anchorLen;
  let bestLi = -1, bestRi = -1, bestDiff = Infinity;
  for (const l of leftPositions) {
    for (const r of rightPositions) {
      if (r >= l + anchorLen) {
        const innerLen = r - l - anchorLen;
        const diff = Math.abs(innerLen - refInnerLen);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestLi = l;
          bestRi = r;
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

  if (bestLi !== -1 && bestRi !== -1) {
    // CASE A: Both anchors found
    observedRead = seq.substring(bestLi, bestRi + anchorLen).toUpperCase();
    leftX = 0;
    rightX = 0;
    readWindow = observedRead;
    qualObserved = qual ? qual.slice(bestLi, bestRi + anchorLen) : null;

  } else if (leftPositions.length > 0) {
    // CASE B: Left anchor found, right truncated
    const bestLeft = leftPositions.reduce((best, x) => Math.abs(x - offset) < Math.abs(best - offset) ? x : best);
    const candidateObs = seq.substring(bestLeft).toUpperCase();
    if (bestLeft + winLen > seq.length) {
      // Right truncated by end of read / X-gap
      const matcher = new SequenceMatcher(null, refUp, candidateObs);
      const blocks = matcher.getMatchingBlocks();
      let lastRefEnd = 0;
      let lastObsEnd = 0;
      for (const b of blocks) {
        if (b[2] > 0) {
          lastRefEnd = b[0] + b[2];
          lastObsEnd = b[1] + b[2];
        }
      }

      if (lastRefEnd >= winLen) {
        observedRead = candidateObs.substring(0, lastObsEnd);
        leftX = 0;
        rightX = 0;
        readWindow = observedRead;
        qualObserved = qual ? qual.slice(bestLeft, bestLeft + lastObsEnd) : null;
      } else {
        observedRead = candidateObs.substring(0, lastObsEnd);
        leftX = 0;
        rightX = Math.max(0, winLen - lastRefEnd);
        readWindow = observedRead + 'X'.repeat(rightX);
        qualObserved = qual ? qual.slice(bestLeft, bestLeft + lastObsEnd) : null;
      }
    } else {
      observedRead = seq.substring(bestLeft, Math.min(seq.length, bestLeft + winLen)).toUpperCase();
      leftX = 0;
      rightX = 0;
      readWindow = observedRead;
      qualObserved = qual ? qual.slice(bestLeft, bestLeft + winLen) : null;
    }

  } else if (rightPositions.length > 0) {
    // CASE C: Right anchor found, left truncated
    const bestRight = rightPositions.reduce((best, x) =>
      Math.abs(x - (offset + winLen - anchorLen)) < Math.abs(best - (offset + winLen - anchorLen)) ? x : best
    );
    const endPos = bestRight + anchorLen;
    const winStart = bestRight - (winLen - anchorLen);
    if (winStart < 0) {
      // Left truncated by start of read
      const candidateObs = seq.substring(0, endPos).toUpperCase();
      const matcher = new SequenceMatcher(null, refUp, candidateObs);
      const blocks = matcher.getMatchingBlocks();
      let firstRefStart = winLen;
      let firstObsStart = candidateObs.length;
      for (const b of blocks) {
        if (b[2] > 0) {
          firstRefStart = Math.min(firstRefStart, b[0]);
          firstObsStart = Math.min(firstObsStart, b[1]);
        }
      }

      if (firstRefStart <= 0) {
        observedRead = candidateObs.substring(firstObsStart);
        leftX = 0;
        rightX = 0;
        readWindow = observedRead;
        qualObserved = qual ? qual.slice(firstObsStart, endPos) : null;
      } else {
        observedRead = candidateObs.substring(firstObsStart);
        leftX = Math.max(0, firstRefStart);
        rightX = 0;
        readWindow = 'X'.repeat(leftX) + observedRead;
        qualObserved = qual ? qual.slice(firstObsStart, endPos) : null;
      }
    } else {
      observedRead = seq.substring(winStart, endPos).toUpperCase();
      leftX = 0;
      rightX = 0;
      readWindow = observedRead;
      qualObserved = qual ? qual.slice(winStart, endPos) : null;
    }

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
  if (!rw || !rf) return false;

  const leadingX = Math.min((rw.match(/^X+/)?.[0].length || 0), ANCHOR_LEN, rf.length);
  const trailingX = Math.min((rw.match(/X+$/)?.[0].length || 0), ANCHOR_LEN, Math.max(0, rf.length - leadingX));

  const anchorPasses = (refAnchor: string, observedEdge: string): boolean => {
    if (!refAnchor.length) return true;
    const minLength = Math.max(1, refAnchor.length - MAX_ANCHOR_ERRORS);
    const maxLength = Math.min(observedEdge.length, refAnchor.length + MAX_ANCHOR_ERRORS);
    if (maxLength < minLength) return false;
    let best = MAX_ANCHOR_ERRORS + 1;
    for (let length = minLength; length <= maxLength; length++) {
      best = Math.min(best, editDistance(refAnchor, observedEdge.substring(0, length), MAX_ANCHOR_ERRORS));
    }
    return best <= MAX_ANCHOR_ERRORS;
  };

  const leftRef = rf.substring(leadingX, Math.min(ANCHOR_LEN, rf.length));
  const leftObserved = rw.substring(leadingX, Math.min(rw.length - trailingX, ANCHOR_LEN + MAX_ANCHOR_ERRORS));
  if (!anchorPasses(leftRef, leftObserved)) return false;

  const rightRefEnd = Math.max(0, rf.length - trailingX);
  const rightRef = rf.substring(Math.max(leadingX, rf.length - ANCHOR_LEN), rightRefEnd).split('').reverse().join('');
  const observedEnd = Math.max(leadingX, rw.length - trailingX);
  const rightObserved = rw.substring(Math.max(leadingX, observedEnd - ANCHOR_LEN - MAX_ANCHOR_ERRORS), observedEnd).split('').reverse().join('');
  return anchorPasses(rightRef, rightObserved);
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
    } else if (tag === 'replace' || tag === 'delete') {
      const len = j2 - j1;
      for (let k = 0; k < len; k++) {
        const refIdx = j1 + k;
        if (excludedRefIndices.has(refIdx)) continue;
        const refChar = cleanRef[refIdx];
        if (refChar === 'N') continue;
        const d = Math.abs(refIdx - cutSitePos);
        const w = calcSeagullWeight(d, maxDist, distanceWeight);
        totalMaxWeight += w;
      }
    } else if (tag === 'insert') {
      const refIdx = j1;
      if (!excludedRefIndices.has(refIdx)) {
        const d = Math.abs(refIdx - cutSitePos);
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
  const readUp = toStr(read).toUpperCase();
  const refUp = toStr(refWindow).toUpperCase();
  if (!readUp || !refUp) return 0.0;

  const cutSitePos = cutIndexInWindow >= 0 ? cutIndexInWindow : Math.floor(refUp.length / 2);
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

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

export interface ClassInfo {
  gene: string;
  target: string;
  ref_window: string;
  sgrna_seq?: string;
  cut_index_in_window?: number;
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
        const score = scoreReadAgainstWindow(targetSeq, t.ref_window, t.cut_index_in_window ?? -1, cutSiteDistanceWeight, cutSiteExclusionFlank);
        if (score > bestScore) {
          bestScore = score;
          bestTarget = t.target;
        }
      }
    }

    geneDebug[geneName] = {
      best_score: bestScore >= 0 ? Math.round(bestScore * 10000) / 10000 : null,
      best_target: bestTarget,
      usable: usableCount,
      total: targets.length,
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
