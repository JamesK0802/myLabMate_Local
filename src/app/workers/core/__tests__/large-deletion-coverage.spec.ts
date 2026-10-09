import {describe, it, expect} from 'vitest';
import {processFile} from '../analysis-pipeline';

// Observed TT4 junctions traced to both original mates of SRR26820312.
const reference = 'GTGCTTACATGGCTCCTTCTCTGGACACCAGACAGGACATCGTGGTGGTCGAAGTCCCTAAGCTAGGCAAAGAAGCGGCAGTGAAGGCCATCAAGGAGTGGGGCCAGCCCAAGTCAAAGATCACTCATGTCGTCTTCTGCACTACCTCCGGCGTCGACATGCCTGGTGCTGACTACCAGCTCACCAAGCTTCTTGGTCTCCGTCCTTCCGTCAAGCGTCTCATGATGTACCAGCAAGGTTGCTTCGCCGGCGGTACTGTCCTCCGTATCGCTAAGGATCTCGCCGAGAACAATCGTGGAGCACGTGTCCTCGTTGTCTGCTCTGAGATCACAGCCGTTACCTTCCGTGGTCCCTCTGACACCCACCTTGACTCCCTCGTCGGTCAGGCTCTTTTCAGTGATGGCGCCGCCGCACTCATTGTGGGGTCGGACCCTGACACATCTGTCGGAGAGAAACCCATCTTTGA';
const examples = [
  {net: -343, seq: 'CCTCAAGGAAAACCCACACATGTGTGCTTACATGGCTCCTTCTCTGGACACCAGACAGGACATCGTGGTGGTCGAAGTCCCTAAGCTAGGCAAAGAAGCGGCAGTGAAGTCCCTGACACATCTGTCGGAGAGAAACCCATCTTTGAGATGGTGTCTGCCGC'},
  {net: -375, seq: 'CCTCAAGGAAAACCCACACATGTGTGCTTACATGGCTCCTTCTCTGGACACCAGACAGGACATCGTGGTGGTCGAAGTCCCTGACACATCTGTCGGAGAGAAACCCATCTTTGAGATGGTGTCTGCCGC'},
];

describe('Large-deletion two-flank coverage in the production pipeline', () => {
  for (const platform of ['illumina', 'nanopore'] as const) {
    for (const window of [450, 466]) {
      it(`recovers continuous observed junctions in ${platform} at ${window} bp`, () => {
        const result = processFile('observed-junctions', examples.map(e => ({seq:e.seq,qual:new Uint8Array(e.seq.length).fill(40)})),
          [{gene:'TT4',sequence:reference,targets:[{target_id:'sgRNA-TT4',sgrna_seq:'CGTCTCATGATGTACCAGCA',window_size:window}]}],
          {windowSize:window,phredThreshold:20,indelThreshold:0,marginThreshold:.1,sequencingPlatform:platform});
        const t = result.multi_reference_result.genes[0].analysis_result.targets[0];
        expect(t.summary.aligned_reads).toBe(2);
        expect(t.top_groups.map(g => g.net_indel).sort()).toEqual([-343,-375].sort());
        for (const g of t.top_groups) {
          expect(g.tokens.filter(t => t.type==='delete')).toHaveLength(1);
          expect(g.tokens.filter(t => t.type==='insert')).toHaveLength(0);
          expect(g.tokens.filter(t => t.type==='unobserved')).toHaveLength(0);
        }
      });
    }
  }
});
