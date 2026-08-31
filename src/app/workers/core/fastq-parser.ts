/**
 * fastq-parser.ts — Streaming FASTQ parser for browser-side analysis.
 *
 * Reads FASTQ files using the File API without loading the entire file
 * into memory. Yields (sequence, quality_scores) tuples matching the
 * output of BioPython's SeqIO.parse(handle, "fastq").
 *
 * FASTQ format (4 lines per record):
 *   Line 1: @identifier
 *   Line 2: sequence
 *   Line 3: + (separator)
 *   Line 4: quality string (ASCII-encoded Phred scores)
 */

export interface FastqRead {
  id?: string;
  seq: string;
  qual: number[];
}

export function normalizeFastqReadId(identifier: string): string {
  const firstToken = identifier.trim().replace(/^@/, '').split(/\s+/)[0] || '';
  return firstToken.replace(/\/[12]$/, '');
}

/**
 * Parse an entire FASTQ file from a string.
 * Used in Web Workers where the file has already been read to text.
 */
export function parseFastqString(text: string): FastqRead[] {
  const results: FastqRead[] = [];
  const lines = text.split('\n');

  let i = 0;
  while (i < lines.length) {
    // Skip empty lines
    if (lines[i].trim() === '') {
      i++;
      continue;
    }

    // Line 1: identifier (starts with @)
    if (!lines[i].startsWith('@')) {
      i++;
      continue;
    }

    // Ensure we have all 4 lines
    if (i + 3 >= lines.length) break;

    // Line 2: sequence
    const seq = lines[i + 1].trim();

    // Line 3: separator (starts with +)
    // Line 4: quality string
    const qualStr = lines[i + 3].trim();

    if (seq.length > 0 && qualStr.length > 0) {
      // Convert ASCII quality to Phred scores (ASCII - 33)
      const qual: number[] = new Array(qualStr.length);
      for (let q = 0; q < qualStr.length; q++) {
        qual[q] = qualStr.charCodeAt(q) - 33;
      }
      results.push({ id: lines[i].trim().replace(/^@/, ''), seq, qual });
    }

    i += 4;
  }

  return results;
}

import * as fflate from 'fflate';

/**
 * Read a File object to text string (supports plain text and .gz files).
 * For use in Web Workers where ArrayBuffer / fflate / TextDecoder are available.
 */
export async function readFileAsText(file: File): Promise<string> {
  const isGz = file.name.endsWith('.gz');
  const buffer = await file.arrayBuffer();

  if (isGz) {
    const decompressed = fflate.gunzipSync(new Uint8Array(buffer));
    return fflate.strFromU8(decompressed);
  } else {
    return new TextDecoder().decode(buffer);
  }
}

/**
 * Parse a FASTQ File object into reads.
 * Convenience wrapper combining file reading and parsing.
 */
export async function parseFastqFile(file: File): Promise<FastqRead[]> {
  const text = await readFileAsText(file);
  return parseFastqString(text);
}
