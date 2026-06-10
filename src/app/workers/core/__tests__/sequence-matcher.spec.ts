import { describe, it, expect } from 'vitest';
import { SequenceMatcher } from '../sequence-matcher';

describe('SequenceMatcher', () => {
  it('should handle empty strings', () => {
    const matcher = new SequenceMatcher(null, '', '');
    expect(matcher.ratio()).toBe(1.0);
    expect(matcher.getOpcodes()).toEqual([]);
  });

  it('should handle identical strings', () => {
    const matcher = new SequenceMatcher(null, 'ABC', 'ABC');
    expect(matcher.ratio()).toBe(1.0);
    expect(matcher.getOpcodes()).toEqual([
      ['equal', 0, 3, 0, 3]
    ]);
  });

  it('should match Python difflib get_opcodes output for basic diffs', () => {
    // Python: SequenceMatcher(None, 'abcd', 'bcde').get_opcodes()
    // [('delete', 0, 1, 0, 0), ('equal', 1, 4, 0, 3), ('insert', 4, 4, 3, 4)]
    const matcher = new SequenceMatcher(null, 'abcd', 'bcde');
    expect(matcher.getOpcodes()).toEqual([
      ['delete', 0, 1, 0, 0],
      ['equal', 1, 4, 0, 3],
      ['insert', 4, 4, 3, 4]
    ]);
  });

  it('should handle complex alignment replacement', () => {
    // Python: SequenceMatcher(None, 'qabxcd', 'abycdf').get_opcodes()
    // [('delete', 0, 1, 0, 0), ('equal', 1, 3, 0, 2), ('replace', 3, 4, 2, 3), ('equal', 4, 6, 3, 5), ('insert', 6, 6, 5, 6)]
    const matcher = new SequenceMatcher(null, 'qabxcd', 'abycdf');
    expect(matcher.getOpcodes()).toEqual([
      ['delete', 0, 1, 0, 0],
      ['equal', 1, 3, 0, 2],
      ['replace', 3, 4, 2, 3],
      ['equal', 4, 6, 3, 5],
      ['insert', 6, 6, 5, 6]
    ]);
  });

  it('should compute the correct ratio', () => {
    const matcher = new SequenceMatcher(null, 'abcd', 'bcde');
    // matches: 'bcd' (length 3). Total length: 4 + 4 = 8.
    // ratio: 2 * 3 / 8 = 0.75
    expect(matcher.ratio()).toBe(0.75);
  });
});
