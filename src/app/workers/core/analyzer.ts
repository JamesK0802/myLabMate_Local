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
  const matcher = new SequenceMatcher(null, refSeq, readSeq);
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
    // X-padded paired reads have an observed left mate, an unknown internal
    // interval, and an observed right mate. Anchor the left segment from the
    // reference start and the right segment from the reference end. Matching
    // blocks determine how much reference each observed segment covers, so
    // genuine indels inside either segment remain countable.
    const leftObserved = segments[0];
    const rightObserved = segments[segments.length - 1];
    const leftBlocks = new SequenceMatcher(null, coreRef, leftObserved).getMatchingBlocks().filter(b => b[2] > 0);
    const rightBlocks = new SequenceMatcher(null, coreRef, rightObserved).getMatchingBlocks().filter(b => b[2] > 0);

    if (leftBlocks.length && rightBlocks.length) {
      const leftLast = leftBlocks[leftBlocks.length - 1];
      const rightLast = rightBlocks[rightBlocks.length - 1];
      const leftRefEnd = Math.min(coreRef.length, leftLast[0] + leftLast[2]);
      const leftObsEnd = Math.min(leftObserved.length, leftLast[1] + leftLast[2]);
      const endOffset = (rightLast[0] + rightLast[2]) - (rightLast[1] + rightLast[2]);
      const rightRefStart = Math.max(leftRefEnd, Math.min(coreRef.length, endOffset));
      const rightObsStart = Math.max(0, rightRefStart - endOffset);

      if (leftRefEnd > 0 && leftObsEnd > 0) {
        tokens.push(...alignReadToRef(coreRef.substring(0, leftRefEnd), leftObserved.substring(0, leftObsEnd)));
      }
      const unknownLen = Math.max(0, rightRefStart - leftRefEnd);
      if (unknownLen > 0) tokens.push({ type: 'unobserved', val: 'X'.repeat(unknownLen) });
      if (rightRefStart < coreRef.length && rightObsStart < rightObserved.length) {
        tokens.push(...alignReadToRef(coreRef.substring(rightRefStart), rightObserved.substring(rightObsStart)));
      }
    } else {
      // Conservative fallback: X is still never considered an observed
      // mismatch. Use reference bases at those coordinates and align once.
      const chars = coreRead.split('');
      const imputed = chars.map((base, i) => base === 'X' ? (coreRef[i] || '') : base).join('');
      tokens.push(...alignReadToRef(coreRef, imputed));
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
