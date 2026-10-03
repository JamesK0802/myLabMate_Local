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

  it('merges terminal X-padded truncated reads into a single WT group without fake indels or visible X', () => {
    const refA = 'ATCG'.repeat(25);
    const refB = 'GGCC'.repeat(25);
    const genesPayload: GenePayload[] = [
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

    // Create 3 reads of different lengths representing Illumina truncation
    // Full read (60bp), 50bp (10bp truncated at 3'), and 46bp (14bp truncated at 3')
    const fullSeq = 'ATCG'.repeat(15);
    const readFull: FastqRead = { seq: fullSeq, qual: new Array(60).fill(40) };
    const readTrunc1: FastqRead = { seq: fullSeq.substring(0, 50), qual: new Array(50).fill(40) };
    const readTrunc2: FastqRead = { seq: fullSeq.substring(0, 46), qual: new Array(46).fill(40) };

    const fileResult = processFile('trunc.fastq', [readFull, readTrunc1, readTrunc2], genesPayload, {
      phredThreshold: 10,
      indelThreshold: 0,
      marginThreshold: 0.05,
      windowSize: 40
    });

    const geneA = fileResult.multi_reference_result.genes.find(g => g.gene === 'GeneA')!;
    const target = geneA.analysis_result.targets[0];
    expect(target.summary.aligned_reads).toBe(3);
    expect(target.breakdown.no_indel).toBe(3);
    expect(target.breakdown.out_of_frame).toBe(0);
    expect(target.breakdown.in_frame).toBe(0);

    // All 3 reads of varying lengths must merge into a single WT group
    expect(target.top_groups).toHaveLength(1);
    expect(target.top_groups[0].group_rank).toBe(1);
    expect(target.top_groups[0].classification).toBe('No indel');
    expect(target.top_groups[0].read_count).toBe(3);
    // Tokens must NOT contain unobserved (X)
    expect(target.top_groups[0].tokens.every(t => t.type !== 'unobserved')).toBe(true);
  });

  it('displays all groups without capping at 10 when more than 10 groups exist', () => {
    const refA = 'ATCG'.repeat(25);
    const refB = 'GGCC'.repeat(25);
    const genesPayload: GenePayload[] = [
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

    // Create 15 distinct reads for GeneA with distinct mutations in the cut window (cut site is 17)
    // Anchors are at 0..15 and 25..40. Place mutations between 16 and 24.
    const baseSeq = 'ATCG'.repeat(15);
    const reads: FastqRead[] = [];
    // 1 WT read
    reads.push({ seq: baseSeq, qual: new Array(baseSeq.length).fill(40) });
    // 14 different mutated reads
    const letters = ['A', 'C', 'G', 'T'];
    let count = 0;
    for (let p = 17; p <= 22; p++) {
      for (const char of letters) {
        if (baseSeq[p] !== char && count < 14) {
          const mutSeq = baseSeq.substring(0, p) + char + baseSeq.substring(p + 1);
          reads.push({ seq: mutSeq, qual: new Array(mutSeq.length).fill(40) });
          count++;
        }
      }
    }

    const fileResult = processFile('multigroup.fastq', reads, genesPayload, {
      phredThreshold: 10,
      indelThreshold: 0,
      marginThreshold: 0.05,
      windowSize: 40
    });

    const geneA = fileResult.multi_reference_result.genes.find(g => g.gene === 'GeneA')!;
    const target = geneA.analysis_result.targets[0];
    expect(target.top_groups.length).toBeGreaterThan(10);
    expect(target.top_groups.length).toBe(15);
  });

  it('merges unmerged Illumina reads with X-padding across variable truncation cycles into WT group 1 without fake indels', () => {
    const ref = 'GTGCTTACATGGCTCCTTCTCTGGACACCAGACAGGACATCGTGGTGGTCGAAGTCCCTAAGCTAGGCAAAGAAGCGGCAGTGAAGGCCATCAAGGAGTGGGGCCAGCCCAAGTCAAAGATCACTCATGTCGTCTTCTGCACTACCTCCGGCGTCGACATGCCTGGTGCTGACTACCAGCTCACCAAGCTTCTTGGTCTCCGTCCTTCCGTCAAGCGTCTCATGATGTACCAGCAAGGTTGCTTCGCCGGCGGTACTGTCCTCCGTATCGCTAAGGATCTCGCCGAGAACAATCGTGGAGCACGTGTCCTCGTTGTCTGCTCTGAGATCACAGCCGTTACCTTCCGTGGTCCCTCTGACACCCACCTTGACTCCCTCGTCGGTCAGGCTCTTTTCAGTGATGGCGCCGCCGCACTCATTGTGGGGTCGGACCCTGACACATCTGTCGGAGAGAAACCCATCTTTGA';
    const genesPayload: GenePayload[] = [
      {
        gene: 'TT4',
        sequence: ref,
        targets: [{ target_id: 'sgRNA-TT4', sgrna_seq: 'CGTCTCATGATGTACCAGCA', window_size: 120 }]
      }
    ];

    // Simulate 3 WT reads ending at different cycles before 120-X padding
    const r1_wt_1 = ref.substring(0, 277) + 'X'.repeat(120) + ref.substring(300); // ends at AAGGAT
    const r1_wt_2 = ref.substring(0, 280) + 'X'.repeat(120) + ref.substring(300); // ends at AAGGATCTC
    const r1_wt_3 = ref.substring(0, 290) + 'X'.repeat(120) + ref.substring(300); // ends at AAGGATCTCGCCGAGAACA

    const reads: FastqRead[] = [
      { seq: r1_wt_1, qual: new Array(r1_wt_1.length).fill(40) },
      { seq: r1_wt_2, qual: new Array(r1_wt_2.length).fill(40) },
      { seq: r1_wt_3, qual: new Array(r1_wt_3.length).fill(40) },
    ];

    const fileResult = processFile('unmerged.fastq', reads, genesPayload, {
      phredThreshold: 10,
      indelThreshold: 0,
      marginThreshold: 0.05,
      windowSize: 120
    });

    const target = fileResult.multi_reference_result.genes[0].analysis_result.targets[0];
    expect(target.summary.aligned_reads).toBe(3);
    expect(target.breakdown.no_indel).toBe(3);
    expect(target.top_groups).toHaveLength(1);
    expect(target.top_groups[0].classification).toBe('No indel');
    expect(target.top_groups[0].read_count).toBe(3);
    expect(target.top_groups[0].tokens.every(t => t.type === 'equal')).toBe(true);
  });
});
