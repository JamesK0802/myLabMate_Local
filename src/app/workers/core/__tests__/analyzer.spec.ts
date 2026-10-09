import { describe, it, expect } from 'vitest';
import { alignReadToRefXaware, classifyMutationWithAlignment } from '../analyzer';

describe('Analyzer Alignment Core', () => {
  it('should align identical sequences as equal', () => {
    const ref = 'ACTG';
    const read = 'ACTG';
    const tokens = alignReadToRefXaware(ref, read);
    expect(tokens).toEqual([
      { type: 'equal', val: 'ACTG' }
    ]);
  });

  it('should identify substitutions', () => {
    const ref = 'ACTG';
    const read = 'ACAG';
    const tokens = alignReadToRefXaware(ref, read);
    expect(tokens).toEqual([
      { type: 'equal', val: 'AC' },
      { type: 'substitute', val: 'A' },
      { type: 'equal', val: 'G' }
    ]);
  });

  it('should identify biological insertions and deletions', () => {
    // Insertion:
    // ref:  AC-TG
    // read: ACATG
    const tokensIns = alignReadToRefXaware('ACTG', 'ACATG');
    expect(tokensIns).toEqual([
      { type: 'equal', val: 'AC' },
      { type: 'insert', val: 'A' },
      { type: 'equal', val: 'TG' }
    ]);

    // Deletion (internal):
    // ref:  ACATG
    // read: AC-TG
    const tokensDel = alignReadToRefXaware('ACATG', 'ACTG');
    expect(tokensDel).toEqual([
      { type: 'equal', val: 'AC' },
      { type: 'delete', val: '-' },
      { type: 'equal', val: 'TG' }
    ]);
  });

  it('should mark terminal deletions as unobserved when truncation is present', () => {
    // Truncated on left: ref starts with AG, but read is missing it (delete at start)
    // ref:  AGACTG
    // read: --ACTG
    const tokens = alignReadToRefXaware('AGACTG', 'ACTG', 2, 0);
    expect(tokens).toEqual([
      { type: 'unobserved', val: 'XX' },
      { type: 'equal', val: 'ACTG' }
    ]);
  });

  it('should preserve an observed deletion while ignoring an internal X gap', () => {
    const ref = 'GTGCTTACATGGCTCCTTCTCTGGACACCAGACAGGACATCGTGGTGGTCGAAGTCCCTA';
    const leftObserved = ref.substring(0, 12) + ref.substring(15, 36); // observed 3 bp deletion
    const rightObserved = ref.substring(48);
    const read = leftObserved + 'X'.repeat(120) + rightObserved;
    const result = classifyMutationWithAlignment(ref, read);

    expect(result.net_indel).toBe(-3);
    expect(result.category).toBe('in_frame');
    expect(result.tokens.some(token => token.type === 'unobserved')).toBe(true);
  });

  it('trims paired-read overhang and keeps an internal X gap unobserved at larger windows', () => {
    const ref = 'AACCGGTTAGCTAGGCTAACCGTACGATCGTACCTGACTGATCGTAGCTAGCATGCTACGATCGGATCCGATGCTAGCTAGGCTAACGTTACGATCGATGGCATCGTAGCTAGCATCGATGCTAGGCTAACCGATCGTAGCATGCTAGCATCGATGCTAACGATCGTAGCTAGCATGCTAGCATCGATGCTAGCATCGATGCTAACG';
    const leftMate = 'TTTTTT' + ref.substring(0, 92);
    const rightMate = ref.substring(126) + 'AAAAAA';
    for (const paddingLength of [120, 216]) {
      const read = leftMate + 'X'.repeat(paddingLength) + rightMate;
      const result = classifyMutationWithAlignment(ref, read);

      expect(result.category).toBe('no_indel');
      expect(result.net_indel).toBe(0);
      expect(result.has_sub).toBe(false);
      expect(result.tokens.some(token => token.type === 'unobserved')).toBe(true);
    }
  });

  it('places 301-bp X-padded mates without DNA autojunk suppressing all matches', () => {
    const ref = 'AACCGGTTAGCTAGGCTAACCGTACGATCGTACCTGACTGATCGTAGCTAGCATGCTACGATCGGATCCGATGCTAGCTAGGCTAACGTTACGATCGATGGCATCGTAGCTAGCATCGATGCTAGGCTAACCGATCGTAGCATGCTAGCATCGATGCTAACGATCGTAGCTAGCATGCTAGCATCGATGCTAGCATCGATGCTAACG';
    const read = 'T'.repeat(301 - ref.length) + ref + 'X'.repeat(216) + ref + 'A'.repeat(301 - ref.length);
    const result = classifyMutationWithAlignment(ref, read);

    expect(result.category).toBe('no_indel');
    expect(result.net_indel).toBe(0);
    expect(result.tokens.some(token => token.type === 'equal')).toBe(true);
  });

  it('does not turn the remainder of a 216-bp DNA window into substitutions after one edit', () => {
    const ref = 'TCATGTCGTCTTCTGCACTACCTCCGGCGTCGACATGCCTGGTGCTGACTACCAGCTCACCAAGCTTCTTGGTCTCCGTCCTTCCGTCAAGCGTCTCATGATGTACCAGCAAGGTTGCTTCGCCGGCGGTACTGTCCTCCGTATCGCTAAGGATCTCGCCGAGAACAATCGTGGAGCACGTGTCCTCGTTGTCTGCTCTGAGATCACAGCCGTTAC';
    const deletion = ref.substring(0, 108) + ref.substring(109);
    const insertion = ref.substring(0, 108) + 'A' + ref.substring(108);

    const deletionResult = classifyMutationWithAlignment(ref, deletion);
    expect(deletionResult.net_indel).toBe(-1);
    expect(deletionResult.has_sub).toBe(false);
    expect(deletionResult.tokens.filter(token => token.type === 'delete')
      .reduce((sum, token) => sum + token.val.length, 0)).toBe(1);

    const insertionResult = classifyMutationWithAlignment(ref, insertion);
    expect(insertionResult.net_indel).toBe(1);
    expect(insertionResult.has_sub).toBe(false);
    expect(insertionResult.tokens.filter(token => token.type === 'insert')
      .reduce((sum, token) => sum + token.val.length, 0)).toBe(1);
  });

  it('does not concatenate competing overlap-failed mates into compound indels', () => {
    const ref = 'TGCACTACCTCCGGCGTCGACATGCCTGGTGCTGACTACCAGCTCACCAAGCTTCTTGGTCTCCGTCCTTCCGTCAAGCGTCTCATGATGTACCAGCAAGGTTGCTTCGCCGGCGGTACTGTCCTCCGTATCGCTAAGGATCTCGCCGAGAACAATCGTGGAGCACGTGTCCTCGTTGTCTGAGA';
    const strongerMate = 'PRIMER'.replace(/[^ACGT]/g, 'A') + ref.substring(0, 125);
    const weakerOverlappingMate = ref.substring(100, 160) + 'ACACACACACACACACACACACACACACAC';
    const result = classifyMutationWithAlignment(
      ref,
      strongerMate + 'X'.repeat(190) + weakerOverlappingMate,
    );

    expect(result.net_indel).toBe(0);
    expect(result.tokens.every(token => token.type !== 'insert' && token.type !== 'delete')).toBe(true);
    expect(result.tokens.some(token => token.type === 'unobserved')).toBe(true);
  });

  it('should classify mutations correctly', () => {
    // No indel (pure substitution)
    const resNoIndel = classifyMutationWithAlignment('ACTG', 'ACAG');
    expect(resNoIndel.category).toBe('no_indel');
    expect(resNoIndel.has_sub).toBe(true);
    expect(resNoIndel.net_indel).toBe(0);

    // In-frame indel (net length divisible by 3, e.g. 3bp deletion)
    // ref:  ACAAATG
    // read: AC---TG
    const resInFrame = classifyMutationWithAlignment('ACAAATG', 'ACTG');
    expect(resInFrame.category).toBe('in_frame');
    expect(resInFrame.net_indel).toBe(-3);

    // Out-of-frame indel (e.g. 1bp deletion)
    // ref:  ACATG
    // read: ACTG
    const resOutOfFrame = classifyMutationWithAlignment('ACATG', 'ACTG');
    expect(resOutOfFrame.category).toBe('out_of_frame');
    expect(resOutOfFrame.net_indel).toBe(-1);
  });

  it('recovers short genuine matches inside the YCO replacement interval', () => {
    const ref = 'AAAATGGTGTTTTAGGTACGCAAGTGAAAAATACTGTTGAGATTGGAGTTGTTGAGGATCCGATGGAAGCTGAGGTTGCTCAAGGCTACACGATGGCTCAGTTCTGCGACAAGATCATCG';
    const read = 'AAAATGGTGTTTTAGGTACGCAAGTGAAAAATACTGTTGAGATTGGAGTTGTTGAGGATCACGATGGAGGCTGGGGTTGCTCAAGGCTACACGATGGCTCAGTTCTGCGACAAGATCATCG';
    const result = classifyMutationWithAlignment(ref, read);
    const editedBases = result.tokens.filter(t => ['insert', 'delete', 'substitute'].includes(t.type))
      .reduce((sum, t) => sum + t.val.length, 0);
    expect(editedBases).toBe(3);
    expect(result.net_indel).toBe(1);
    expect(result.tokens.filter(t => t.type === 'substitute').reduce((sum, t) => sum + t.val.length, 0)).toBe(2);
    expect(result.tokens.some(t => t.type === 'equal' && t.val.length > 0 && t.val.length < 10)).toBe(true);
  });

  it('uses the same replacement correction in a terminal X-padded read', () => {
    const ref = 'AAAATGGTGTTTTAGGTACGCAAGTGAAAAATACTGTTGAGATTGGAGTTGTTGAGGATCCGATGGAAGCTGAGGTTGCTCAAGGCTACACGATGGCTCAGTTCTGCGACAAGATCATCG';
    const read = 'AAAATGGTGTTTTAGGTACGCAAGTGAAAAATACTGTTGAGATTGGAGTTGTTGAGGATCACGATGGAGGCTGGGGTTGCTCAAGGCTACACGATGGCTCAGTTCTGCGACAAGATCATCG';
    const result = classifyMutationWithAlignment('TTGAC' + ref, 'XXXXX' + read, 5);
    expect(result.net_indel).toBe(1);
    expect(result.tokens.filter(t => ['insert', 'delete', 'substitute'].includes(t.type))
      .reduce((sum, t) => sum + t.val.length, 0)).toBe(3);
    expect(result.tokens[0]).toEqual({ type: 'unobserved', val: 'XXXXX' });
  });

  it('keeps a genuine large deletion contiguous rather than matching incidental bases', () => {
    const ref = 'TCATGTCGTCTTCTGCACTACCTCCGGCGTCGACATGCCTGGTGCTGACTACCAGCTCACCAAGCTTCTTGGTCTCCGTCCTTCCGTCAAGCGTCTCATGATGTACCAGCAAGGTTGCTTCGCCGGCGGTACTGTCCTCCGTATCGCTAAGGATCTCGCCGAGAACAATCGTGGAGCACGTGTCCTCGTTGTCTGCTCTGAGATCACAGCCGTTAC';
    const read = ref.substring(0, 72) + ref.substring(144);
    const result = classifyMutationWithAlignment(ref, read);
    expect(result.net_indel).toBe(-72);
    expect(result.has_sub).toBe(false);
    expect(result.tokens.filter(t => t.type === 'delete')).toEqual([{ type: 'delete', val: '-'.repeat(72) }]);
    expect(result.tokens.some(t => t.type === 'insert')).toBe(false);
  });

  it('preserves the observed extra sequence in the recurrent YCO +31 group', () => {
    const ref = 'AAAATGGTGTTTTAGGTACGGAAGTGAAAAATACTGTTGAGGTTGGAGTTGTTGAGGATCCGATGGAAGTTGAGGTCGCTCAAGGCTACACCATGGCTCAGTTCTGCGACAAGATCATTG';
    const read = 'AAAATGGTGTTTTAGGTACGGAAGTGAAAAATACTGTTGAGGTTGGAGTTGTTTATCCGCTGTGAGTGCTTATGACAATACACTGGATAAGATCATTGCTCAGTTCTGCACCAAGGCTACACCATGGCTCAGTTCTGCGACAAGATCATTG';
    const result = classifyMutationWithAlignment(ref, read);
    expect(result.net_indel).toBe(31);
    expect(result.tokens.filter(t => t.type !== 'delete').map(t => t.val).join('')).toBe(read);
    expect(result.tokens.filter(t => t.type !== 'insert').reduce((sum, t) => sum + t.val.length, 0)).toBe(ref.length);
  });

  it('bounds replacement refinement for long unrelated sequences', () => {
    const result = classifyMutationWithAlignment('A'.repeat(1000), 'C'.repeat(1000));
    expect(result.tokens).toEqual([{ type: 'substitute', val: 'C'.repeat(1000) }]);
    expect(result.net_indel).toBe(0);
  });
});
