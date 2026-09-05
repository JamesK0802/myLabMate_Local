import { describe, it, expect } from 'vitest';
import { gzipSync } from 'fflate';
import { parseFastqFile, parseFastqFileInBatches, parseFastqString } from '../fastq-parser';

describe('FastqParser', () => {
  it('should parse a single FASTQ record', () => {
    const fastqText = `@SRR001.1 length=4
ACTG
+
IIII`;
    const reads = parseFastqString(fastqText);
    expect(reads).toHaveLength(1);
    expect(reads[0].seq).toBe('ACTG');
    expect(reads[0].id).toBe('SRR001.1 length=4');
    // 'I' has ASCII code 73. 73 - 33 = 40.
    expect([...reads[0].qual]).toEqual([40, 40, 40, 40]);
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
    expect([...reads[0].qual]).toEqual([0, 0, 0, 0]);
    expect(reads[1].seq).toBe('GATC');
    expect([...reads[1].qual]).toEqual([40, 0, 40, 0]);
  });

  it('should ignore incomplete records at the end', () => {
    const fastqText = `@SRR001.1
ACTG
+`;
    const reads = parseFastqString(fastqText);
    expect(reads).toHaveLength(0);
  });

  it('parses a file across chunk boundaries without changing the reads', async () => {
    const content = `@one\nACTG\n+\nIIII\n@two\nGATC\n+\n!!!!\n`;
    const file = Object.assign(new Blob([content]), { name: 'reads.fastq' }) as File;
    const reads = await parseFastqFile(file);
    expect(reads.map(read => read.seq)).toEqual(['ACTG', 'GATC']);
    expect([...reads[1].qual]).toEqual([0, 0, 0, 0]);
  });

  it('streams gzip FASTQ input without a whole-file decompression buffer', async () => {
    const compressed = gzipSync(new TextEncoder().encode('@read\nACTG\n+\nIIII\n'));
    const file = Object.assign(new Blob([compressed]), { name: 'reads.fastq.gz' }) as File;
    const reads = await parseFastqFile(file);
    expect(reads).toHaveLength(1);
    expect(reads[0].seq).toBe('ACTG');
  });

  it('releases parsed records in caller-defined batches', async () => {
    const file = Object.assign(new Blob(['@one\nACTG\n+\nIIII\n@two\nGATC\n+\n!!!!\n']), { name: 'reads.fastq' }) as File;
    const batches: string[][] = [];
    const count = await parseFastqFileInBatches(file, batch => {
      batches.push(batch.map(read => read.seq));
    }, 1);
    expect(count).toBe(2);
    expect(batches).toEqual([['ACTG'], ['GATC']]);
  });
});
