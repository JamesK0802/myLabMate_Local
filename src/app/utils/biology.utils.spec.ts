import { describe, it, expect } from 'vitest';
import { reverseComplement, getGCContent, translateDNA, calculateTm } from './biology.utils';
import { findRestrictionSites, COMMON_ENZYMES } from './enzymes.utils';

describe('Biology Utils', () => {

  it('should compute reverse complement correctly', () => {
    expect(reverseComplement('ATGC')).toBe('GCAT');
    expect(reverseComplement('atgc')).toBe('gcat');
    expect(reverseComplement('NNN')).toBe('NNN');
    expect(reverseComplement('RYKMSWBDHV')).toBe('BDHVWSKMRY');
  });

  it('should compute GC content correctly', () => {
    expect(getGCContent('ATAT')).toBe(0);
    expect(getGCContent('GCGC')).toBe(100);
    expect(getGCContent('ATGC')).toBe(50);
  });

  it('should translate DNA correctly', () => {
    // ATG -> M, GCA -> A, TAA -> *
    expect(translateDNA('ATGGCATAA')).toBe('MA*');
  });

  it('should calculate Tm correctly', () => {
    // Basic test
    expect(Math.round(calculateTm('ATGCATGCATGCATGC'))).toBeGreaterThan(40);
  });
});

describe('Enzyme Utils', () => {
  it('should find restriction sites on forward strand', () => {
    // EcoRI is GAATTC
    const seq = 'CCCGAATTCCCC';
    const sites = findRestrictionSites(seq, 'linear', COMMON_ENZYMES);
    const ecori = sites.find(s => s.enzyme === 'EcoRI');
    expect(ecori).toBeDefined();
    expect(ecori?.recognitionStart).toBe(3);
    expect(ecori?.strand).toBe(1);
    expect(ecori?.cutPosition1).toBe(4);
    expect(ecori?.cutPosition2).toBe(8);
  });

  it('should find restriction sites across origin for circular plasmids', () => {
    // EcoRI is GAATTC, split across origin: GAA at end, TTC at start
    const seq = 'TTCCCCGAA'; // Origin is between AA and TT -> AATTC -> GAATTC
    const sites = findRestrictionSites(seq, 'circular', COMMON_ENZYMES);
    const ecori = sites.find(s => s.enzyme === 'EcoRI');
    expect(ecori).toBeDefined();
    expect(ecori?.recognitionStart).toBe(6);
  });

  it('should find Type IIS sites correctly (BsaI)', () => {
    // BsaI is GGTCTC (top cut 7, bottom cut 11)
    const seq = 'CCCGGTCTCCCCCCC';
    const sites = findRestrictionSites(seq, 'linear', COMMON_ENZYMES);
    const bsai = sites.find(s => s.enzyme === 'BsaI');
    expect(bsai).toBeDefined();
    expect(bsai?.strand).toBe(1);
    expect(bsai?.cutPosition1).toBe(10); // 3 + 7
    expect(bsai?.cutPosition2).toBe(14); // 3 + 11
  });
});
