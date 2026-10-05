/**
 * analyzer.ts — X-aware Mutation Classification and Alignment.
 *
 * 1:1 TypeScript port of backend/core/analyzer.py.
 *
 * Aligns observed_read against ref_window using SequenceMatcher.
 * Terminal operations (leading/trailing deletes from truncation) are
 * identified and marked as "unobserved" — never counted as biological deletions.
 *
 * Token types:
 *   equal       — matching base
 *   substitute  — mismatching base
 *   delete      — biological deletion (internal)
 *   insert      — biological insertion
 *   unobserved  — terminal unobserved position (X)
 */

import { SequenceMatcher } from './sequence-matcher';

export interface AlignmentToken {
  type: 'equal' | 'substitute' | 'delete' | 'insert' | 'unobserved';
  val: string;
}

export interface MutationResult {
  category: string;
  has_sub: boolean;
  net_indel: number;
  tokens: AlignmentToken[];
}

export function classifyMutationWithAlignment(
  refSeq: string,
  readSeq: string,
  leftX: number = 0,
  rightX: number = 0
): MutationResult {
  // Every X run is unobserved sequence. Align the observed segments on either
  // side independently so an internal paired-read gap cannot become a giant
  // substitution or erase a real indel seen in either mate.
  const tokens = alignReadToRefXaware(refSeq, readSeq, leftX, rightX);

  // Count only biological operations
  let insLen = 0, delLen = 0, subCount = 0;
  for (const t of tokens) {
    if (t.type === 'insert') insLen += t.val.length;
    else if (t.type === 'delete') delLen += t.val.length;
    else if (t.type === 'substitute') subCount += t.val.length;
  }

  const netIndel = insLen - delLen;
  const hasSub = subCount > 0;

  let category: string;
  if (insLen === 0 && delLen === 0) {
    category = 'no_indel';
  } else {
    category = netIndel % 3 === 0 ? 'in_frame' : 'out_of_frame';
  }

  return { category, has_sub: hasSub, net_indel: netIndel, tokens };
}

export function alignReadToRef(refSeq: string, readSeq: string): AlignmentToken[] {
  // SequenceMatcher's default autojunk mode is designed for prose. At 200+
  // characters it treats frequent symbols as noise; with DNA that removes
  // all four nucleotides and turns the sequence after the first edit into one
  // giant replacement. DNA bases are evidence, never junk.
  const matcher = new SequenceMatcher(null, refSeq, readSeq, readSeq.length < 200);
  const opcodes = matcher.getOpcodes();

  if (opcodes.length === 0) return [];

  const tokens: AlignmentToken[] = [];

  for (let idx = 0; idx < opcodes.length; idx++) {
    const [tag, i1, i2, j1, j2] = opcodes[idx];

    if (tag === 'equal') {
      tokens.push({ type: 'equal', val: readSeq.substring(j1, j2) });
    } else if (tag === 'replace') {
      const refChunk = refSeq.substring(i1, i2);
      const readChunk = readSeq.substring(j1, j2);
      const subLen = Math.min(refChunk.length, readChunk.length);

      if (subLen > 0) {
        tokens.push({ type: 'substitute', val: readChunk.substring(0, subLen) });
      }
      if (refChunk.length > subLen) {
        tokens.push({ type: 'delete', val: '-'.repeat(refChunk.length - subLen) });
      } else if (readChunk.length > subLen) {
        tokens.push({ type: 'insert', val: readChunk.substring(subLen) });
      }
    } else if (tag === 'delete') {
      tokens.push({ type: 'delete', val: '-'.repeat(i2 - i1) });
    } else if (tag === 'insert') {
      tokens.push({ type: 'insert', val: readSeq.substring(j1, j2) });
    }
  }

  return tokens;
}

