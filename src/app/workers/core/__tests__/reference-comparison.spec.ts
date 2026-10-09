import { describe, expect, it } from 'vitest';
import { compareReferences, ReferenceMatcher } from '../reference-comparison';
import { homoeologSimilarity, projectHomoeologPosition } from '../homoeolog';

describe('reference diagnostic alignment', () => {
  it('aligns equal-length sequences with compensating indels instead of a Hamming comparison', () => {
    const a = 'ACGTACGTGGGCTAGC';
    const b = 'ACGTTACGTGGCTAGC';
    const result = compareReferences(a, b);
    expect(result.opcodes.some(op => op[0] === 'insert')).toBe(true);
    expect(result.opcodes.some(op => op[0] === 'delete')).toBe(true);
    expect(result.similarity).toBeGreaterThan(80);
    expect(result.similarity).toBe(compareReferences(b, a).similarity);
  });
  it('uses the same aligned identity in matrix, detail, and homoeolog overview', () => {
    const a = 'AAAACCCCGGGG', b = 'AAAACCCGGGG';
    const result = compareReferences(a, b);
    expect(homoeologSimilarity(a, b)).toBe(result.similarity);
    expect(new ReferenceMatcher(null, a, b).ratio() * 100).toBeCloseTo(result.similarity);
    expect(projectHomoeologPosition(a, b, 12)).toBe(11);
    expect(projectHomoeologPosition(a, b, 0)).toBe(0);
  });
  it('reconstructs both inputs and includes terminal differences without autojunk', () => {
    const a = 'A'.repeat(220) + 'CT', b = 'A'.repeat(220) + 'GCT';
    const result = compareReferences(a, b);
    expect(result.opcodes.map(([, i, ii]) => a.slice(i, ii)).join('')).toBe(a);
    expect(result.opcodes.map(([, , , j, jj]) => b.slice(j, jj)).join('')).toBe(b);
    expect(result.similarity).toBeGreaterThan(99);
  });
});
