export type IlluminaMateSlot = 'r1' | 'r2';
export type SequencingPlatform = 'nanopore' | 'illumina';

export interface IlluminaFilePair {
  id: string;
  name: string;
  r1: File | null;
  r2: File | null;
}

export interface IlluminaFilenameInfo {
  sampleKey: string;
  sampleName: string;
  mate: IlluminaMateSlot | null;
}

const FASTQ_EXTENSION = /\.(?:fastq|fq)(?:\.gz)?$/i;
// Keep each convention explicit: in addition to the common R1/R2 form,
// sequencers and lab exports often use a terminal -1/-2 or _1/_2 suffix.
// The boundary requirement deliberately avoids pairing unrelated names such as
// "sample10.fastq" as mate 1.
const MATE_TOKENS: RegExp[] = [
  /(^|[._-])R([12])(?=([._-]|$))/i,
  /([_-])([12])$/,
];
const TRAILING_READ_NUMBER = /[._-]00\d$/;

function humanizeSampleName(value: string): string {
  const words = value
    .replace(/[._-]+/g, ' ')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 'Illumina Sample';
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * Extract a conservative R1/R2 marker. A marker must be a distinct filename
 * token, which avoids pairing unrelated names that merely contain "r1".
 */
export function parseIlluminaFilename(filename: string): IlluminaFilenameInfo {
  const stem = filename.replace(FASTQ_EXTENSION, '');
  const match = MATE_TOKENS
    .map(pattern => ({ pattern, match: pattern.exec(stem) }))
    .find(result => result.match)?.match;
  if (!match) {
    return {
      sampleKey: stem.toLowerCase(),
      sampleName: humanizeSampleName(stem),
      mate: null,
    };
  }

  const mate = match[2] === '1' ? 'r1' : 'r2';
  const tokenStart = match.index + match[1].length;
  const tokenEnd = tokenStart + (match[0].length - match[1].length);
  const withoutMate = `${stem.slice(0, tokenStart)}${stem.slice(tokenEnd)}`
    .replace(TRAILING_READ_NUMBER, '')
    .replace(/[._-]+$/g, '')
    .replace(/^[._-]+/g, '');
  const normalized = withoutMate.replace(/[._-]+/g, '_').toLowerCase();

  return {
    sampleKey: normalized || stem.toLowerCase(),
    sampleName: humanizeSampleName(withoutMate || stem),
    mate,
  };
}

export function deriveIlluminaPairName(pair: Pick<IlluminaFilePair, 'r1' | 'r2'>): string {
  const r1Info = pair.r1 ? parseIlluminaFilename(pair.r1.name) : null;
  const r2Info = pair.r2 ? parseIlluminaFilename(pair.r2.name) : null;
  if (r1Info && r2Info) {
    if (r1Info.sampleKey === r2Info.sampleKey) return r1Info.sampleName;
    return `${r1Info.sampleName} + ${r2Info.sampleName}`;
  }
  return (r1Info || r2Info)?.sampleName || 'Illumina Sample';
}

/**
 * Presentation-only name for the compact upload card. A single mate keeps its
 * exact source filename, while a real pair is shown as its logical sample name
 * with the original FASTQ extension.
 */
export function displayIlluminaPairName(pair: Pick<IlluminaFilePair, 'name' | 'r1' | 'r2'>): string {
  const onlyFile = pair.r1 || pair.r2;
  if (!onlyFile) return pair.name;
  if (!pair.r1 || !pair.r2) return onlyFile.name;

  const extension = onlyFile.name.match(FASTQ_EXTENSION)?.[0] || '';
  return `${pair.name}${extension}`;
}

export function createIlluminaFilePairs(
  files: File[],
  idFactory: () => string = () => `illumina_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
): IlluminaFilePair[] {
  const pairs: IlluminaFilePair[] = [];
  const byKey = new Map<string, IlluminaFilePair>();

  for (const file of files) {
    const info = parseIlluminaFilename(file.name);
    let pair = info.mate ? byKey.get(info.sampleKey) : undefined;

    if (!pair || (info.mate && pair[info.mate])) {
      pair = { id: idFactory(), name: info.sampleName, r1: null, r2: null };
      pairs.push(pair);
      if (info.mate && !byKey.has(info.sampleKey)) byKey.set(info.sampleKey, pair);
    }

    const slot: IlluminaMateSlot = info.mate || 'r1';
    pair[slot] = file;
    pair.name = deriveIlluminaPairName(pair);
  }

  return pairs;
}

export function addFilesToIlluminaPairs(existing: IlluminaFilePair[], files: File[]): IlluminaFilePair[] {
  const result = existing.map(pair => ({ ...pair }));
  const unplaced: File[] = [];

  for (const file of files) {
    const info = parseIlluminaFilename(file.name);
    if (!info.mate) {
      unplaced.push(file);
      continue;
    }
    const match = result.find(pair => {
      const occupied = pair.r1 || pair.r2;
      return !pair[info.mate!] && occupied && parseIlluminaFilename(occupied.name).sampleKey === info.sampleKey;
    });
    if (match) {
      match[info.mate] = file;
      match.name = deriveIlluminaPairName(match);
    } else {
      unplaced.push(file);
    }
  }

  return result.concat(createIlluminaFilePairs(unplaced));
}

export function moveIlluminaMate(
  pairs: IlluminaFilePair[],
  sourcePairId: string,
  sourceSlot: IlluminaMateSlot,
  targetPairId: string,
  targetSlot: IlluminaMateSlot
): IlluminaFilePair[] {
  const result = pairs.map(pair => ({ ...pair }));
  const source = result.find(pair => pair.id === sourcePairId);
  const target = result.find(pair => pair.id === targetPairId);
  if (!source || !target || !source[sourceSlot]) return result;

  const sourceFile = source[sourceSlot];
  source[sourceSlot] = target[targetSlot];
  target[targetSlot] = sourceFile;
  source.name = deriveIlluminaPairName(source);
  target.name = deriveIlluminaPairName(target);
  return result.filter(pair => pair.r1 || pair.r2);
}
