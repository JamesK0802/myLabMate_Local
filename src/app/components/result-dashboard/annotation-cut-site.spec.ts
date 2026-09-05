import { describe, expect, it } from 'vitest';
import { resolveAnnotationCutSite } from './annotation-cut-site';

describe('annotation cut-site marker', () => {
  it('uses the adjacent downstream PAM for a spacer-only forward input', () => {
    const spacer = 'GTTCAGACAAGGCCGGA';
    expect(resolveAnnotationCutSite({
      ref_sequence: 'AAAA' + spacer + 'TGG' + 'CCCC',
      display_sgrna_seq: spacer,
      grna_start_index: 4,
      strand: 'forward',
      cut_site_index: 999,
    })).toBe(4 + spacer.length - 3);
  });

  it('does not count an included terminal PAM as part of the spacer', () => {
    const spacerWithPam = 'GTTCAGACAAGGCCGGAAAAAATGG';
    expect(resolveAnnotationCutSite({
      ref_sequence: 'AAAA' + spacerWithPam + 'CCCC',
      display_sgrna_seq: spacerWithPam,
      grna_start_index: 4,
      strand: 'forward',
      cut_site_index: 4 + spacerWithPam.length - 3,
    })).toBe(4 + spacerWithPam.length - 6);
  });

  it('uses a left-side CCN PAM for a reverse spacer', () => {
    const spacer = 'GTTCAGACAAGGCCGGA';
    expect(resolveAnnotationCutSite({
      ref_sequence: 'AAA' + 'CCA' + spacer + 'TTTT',
      display_sgrna_seq: spacer,
      grna_start_index: 6,
      strand: 'reverse',
      is_rc: true,
    })).toBe(9);
  });

  it('falls back to the saved analysis coordinate when no display PAM can be resolved', () => {
    expect(resolveAnnotationCutSite({
      ref_sequence: 'AAAAGTTCAGACAATTTT',
      display_sgrna_seq: 'GTTCAGACAA',
      grna_start_index: 4,
      cut_site_index: 11,
    })).toBe(11);
  });
});
