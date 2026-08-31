import { describe, expect, it } from 'vitest';
import { FastqRead } from '../fastq-parser';
import { reverseComplement, extractWindow, findGrnaCutSite } from '../classifier';
import { GenePayload } from '../multi-reference-assigner';
import {
  buildIlluminaPseudoReads,
  combineIlluminaMateScores,
  fastqReadsToString,
  preprocessIlluminaReads,
  selectIlluminaConsensusEvidence,
  suggestIlluminaAlignment,
} from '../illumina-preprocessor';

const prefix = 'TACGCTAGCATGACCTGATCGTACGATCGTACGCTAGCTA';
const grna = 'GATTACAGATTACAGATTAC';
const reference = `${prefix}${grna}AGGCGTACGATCGATGCTAGCTACGATCGTACGATCGTAGCTAGCTACGATCG`;
const windowSize = 60;
const cut = findGrnaCutSite(reference, grna);
const targetWindow = extractWindow(reference, cut.cut_site, windowSize);
const genes: GenePayload[] = [{
  gene: 'GeneA',
  sequence: reference,
  targets: [{ target_id: 'TargetA', sgrna_seq: grna, window_size: windowSize }],
}];

function read(seq: string, quality = 35, id = 'molecule/1'): FastqRead {
  return { id, seq, qual: new Array(seq.length).fill(quality) };
}

function preprocess(r1: FastqRead[] | null, r2: FastqRead[] | null) {
  return preprocessIlluminaReads(r1, r2, genes, { windowSize, phredThreshold: 20 });
}

