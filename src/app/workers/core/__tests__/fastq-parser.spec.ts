import { describe, it, expect } from 'vitest';
import { parseFastqString } from '../fastq-parser';

describe('FastqParser', () => {
  it('should parse a single FASTQ record', () => {
    const fastqText = `@SRR001.1 length=4
ACTG
+
IIII`;
    const reads = parseFastqString(fastqText);
    expect(reads).toHaveLength(1);
    expect(reads[0].seq).toBe('ACTG');
    // 'I' has ASCII code 73. 73 - 33 = 40.
    expect(reads[0].qual).toEqual([40, 40, 40, 40]);
  });

  it('should parse multiple FASTQ records and handle blank/empty lines', () => {
    const fastqText = `
@SRR001.1
ACTG
+
!!!!

@SRR001.2
GATC
+
I!I!
`;
    const reads = parseFastqString(fastqText);
    expect(reads).toHaveLength(2);
    expect(reads[0].seq).toBe('ACTG');
    expect(reads[0].qual).toEqual([0, 0, 0, 0]);
    expect(reads[1].seq).toBe('GATC');
    expect(reads[1].qual).toEqual([40, 0, 40, 0]);
  });

  it('should ignore incomplete records at the end', () => {
    const fastqText = `@SRR001.1
ACTG
+`;
    const reads = parseFastqString(fastqText);
    expect(reads).toHaveLength(0);
  });
});
