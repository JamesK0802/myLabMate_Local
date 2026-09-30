import { describe, expect, it } from 'vitest';
import { findHomoeologGuideSite, homoeologSimilarity, projectHomoeologPosition } from '../homoeolog';

describe('homoeolog guide matching', () => {
  it('keeps exact guide matching unchanged', () => {
    const match = findHomoeologGuideSite('AAAACCTACGTTACGTTACGTTGGTTT', 'CCTACGTTACGTTACGTT');
    expect(match.matched).toBe(true);
    expect(match.exact).toBe(true);
    expect(match.mismatches).toBe(0);
  });

  it('anchors a one-mismatch homoeolog instead of using the reference centre', () => {
    const reference = 'TAGGCCATTGACGGCAGCTGTAGTTGCTGCTGGTGGAA';
    const match = findHomoeologGuideSite(reference, 'CTACTACAGCTGCCGTCAG');
    expect(match.matched).toBe(true);
    expect(match.exact).toBe(false);
    expect(match.mismatches).toBeLessThanOrEqual(4);
    expect(match.cutSite).toBeGreaterThan(0);
  });

  it('rejects unrelated guides', () => {
    const match = findHomoeologGuideSite('A'.repeat(80), 'CGTCGTCGTCGTCGTCGTCG');
    expect(match.matched).toBe(false);
    expect(match.error).toContain('No homologous guide site');
  });
});

describe('homoeolog coordinate projection', () => {
  it('projects positions across a short insertion', () => {
    expect(projectHomoeologPosition('AAAACCCCGGGG', 'AAAACCCGGGG', 8)).not.toBeNull();
    expect(homoeologSimilarity('AAAACCCCGGGG', 'AAAACCCGGGG')).toBeGreaterThan(85);
  });
});