describe('Illumina paired-end preprocessing', () => {
  it('builds the stage-1 R1 + X guard + R2 reverse-complement FASTQ representation', () => {
    const r1 = read('AACCGG', 32, 'pair/1');
    const r2 = read('AAGTCC', 37, 'pair/2');
    const pseudo = buildIlluminaPseudoReads([r1], [r2], 4);
    expect(pseudo[0].seq).toBe(`AACCGGXXXX${reverseComplement('AAGTCC')}`);
    expect(pseudo[0].qual.slice(6, 10)).toEqual([0, 0, 0, 0]);
    expect(fastqReadsToString(pseudo)).toContain('!!!!');
  });

  it('keeps a stage-1 single mate unchanged except for R2 orientation', () => {
    expect(buildIlluminaPseudoReads([read('AACCGG')], null, 10)[0].seq).toBe('AACCGG');
    expect(buildIlluminaPseudoReads(null, [read('AACCGG')], 10)[0].seq).toBe(reverseComplement('AACCGG'));
  });

  it('attaches the dominant validated reference/window for Sequence Viewer auto-alignment', () => {
    const pseudo = buildIlluminaPseudoReads(
      [read(targetWindow, 35, 'pair/1')],
      [read(reverseComplement(targetWindow), 35, 'pair/2')],
      windowSize
    );
    const hint = suggestIlluminaAlignment(pseudo, genes, { windowSize, phredThreshold: 20 });
    expect(hint).toMatchObject({
      gene: 'GeneA',
      targetId: 'TargetA',
      refSeq: reference,
      grnaSeq: grna,
      winSize: windowSize,
      windowSeq: targetWindow,
    });
  });

  it('uses the observed mate score directly and averages two observed mate scores', () => {
    expect(combineIlluminaMateScores(0.82, null)).toBe(0.82);
    expect(combineIlluminaMateScores(null, 0.76)).toBe(0.76);
    expect(combineIlluminaMateScores(0.82, 0.76)).toBeCloseTo(0.79);
    expect(combineIlluminaMateScores(null, null)).toBeNull();
  });

  it('selects the highest-scoring window rather than the first configured window', () => {
    const selected = selectIlluminaConsensusEvidence([
      { key: 'GeneA\0TargetA', gene: 'GeneA', targetId: 'TargetA', r1Score: 0.7, r2Score: 0.7 },
      { key: 'GeneB\0TargetB', gene: 'GeneB', targetId: 'TargetB', r1Score: 0.94, r2Score: 0.9 },
    ], 0.05);
    expect(selected?.gene).toBe('GeneB');
    expect(selected?.targetId).toBe('TargetB');
  });

  it('keeps mates separate when competing gene scores are within the margin', () => {
    const selected = selectIlluminaConsensusEvidence([
      { key: 'GeneA\0TargetA', gene: 'GeneA', targetId: 'TargetA', r1Score: 0.9, r2Score: null },
      { key: 'GeneB\0TargetB', gene: 'GeneB', targetId: 'TargetB', r1Score: 0.88, r2Score: 0.88 },
    ], 0.05);
    expect(selected).toBeNull();
  });

  it('keeps mates separate when target windows within the winning gene are tied', () => {
    const selected = selectIlluminaConsensusEvidence([
      { key: 'GeneA\0TargetA', gene: 'GeneA', targetId: 'TargetA', r1Score: 0.91, r2Score: 0.89 },
      { key: 'GeneA\0TargetB', gene: 'GeneA', targetId: 'TargetB', r1Score: 0.9, r2Score: 0.9 },
    ], 0.05);
    expect(selected).toBeNull();
  });

  it('keeps an X-guarded pseudo-read when R1 passes and R2 fails', () => {
    const result = preprocess([read(targetWindow)], [read('A'.repeat(60), 35, 'molecule/2')]);
    expect(result.reads).toHaveLength(1);
    expect(result.reads[0].seq).toContain('X'.repeat(windowSize));
  });

  it('keeps an X-guarded pseudo-read when R2 passes and R1 fails', () => {
    const result = preprocess([read('A'.repeat(60))], [read(reverseComplement(targetWindow), 35, 'molecule/2')]);
    expect(result.reads).toHaveLength(1);
    expect(result.stats.paddedMolecules).toBe(1);
  });

  it('merges agreeing mates into one continuous consensus with the higher quality', () => {
    const result = preprocess([read(targetWindow, 30)], [read(reverseComplement(targetWindow), 38, 'molecule/2')]);
    expect(result.reads[0].seq).toBe(targetWindow);
    expect(result.reads[0].qual.every(q => q === 38)).toBe(true);
    expect(result.stats.consensusMolecules).toBe(1);
  });

  it('resolves a disagreement in favor of the higher-Phred base', () => {
    const index = Math.floor(targetWindow.length / 2);
    const alternative = targetWindow[index] === 'A' ? 'C' : 'A';
    const mutated = `${targetWindow.slice(0, index)}${alternative}${targetWindow.slice(index + 1)}`;
    const result = preprocess([read(mutated, 36)], [read(reverseComplement(targetWindow), 25, 'molecule/2')]);
    expect(result.reads[0].seq[index]).toBe(alternative);
    expect(result.reads[0].qual[index]).toBe(36);
  });

  it('aligns an indel before resolving the remainder of the overlap', () => {
    const index = Math.floor(targetWindow.length / 2);
    const inserted = `${targetWindow.slice(0, index)}A${targetWindow.slice(index)}`;
    const result = preprocess([read(inserted, 36)], [read(reverseComplement(targetWindow), 25, 'molecule/2')]);
    expect(result.reads[0].seq).toBe(inserted);
    expect(result.reads[0].seq.slice(index + 1)).toBe(targetWindow.slice(index));
  });

  it('filters a pair when neither mate passes', () => {
    const result = preprocess([read('A'.repeat(60))], [read('C'.repeat(60), 35, 'molecule/2')]);
    expect(result.reads).toHaveLength(0);
    expect(result.stats.filteredMolecules).toBe(1);
    expect(result.diagnostics.filteredMolecules).toEqual([expect.objectContaining({
      recordNumber: 1,
      readId: 'molecule/1',
      r1Reason: 'no_alignment',
      r2Reason: 'no_alignment',
      reason: 'no_alignment',
    })]);
    expect(result.diagnostics.reasonCounts.no_alignment).toBe(1);
  });

  it('reports low quality as the Stage 1 to Stage 2 filtering reason', () => {
    const result = preprocess([read(targetWindow, 5)], [read(reverseComplement(targetWindow), 5, 'molecule/2')]);
    expect(result.stats.filteredMolecules).toBe(1);
    expect(result.diagnostics.filteredMolecules[0]).toMatchObject({
      r1Reason: 'quality',
      r2Reason: 'quality',
      reason: 'quality',
    });
    expect(result.diagnostics.reasonCounts.quality).toBe(1);
  });

  it('passes through a single R1 file', () => {
    expect(preprocess([read(targetWindow)], null).reads[0].seq).toBe(targetWindow);
  });

  it('reverse-complements a single R2 file and reverses its quality', () => {
    const r2 = read(reverseComplement(targetWindow));
    r2.qual = r2.qual.map((_, i) => i);
    const normalized = preprocess(null, [r2]).reads[0];
    expect(normalized.seq).toBe(targetWindow);
    expect(normalized.qual[0]).toBe(r2.qual[r2.qual.length - 1]);
  });

  it('rejects mismatched paired read identifiers', () => {
    expect(() => preprocess(
      [read(targetWindow, 35, 'read-one/1')],
      [read(reverseComplement(targetWindow), 35, 'read-two/2')]
    )).toThrow(/record mismatch/i);
  });
});
