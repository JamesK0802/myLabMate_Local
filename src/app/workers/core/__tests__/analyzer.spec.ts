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
});
