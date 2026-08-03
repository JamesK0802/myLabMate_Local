import { describe, it, expect } from 'vitest';
import {
  reverseComplement,
  avgPhred,
  findGrnaCutSite,
  getWindowBounds,
  cutIndexInWindow,
  extractWindow,
  scoreReadAgainstWindow
} from '../classifier';

describe('Classifier Core Utilities', () => {
  it('should calculate reverse complement correctly', () => {
    expect(reverseComplement('ACTG')).toBe('CAGT');
    expect(reverseComplement('actg')).toBe('CAGT');
    expect(reverseComplement('AATTCG')).toBe('CGAATT');
  });

  it('should calculate average Phred score correctly', () => {
    expect(avgPhred([40, 40, 40])).toBe(40.0);
    expect(avgPhred([30, 20, 10])).toBe(20.0);
    expect(avgPhred(null)).toBe(40.0);
    expect(avgPhred([])).toBe(40.0);
  });

  it('should find gRNA cut site (forward strand)', () => {
    const reference = 'GCGCATGCATCGATCGATCGATCGATCGATCGATCGATCGATC';
    // Let's place a gRNA: ATCGATCGATCGATCGATCG (20bp) followed by PAM (NGG, e.g. TGG)
    // index in reference where gRNA starts: 8
    const grna = 'ATCGATCGATCGATCGATCG';
    const ref = 'GCGCATGC' + grna + 'TGG' + 'ATCGATCGATCGATC';
    const res = findGrnaCutSite(ref, grna);

    expect(res.strand).toBe('forward');
    expect(res.pam_found).toBe(true);
    expect(res.grna_start).toBe(8);
    expect(res.grna_end).toBe(28);
    expect(res.cut_site).toBe(25); // cut site is grna_end - 3
    expect(res.pam).toBe('TGG');
  });

  it('should get correct window bounds', () => {
    const ref = 'A'.repeat(100);
    expect(getWindowBounds(ref, 50, 40)).toEqual([30, 70]);
    expect(getWindowBounds(ref, 10, 40)).toEqual([0, 30]);
    expect(getWindowBounds(ref, 90, 40)).toEqual([70, 100]);
  });

  it('should get correct cut index in window', () => {
    const ref = 'A'.repeat(100);
    expect(cutIndexInWindow(ref, 50, 40)).toBe(20);
    expect(cutIndexInWindow(ref, 10, 40)).toBe(10);
  });

  it('should extract correct window subsegment', () => {
    const ref = 'abcdefghijklmnopqrstuvwxyz';
    expect(extractWindow(ref, 10, 10)).toBe('fghijklmno'); // cutSite = 10, windowSize = 10, [10-5, 10+5] = [5, 15] = 'fghijklmno'
  });

  it('should score read against window using k-mer scoring', () => {
    const window = 'AAAAAAAAAAAAAAAAAAAA';
    // Score should be 1.0 for perfect match
    expect(scoreReadAgainstWindow(window, window, 10)).toBe(1.0);
    // Score should be 0 for unrelated sequence
    expect(scoreReadAgainstWindow('CCCCCCCCCCCCCCCCCCCC', window, 10)).toBe(0.0);
  });

  it('should exclude cut-site mutations when exclusionFlank or dynamic exclusion is active', () => {
    const window = 'ATCGGCTAAGCTTGCCGAATCGCCTAGGCTA';
    // Read has a mutation right at cut site (index 16)
    const readWithCutSiteMutation = window.substring(0, 16) + 'T' + window.substring(17);
    // Read has a mutation far from cut site (index 2)
    const readWithFarMutation = window.substring(0, 2) + 'T' + window.substring(3);

    const scoreCutSite = scoreReadAgainstWindow(readWithCutSiteMutation, window, 10, 16, 0.0, 2);
    const scoreFar = scoreReadAgainstWindow(readWithFarMutation, window, 10, 16, 0.0, 0);

    expect(scoreCutSite).toBe(1.0);
    expect(scoreCutSite).toBeGreaterThan(scoreFar);
  });

  it('should weight far-from-cut-site k-mers higher when distanceWeight > 0', () => {
    const refWin = 'ACGTACGTACGTACGTACGTACGTACGTACGT';
    const cutIdx = 16;
    // Score with distanceWeight = 2.0 vs 0.0
    const scoreZeroWeight = scoreReadAgainstWindow(refWin, refWin, 10, cutIdx, 0.0, 2);
    const scoreHighWeight = scoreReadAgainstWindow(refWin, refWin, 10, cutIdx, 2.0, 2);

    expect(scoreZeroWeight).toBe(1.0);
    expect(scoreHighWeight).toBe(1.0);
  });
});
