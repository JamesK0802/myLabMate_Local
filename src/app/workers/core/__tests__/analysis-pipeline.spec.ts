import { describe, it, expect } from 'vitest';
import { processFile, buildFinalPayload } from '../analysis-pipeline';
import { FastqRead } from '../fastq-parser';
import { GenePayload } from '../multi-reference-assigner';

describe('Analysis Pipeline End-to-End', () => {
  it('should run a complete local analysis on a set of mock reads', () => {
    // 100 bp references
    const refA = 'ATCG'.repeat(25);
    const refB = 'GGCC'.repeat(25);

    const genesPayload: GenePayload[] = [
      {
        gene: 'GeneA',
        sequence: refA,
        // target cut site is 17
        targets: [{ target_id: 'targetA', sgrna_seq: 'ATCGATCGATCGATCGATCG', window_size: 40 }]
      },
      {
        gene: 'GeneB',
        sequence: refB,
        // target cut site is 17
        targets: [{ target_id: 'targetB', sgrna_seq: 'GGCCGGCCGGCCGGCCGGCC', window_size: 40 }]
      }
    ];

    // Read 1: Perfect match for GeneA target (60bp)
    const read1: FastqRead = {
      seq: 'ATCG'.repeat(15),
      qual: new Array(60).fill(40)
    };

    // Read 2: Match for GeneA target but with a 1bp deletion (59bp)
    const read2: FastqRead = {
      seq: 'ATCG'.repeat(7) + 'ATCG'.repeat(8).substring(1),
      qual: new Array(59).fill(40)
    };

    // Read 3: Perfect match for GeneB target (60bp)
    const read3: FastqRead = {
      seq: 'GGCC'.repeat(15),
      qual: new Array(60).fill(40)
    };

    const reads = [read1, read2, read3];
    const params = {
      phredThreshold: 10,
      indelThreshold: 0.1, // very low to not filter
      marginThreshold: 0.05,
      windowSize: 40
    };

    const fileResult = processFile('test.fastq', reads, genesPayload, params);

    expect(fileResult.fastq_file).toBe('test.fastq');
    expect(fileResult.multi_reference_result.genes).toHaveLength(2);

    const geneARes = fileResult.multi_reference_result.genes.find(g => g.gene === 'GeneA')!;
    const geneBRes = fileResult.multi_reference_result.genes.find(g => g.gene === 'GeneB')!;

    // Gene A has 2 reads assigned
    expect(geneARes.assigned_read_count).toBe(2);
    // Gene B has 1 read assigned
    expect(geneBRes.assigned_read_count).toBe(1);

    // Verify metadata payload builder
    const finalPayload = buildFinalPayload([fileResult], genesPayload, params, ['test.fastq']);
    expect(finalPayload.metadata.phred_threshold).toBe(10);
    expect(finalPayload.results[0].fastq_file).toBe('test.fastq');
  });
});
