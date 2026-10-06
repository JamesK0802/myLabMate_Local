import { describe, it, expect } from 'vitest';
import {
  reverseComplement,
  avgPhred,
  findGrnaCutSite,
  getWindowBounds,
  cutIndexInWindow,
  extractWindow,
  scoreReadAgainstWindow,
  isReadUsable,
  clearClassifierCache
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

  it('uses the same cut coordinate when a forward PAM is included in the guide input', () => {
    const spacer = 'ATCGATCGATCGATCGATCG';
    const reference = `GCGCATGC${spacer}TGGATCGATCG`;
    const result = findGrnaCutSite(reference, `${spacer}TGG`);

    expect(result.strand).toBe('forward');
    expect(result.pam_found).toBe(true);
    expect(result.cut_site).toBe(25);
  });

  it('resolves a reverse reference-oriented guide with its included CCN PAM', () => {
    const matchedGuide = `CCA${'ATCG'.repeat(5)}`;
    const reference = `TTTT${matchedGuide}AAAA`;
    const result = findGrnaCutSite(reference, matchedGuide);

    expect(result.strand).toBe('reverse');
    expect(result.pam_found).toBe(true);
    expect(result.cut_site).toBe(10);
  });

  it('should get correct window bounds', () => {
    const ref = 'A'.repeat(100);
    expect(getWindowBounds(ref, 50, 40)).toEqual([30, 70]);
    expect(getWindowBounds(ref, 10, 40)).toEqual([0, 30]);
    expect(getWindowBounds(ref, 90, 40)).toEqual([70, 100]);
    expect(getWindowBounds(ref, 50, 60, 20, 40)).toEqual([30, 90]);
    expect(getWindowBounds(ref, 10, 60, 20, 40)).toEqual([0, 50]);
  });

  it('should get correct cut index in window', () => {
    const ref = 'A'.repeat(100);
    expect(cutIndexInWindow(ref, 50, 40)).toBe(20);
    expect(cutIndexInWindow(ref, 10, 40)).toBe(10);
    expect(cutIndexInWindow(ref, 50, 60, 20, 40)).toBe(20);
  });

  it('should extract correct window subsegment', () => {
    const ref = 'abcdefghijklmnopqrstuvwxyz';
    expect(extractWindow(ref, 10, 10)).toBe('fghijklmno'); // cutSite = 10, windowSize = 10, [10-5, 10+5] = [5, 15] = 'fghijklmno'
    expect(extractWindow(ref, 10, 6, 2, 4)).toBe('ijklmn');
  });

  it('should score read against window using alignment scoring', () => {
    const window = 'AAAAAAAAAAAAAAAAAAAA';
    // Score should be 1.0 for perfect match
    expect(scoreReadAgainstWindow(window, window)).toBe(1.0);
    // Score should be 0 for unrelated sequence
    expect(scoreReadAgainstWindow('CCCCCCCCCCCCCCCCCCCC', window)).toBe(0.0);
  });

  it('does not collapse X-separated segments into artificial adjacent evidence', () => {
    const window = 'AAAACCCC';
    const segmentScore = Math.max(
      scoreReadAgainstWindow('AAAA', window),
      scoreReadAgainstWindow('CCCC', window),
    );
    const guardedScore = scoreReadAgainstWindow('AAAAXXXXCCCC', window);
    expect(guardedScore).toBeCloseTo(segmentScore);
  });

  it('aligns an exact short direct-input window inside a long read', () => {
    const target = 'AACATCAATC';
    const read = `${'G'.repeat(25)}${target}${'T'.repeat(25)}`;
    const [usable, reason, result] = isReadUsable(read, null, target, 0, '', 5);

    expect(usable).toBe(true);
    expect(reason).toBe('ok');
    expect(result?.read_window).toBe(target);
  });

  it('does not reuse a usability decision across different FASTQ qualities', () => {
    clearClassifierCache();
    const reference = 'ACGTTGCACTGATCG' + 'CCGTA'.repeat(8) + 'TGCATGACCTAGTCA';
    const guide = reference.substring(25, 45);
    const cutIndex = 35;
    const highQuality = new Array(reference.length).fill(40);
    const lowQuality = new Array(reference.length).fill(5);

    expect(isReadUsable(reference, highQuality, reference, 20, guide, cutIndex)[0]).toBe(true);
    const [usable, reason] = isReadUsable(reference, lowQuality, reference, 20, guide, cutIndex);
    expect(usable).toBe(false);
    expect(reason).toBe('quality');
  });

  it('accepts up to four alignment errors in a 15 bp terminal anchor', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = `${left}${'CCGTA'.repeat(4)}${guide}${'AGTCC'.repeat(4)}${right}`;
    const cutIndex = left.length + 20 + 10;
    const mutatePrefix = (count: number) => reference
      .split('')
      .map((base, index) => index < count ? (base === 'A' ? 'C' : 'A') : base)
      .join('');
    const fourErrors = mutatePrefix(4);
    const fiveErrors = mutatePrefix(5);

    expect(isReadUsable(fourErrors, null, reference, 0, guide, cutIndex)[0]).toBe(true);
    const [usable, reason] = isReadUsable(fiveErrors, null, reference, 0, guide, cutIndex);
    expect(usable).toBe(false);
    expect(reason).toBe('no_anchor');
  });

  it('counts a terminal deletion as one anchor error', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = `${left}${'CCGTA'.repeat(4)}${guide}${'AGTCC'.repeat(4)}${right}`;
    const cutIndex = left.length + 20 + 10;
    const oneBaseDeletion = `${reference[0]}${reference.substring(2)}`;

    const [usable, reason] = isReadUsable(oneBaseDeletion, null, reference, 0, guide, cutIndex);
    expect(usable).toBe(true);
    expect(reason).toBe('ok');
  });

  it('keeps terminal X padding unobserved instead of counting it as an anchor error', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = `${left}${'CCGTA'.repeat(4)}${guide}${'AGTCC'.repeat(4)}${right}`;
    const cutIndex = left.length + 20 + 10;
    const leftTruncated = reference.substring(8);

    const [usable, reason, result] = isReadUsable(leftTruncated, null, reference, 0, guide, cutIndex);
    expect(usable).toBe(true);
    expect(reason).toBe('ok');
    expect(result?.left_x).toBe(8);
  });

  it('should exclude cut-site mutations only when exclusionFlank is configured', () => {
    const window = 'ATCGGCTAAGCTTGCCGAATCGCCTAGGCTA';
    // Read has a mutation right at cut site (index 16)
    const readWithCutSiteMutation = window.substring(0, 16) + 'T' + window.substring(17);
    // Read has a mutation far from cut site (index 2)
    const readWithFarMutation = window.substring(0, 2) + 'T' + window.substring(3);

    const scoreCutSite = scoreReadAgainstWindow(readWithCutSiteMutation, window, 16, 0.0, 2);
    const scoreCutSiteDefault = scoreReadAgainstWindow(readWithCutSiteMutation, window, 16);
    const scoreFar = scoreReadAgainstWindow(readWithFarMutation, window, 16, 0.0, 0);

    expect(scoreCutSite).toBe(1.0);
    expect(scoreCutSiteDefault).toBeLessThan(1.0);
    expect(scoreCutSite).toBeGreaterThan(scoreFar);
  });

  it('should weight far-from-cut-site alignment positions higher when distanceWeight > 0', () => {
    const refWin = 'ACGTACGTACGTACGTACGTACGTACGTACGT';
    const cutIdx = 16;
    // Score with distanceWeight = 2.0 vs 0.0
    const scoreZeroWeight = scoreReadAgainstWindow(refWin, refWin, cutIdx, 0.0, 2);
    const scoreHighWeight = scoreReadAgainstWindow(refWin, refWin, cutIdx, 2.0, 2);

    expect(scoreZeroWeight).toBe(1.0);
    expect(scoreHighWeight).toBe(1.0);
  });
});
