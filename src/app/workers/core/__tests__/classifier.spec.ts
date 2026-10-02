import { describe, it, expect } from 'vitest';
import {
  reverseComplement,
  avgPhred,
  findGrnaCutSite,
  getWindowBounds,
  cutIndexInWindow,
  extractWindow,
  scoreReadAgainstWindow,
  isReadUsableUncached,
  applyGeneClassification,
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

  it('penalizes real insertions and deletions outside the excluded cut-site region', () => {
    const window = 'ACGTTGCACTGATCGTAGCTACGATGCTAGTCAGTCA';
    const inserted = window.slice(0, 5) + 'A' + window.slice(5);
    const deleted = window.slice(0, 30) + window.slice(31);

    expect(scoreReadAgainstWindow(inserted, window, 19, 0, 2)).toBeLessThan(1);
    expect(scoreReadAgainstWindow(deleted, window, 19, 0, 2)).toBeLessThan(1);
  });

  it('keeps terminal X padding neutral in assignment scoring', () => {
    const window = 'ACGTTGCACTGATCGTAGCTACGATGCTAGTCAGTCA';
    const padded = `XX${window.slice(2, -3)}XXX`;
    expect(scoreReadAgainstWindow(padded, window, 19, 0, 2)).toBe(1);
  });

  it('soft-clips a primer-overwritten terminal prefix using the nearest inset anchor', () => {
    const refWindow = 'TTGGAAGCTGGCCAGCTTTCTTCGTCGTTTAGAAGCAGTGAACGCCCCAGTAAACCATTACAGGTCGTGATTGCTGGTGCAGGTCTGAAGTCTGATGTAACTCCAAAATTTAAACATGTATACTTTTTCG';
    const read = 'GCTTACGCTGGAGTGAGTACGGTGTGCGGAAGCTGGCCAGCTTTCTTCGTCGTTTAGAAGCAGTGAACGCCCCAGTAAACCATTACAGGTCGTGATTGCTGGTGCAGGTCTGAAGTCTGATGTAACTCCAAAATTTAAACATGTATACTTTTTCGCACACCAGATACCCTTGAGTGAATCACCATTGCCTCTTAGCGTTACTACCATCCAGCATCCAACTCACATCACAG';
    const [usable, reason, result] = isReadUsableUncached(
      read,
      new Array(read.length).fill(35),
      refWindow,
      20,
      'AGTAAACCATTACAGGTCGT',
      65,
    );

    expect(usable).toBe(true);
    expect(reason).toBe('ok');
    expect(result?.left_x).toBe(2);
    expect(result?.read_window.startsWith('XXGGAAGCTGGC')).toBe(true);
  });

  it('soft-clips both primer-overwritten ends when internal anchors retain the target span', () => {
    const refWindow = 'TTGGAAGCTGGCCAGCTTTCTTCGTCGTTTAGAAGCAGTGAACGCCCCAGTAAACCATTACAGGTCGTGATTGCTGGTGCAGGTCTGAAGTCTGATGTAACTCCAAAATTTAAACATGTATACTTTTTCG';
    const primerReplacedRead = `GC${refWindow.slice(2, -2)}AA`;
    const [usable, reason, result] = isReadUsableUncached(
      primerReplacedRead,
      new Array(primerReplacedRead.length).fill(35),
      refWindow,
      20,
      'AGTAAACCATTACAGGTCGT',
      65,
    );

    expect(usable).toBe(true);
    expect(reason).toBe('ok');
    expect(result?.left_x).toBe(2);
    expect(result?.right_x).toBe(2);
    expect(result?.read_window.startsWith('XXGGAAGCTGGC')).toBe(true);
    expect(result?.read_window.endsWith('XX')).toBe(true);
  });

  it('uses the unique whole-window winner within a homoeolog group', () => {
    const refA = 'AACCGGTTAACCGGTTAACCGGTTAACCGGTTAACCGGTT';
    const refB = `${refA.slice(0, 20)}T${refA.slice(21)}`;
    const result = applyGeneClassification(refA, null, {
      A: [{ gene: 'A', target: 'T1', ref_window: refA, homoeolog_group: 'H1', cut_index_in_window: 20 }],
      B: [{ gene: 'B', target: 'T1', ref_window: refB, homoeolog_group: 'H1', cut_index_in_window: 20 }],
    }, 20, 0.10);

    expect(result.assigned).toBe(true);
    expect(result.predicted_gene).toBe('A');
  });

  it('keeps an exact homoeolog score tie ambiguous', () => {
    const ref = 'AACCGGTTAACCGGTTAACCGGTTAACCGGTTAACCGGTT';
    const result = applyGeneClassification(ref, null, {
      A: [{ gene: 'A', target: 'T1', ref_window: ref, homoeolog_group: 'H1', cut_index_in_window: 20 }],
      B: [{ gene: 'B', target: 'T1', ref_window: ref, homoeolog_group: 'H1', cut_index_in_window: 20 }],
    }, 20, 0.10);

    expect(result.assigned).toBe(false);
    expect(result.reason).toBe('ambiguous');
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
