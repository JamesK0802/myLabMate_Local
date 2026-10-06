import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { processFile } from '../analysis-pipeline';
import type { FastqRead } from '../fastq-parser';

const ROOT = '/Users/james/Desktop/New figures';
const REFERENCE = 'GTGCTTACATGGCTCCTTCTCTGGACACCAGACAGGACATCGTGGTGGTCGAAGTCCCTAAGCTAGGCAAAGAAGCGGCAGTGAAGGCCATCAAGGAGTGGGGCCAGCCCAAGTCAAAGATCACTCATGTCGTCTTCTGCACTACCTCCGGCGTCGACATGCCTGGTGCTGACTACCAGCTCACCAAGCTTCTTGGTCTCCGTCCTTCCGTCAAGCGTCTCATGATGTACCAGCAAGGTTGCTTCGCCGGCGGTACTGTCCTCCGTATCGCTAAGGATCTCGCCGAGAACAATCGTGGAGCACGTGTCCTCGTTGTCTGCTCTGAGATCACAGCCGTTACCTTCCGTGGTCCCTCTGACACCCACCTTGACTCCCTCGTCGGTCAGGCTCTTTTCAGTGATGGCGCCGCCGCACTCATTGTGGGGTCGGACCCTGACACATCTGTCGGAGAGAAACCCATCTTTGA';
const GUIDE = 'CGTCTCATGATGTACCAGCA';

function loadFastq(path: string): FastqRead[] {
  const lines = gunzipSync(readFileSync(path)).toString('utf8').trim().split(/\r?\n/);
  const reads: FastqRead[] = [];
  for (let i = 0; i + 3 < lines.length; i += 4) {
    reads.push({
      id: lines[i].replace(/^@/, ''),
      seq: lines[i + 1].toUpperCase(),
      qual: Array.from(lines[i + 3], c => c.charCodeAt(0) - 33),
    });
  }
  return reads;
}

describe('Figure 3 production-path benchmark', () => {
  it('runs the current processFile path for every plotted window', () => {
    const reads = [
      ...loadFastq(`${ROOT}/Data/Figure3/Illumina/TREX1_consensus.fastq.gz`),
      ...loadFastq(`${ROOT}/Data/Figure3/Illumina/TREX1_xpadded.fastq.gz`),
    ];
    const rows = [];
    const diagnostics = [];
    for (const windowSize of [60, 90, 120, 150, 180, 216, 240, 270, 300, 330, 360]) {
      const result = processFile('TREX1_combined.fastq', reads, [{
        gene: 'TT4',
        sequence: REFERENCE,
        targets: [{ target_id: 'sgRNA-TT4', sgrna_seq: GUIDE, window_size: windowSize }],
      }], {
        windowSize,
        phredThreshold: 20,
        indelThreshold: 0,
        marginThreshold: 0.1,
        analyzeAmbiguous: false,
        rescueAmbiguous: false,
        cutSiteDistanceWeight: 0,
        cutSiteExclusionFlank: 0,
        sequencingPlatform: 'illumina',
      });
      const target = result.multi_reference_result.genes[0].analysis_result.targets[0];
      const deletionCounts = new Map<number, number>();
      const structure = {
        window: windowSize,
        large_deletion_reads: 0,
        single_contiguous_deletion: 0,
        multiple_deletion_blocks: 0,
        deletion_insertion_mosaic: 0,
      };
      for (const group of target.top_groups) {
        if (group.net_indel > -20) continue;
        const deletion = -group.net_indel;
        deletionCounts.set(deletion, (deletionCounts.get(deletion) || 0) + group.read_count);
        const deletions = group.tokens.filter(token => token.type === 'delete');
        const insertions = group.tokens.filter(token => token.type === 'insert');
        structure.large_deletion_reads += group.read_count;
        if (insertions.length > 0) structure.deletion_insertion_mosaic += group.read_count;
        else if (deletions.length === 1) structure.single_contiguous_deletion += group.read_count;
        else structure.multiple_deletion_blocks += group.read_count;
      }
      rows.push({
        window: windowSize,
        aligned: target.summary.aligned_reads,
        deletions: [...deletionCounts].sort((a, b) => a[0] - b[0]).map(([deletion_bp, count]) => ({ deletion_bp, reads: count })),
      });
      diagnostics.push(structure);
      writeFileSync(`${ROOT}/Figures/Figure3/Results/TREX1/window_sweep_production.json`, JSON.stringify(rows, null, 2));
      writeFileSync(`${ROOT}/Figures/Figure3/Results/TREX1/deletion_structure_production.json`, JSON.stringify(diagnostics, null, 2));
    }
    expect(rows).toHaveLength(11);
  }, 1_800_000);
});