export function alignReadToRefXaware(
  refSeq: string,
  readSeq: string,
  leftX: number = 0,
  rightX: number = 0
): AlignmentToken[] {
  if (!readSeq.includes('X') && leftX <= 0 && rightX <= 0) return alignReadToRef(refSeq, readSeq);

  const leadingRun = readSeq.match(/^X+/)?.[0].length || 0;
  const trailingRun = readSeq.match(/X+$/)?.[0].length || 0;
  const leftPadLen = Math.min(Math.max(leftX, leadingRun), refSeq.length);
  const rightPadLen = Math.min(Math.max(rightX, trailingRun), Math.max(0, refSeq.length - leftPadLen));
  const coreStart = leadingRun;
  const coreEnd = Math.max(coreStart, readSeq.length - trailingRun);
  const coreRead = readSeq.substring(coreStart, coreEnd);
  const coreRefStart = leftPadLen;
  const coreRefEnd = Math.max(coreRefStart, refSeq.length - rightPadLen);
  const coreRef = refSeq.substring(coreRefStart, coreRefEnd);
  const tokens: AlignmentToken[] = [];
  if (leftPadLen > 0) tokens.push({ type: 'unobserved', val: 'X'.repeat(leftPadLen) });

  const segments = coreRead.split(/X+/).filter(Boolean);
  if (segments.length <= 1) {
    if (coreRef.length && segments.length) tokens.push(...alignReadToRef(coreRef, segments[0]));
    else if (coreRef.length) tokens.push({ type: 'unobserved', val: 'X'.repeat(coreRef.length) });
  } else {
    // Place every observed mate by its matching-block envelope. Bases outside
    // that envelope are primer/read overhang, not evidence of an indel. The
    // uncovered reference interval between mates remains explicitly
    // unobserved. This is deliberately a placement correction, not a new
    // mutation-calling rule: alignReadToRef still calls edits inside each
    // observed envelope exactly as before.
    const placements = segments.flatMap(observed => {
      // DNA uses only four symbols. For a 301-bp Illumina mate the generic
      // SequenceMatcher autojunk heuristic marks every nucleotide as
      // "popular", yielding no matching blocks at all. Placement is a short,
      // reference-guided operation, so disable that text-oriented heuristic.
      // Put the shorter reference window on SequenceMatcher's indexed side.
      // Below 200 bp this keeps the original fast path; at 200+ bp we disable
      // autojunk because DNA's four-letter alphabet must never be discarded.
      const blocks = new SequenceMatcher(null, observed, coreRef, coreRef.length < 200)
        .getMatchingBlocks()
        .filter(block => block[2] > 0)
        .map(([obsStart, refStart, length]) => [refStart, obsStart, length] as [number, number, number]);
      // A remote mate can share a few incidental bases with the window. It is
      // not positioned evidence unless it contains at least the same 10-bp
      // exact seed used by paired-read overlap detection.
      const anchorBlocks = blocks.filter(block => block[2] >= 10);
      if (!anchorBlocks.length) return [];
      // Short incidental matches are common in a four-letter alphabet and
      // must not expand the observed envelope into primer/amplicon overhang.
      // Only substantive placement anchors define the usable boundaries.
      const first = anchorBlocks[0];
      const last = anchorBlocks[anchorBlocks.length - 1];
      return [{
        refStart: first[0],
        refEnd: last[0] + last[2],
        observed,
        obsStart: first[1],
        obsEnd: last[1] + last[2],
        anchorSupport: anchorBlocks.reduce((sum, block) => sum + block[2], 0),
      }];
    }).sort((a, b) => a.refStart - b.refStart);

    // Failed-overlap mates must not both contribute to the same reference
    // coordinates. Concatenating their overlapping alignments creates a
    // cascade of small insertions/deletions from two competing observations.
    // Keep the placement with stronger exact-anchor support; retain both only
    // when their reference intervals are genuinely disjoint.
    const resolvedPlacements: typeof placements = [];
    for (const placement of placements) {
      const previous = resolvedPlacements[resolvedPlacements.length - 1];
      if (!previous || placement.refStart >= previous.refEnd) {
        resolvedPlacements.push(placement);
      } else if (placement.anchorSupport > previous.anchorSupport) {
        resolvedPlacements[resolvedPlacements.length - 1] = placement;
      }
    }

    let refCursor = 0;
    for (const placement of resolvedPlacements) {
      let { refStart, refEnd, obsStart, obsEnd } = placement;
      if (refEnd <= refCursor) continue;
      if (refStart < refCursor) {
        const overlap = refCursor - refStart;
        refStart = refCursor;
        obsStart = Math.min(obsEnd, obsStart + overlap);
      }
      if (refStart > refCursor) {
        tokens.push({ type: 'unobserved', val: 'X'.repeat(refStart - refCursor) });
      }
      if (refEnd > refStart && obsEnd > obsStart) {
        tokens.push(...alignReadToRef(
          coreRef.substring(refStart, refEnd),
          placement.observed.substring(obsStart, obsEnd),
        ));
      }
      refCursor = Math.max(refCursor, refEnd);
    }
    if (refCursor < coreRef.length) {
      tokens.push({ type: 'unobserved', val: 'X'.repeat(coreRef.length - refCursor) });
    }
  }

  if (rightPadLen > 0) tokens.push({ type: 'unobserved', val: 'X'.repeat(rightPadLen) });
  return tokens;
}

/** Build the annotation/grouping sequence while rendering unobserved bases as WT. */
export function materializeTokensAgainstReference(refSeq: string, tokens: AlignmentToken[]): string {
  let refPos = 0;
  let sequence = '';
  for (const token of tokens) {
    if (token.type === 'equal' || token.type === 'substitute') {
      sequence += token.val;
      refPos += token.val.length;
    } else if (token.type === 'insert') {
      sequence += token.val;
    } else if (token.type === 'delete') {
      refPos += token.val.length;
    } else {
      const len = token.val.length;
      sequence += refSeq.substring(refPos, refPos + len);
      refPos += len;
    }
  }
  return sequence;
}
