import { describe, expect, it } from 'vitest';
import {
  createIlluminaFilePairs,
  displayIlluminaPairName,
  moveIlluminaMate,
  parseIlluminaFilename,
} from '../../../models/illumina.model';

function fq(name: string): File {
  return new File(['@read\nACGT\n+\nIIII\n'], name, { type: 'text/plain' });
}

describe('Illumina filename pairing', () => {
  it.each([
    ['barcode83_R1.fastq', 'barcode83_R2.fastq'],
    ['barcode83-R1.fq', 'barcode83-R2.fq'],
    ['Barcode-1.fq', 'Barcode-2.fq'],
    ['Barcode_1.fq', 'Barcode_2.fq'],
    ['sampleA_R1_001.fastq.gz', 'sampleA_R2_001.fastq.gz'],
  ])('automatically matches %s and %s', (r1Name, r2Name) => {
    const pairs = createIlluminaFilePairs([fq(r1Name), fq(r2Name)], () => 'pair-1');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].r1?.name).toBe(r1Name);
    expect(pairs[0].r2?.name).toBe(r2Name);
  });

  it('does not aggressively guess mate-less filenames', () => {
    const pairs = createIlluminaFilePairs([fq('alpha.fastq'), fq('beta.fastq')]);
    expect(pairs).toHaveLength(2);
    expect(pairs.every(pair => pair.r1 && !pair.r2)).toBe(true);
  });

  it('creates multiple independent pairs in one upload', () => {
    const pairs = createIlluminaFilePairs([
      fq('barcode83_R1.fastq'), fq('barcode84_R2.fastq'),
      fq('barcode83_R2.fastq'), fq('barcode84_R1.fastq'),
    ]);
    expect(pairs).toHaveLength(2);
    expect(pairs.every(pair => pair.r1 && pair.r2)).toBe(true);
  });

  it('uses a friendly sample name without the mate token', () => {
    expect(parseIlluminaFilename('barcode83_R1.fastq').sampleName).toBe('Barcode 83');
  });

  it('keeps the exact filename in the compact UI for a single mate', () => {
    expect(displayIlluminaPairName({
      name: 'Barcode',
      r1: fq('Barcode-1.fq'),
      r2: null,
    })).toBe('Barcode-1.fq');
  });

  it('manually swaps files between cards and mate slots', () => {
    const pairs = createIlluminaFilePairs([
      fq('alpha_R1.fastq'), fq('alpha_R2.fastq'),
      fq('beta_R1.fastq'), fq('beta_R2.fastq'),
    ], (() => { let id = 0; return () => `pair-${++id}`; })());
    const moved = moveIlluminaMate(pairs, 'pair-1', 'r2', 'pair-2', 'r1');
    expect(moved[0].r2?.name).toBe('beta_R1.fastq');
    expect(moved[1].r1?.name).toBe('alpha_R2.fastq');
    expect(moved[0].name).toContain('+');
  });
});
