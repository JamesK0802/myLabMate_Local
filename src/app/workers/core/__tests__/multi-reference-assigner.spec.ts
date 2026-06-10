import { describe, it, expect } from 'vitest';
import { assignReadsToReferences } from '../multi-reference-assigner';

describe('Multi-Reference Assigner', () => {
  it('should demux and assign reads to correct genes based on scoring', () => {
    // Reference sequences with different content so their k-mer scores will be distinct
    const refA = 'ATCG'.repeat(25); // 100 bp of ATCG
    const refB = 'GGCC'.repeat(25); // 100 bp of GGCC

    const genePayloads = [
      {
        gene: 'GeneA',
        sequence: refA,
        targets: [{ target_id: 'targetA', sgrna_seq: 'ATCGATCGATCGATCGATCG', window_size: 40 }]
      },
      {
        gene: 'GeneB',
        sequence: refB,
        targets: [{ target_id: 'targetB', sgrna_seq: 'GGCCGGCCGGCCGGCCGGCC', window_size: 40 }]
      }
    ];

    // Read A matches refA target window
    const readA = 'ATCG'.repeat(10); // 40bp
    // Read B matches refB target window
    const readB = 'GGCC'.repeat(10); // 40bp

    const readsData: Array<[string, number[] | null]> = [
      [readA, null],
      [readB, null]
    ];

    const result = assignReadsToReferences(readsData, genePayloads, 10, 0.05);

    expect(result.genes).toHaveLength(2);

    const bucketA = result.genes.find(g => g.gene === 'GeneA')!;
    const bucketB = result.genes.find(g => g.gene === 'GeneB')!;

    expect(bucketA.count).toBe(1);
    expect(bucketA.assigned_reads[0].seq).toBe(readA);

    expect(bucketB.count).toBe(1);
    expect(bucketB.assigned_reads[0].seq).toBe(readB);

    expect(result.ambiguous_reads).toHaveLength(0);
  });
});
