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
  const tokens = alignReadToRefXaware(refSeq, readSeq, leftX, rightX);

  // Count only biological (non-unobserved) operations
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

export function alignReadToRefXaware(
  refSeq: string,
  readSeq: string,
  leftX: number = 0,
  rightX: number = 0
): AlignmentToken[] {
  const matcher = new SequenceMatcher(null, refSeq, readSeq);
  const opcodes = matcher.getOpcodes();

  if (opcodes.length === 0) return [];

  // ── Identify terminal opcodes ─────────────────────────────────────────────
  const leadingTerminal = new Set<number>();
  for (let idx = 0; idx < opcodes.length; idx++) {
    const [tag] = opcodes[idx];
    if (tag === 'delete') {
      leadingTerminal.add(idx);
    } else {
      break;
    }
  }

  const trailingTerminal = new Set<number>();
  for (let idx = opcodes.length - 1; idx >= 0; idx--) {
    const [tag, i1, i2, j1, j2] = opcodes[idx];
    if (tag === 'delete') {
      trailingTerminal.add(idx);
    } else if (tag === 'insert' && i1 >= refSeq.length) {
      trailingTerminal.add(idx);
    } else {
      break;
    }
  }

  const terminalIndices = new Set([...leadingTerminal, ...trailingTerminal]);
  const hasTruncation = leftX > 0 || rightX > 0;

  // ── Generate tokens ───────────────────────────────────────────────────────
  const tokens: AlignmentToken[] = [];

  for (let idx = 0; idx < opcodes.length; idx++) {
    const [tag, i1, i2, j1, j2] = opcodes[idx];
    const isTerminal = hasTruncation && terminalIndices.has(idx);

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
        const opType = isTerminal ? 'unobserved' : 'delete';
        const val = isTerminal
          ? 'X'.repeat(refChunk.length - subLen)
          : '-'.repeat(refChunk.length - subLen);
        tokens.push({ type: opType as AlignmentToken['type'], val });
      } else if (readChunk.length > subLen) {
        if (!isTerminal) {
          tokens.push({ type: 'insert', val: readChunk.substring(subLen) });
        }
      }
    } else if (tag === 'delete') {
      if (isTerminal) {
        tokens.push({ type: 'unobserved', val: 'X'.repeat(i2 - i1) });
      } else {
        tokens.push({ type: 'delete', val: '-'.repeat(i2 - i1) });
      }
    } else if (tag === 'insert') {
      if (!isTerminal) {
        tokens.push({ type: 'insert', val: readSeq.substring(j1, j2) });
      }
    }
  }

  return tokens;
}

// ── Legacy compatibility wrapper ──────────────────────────────────────────────
export function alignReadToRef(refSeq: string, readSeq: string): AlignmentToken[] {
  return alignReadToRefXaware(refSeq, readSeq, 0, 0);
}
