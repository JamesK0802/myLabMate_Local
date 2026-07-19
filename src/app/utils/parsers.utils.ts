import { SequenceDocument, SequenceFeature, Topology, Strand, FastqDocument, FastqRead, FastqStats } from '../models/sequence.model';
import * as fflate from 'fflate';

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function parseFasta(text: string): Partial<SequenceDocument>[] {
  const documents: Partial<SequenceDocument>[] = [];
  const lines = text.split(/\r?\n/);
  
  let currentName = '';
  let currentSeq = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    if (line.startsWith('>')) {
      if (currentName || currentSeq) {
        documents.push({
          name: currentName,
          sequence: currentSeq.replace(/\s/g, ''),
        });
      }
      currentName = line.substring(1).trim();
      currentSeq = '';
    } else {
      currentSeq += line;
    }
  }

  if (currentName || currentSeq) {
    documents.push({
      name: currentName || 'Untitled Sequence',
      sequence: currentSeq.replace(/\s/g, ''),
    });
  }

  return documents;
}

export function parseGenBank(text: string): Partial<SequenceDocument> | null {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || !lines[0].startsWith('LOCUS')) return null;

  const doc: Partial<SequenceDocument> = {
    name: 'Untitled',
    sequence: '',
    features: [],
    topology: 'linear'
  };

  let inFeatures = false;
  let inOrigin = false;
  let currentFeature: SequenceFeature | null = null;
  let currentQualifiers: Record<string, string[]> = {};
  let currentQualifierKey = '';
  
  // Basic parsing state machine
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('LOCUS')) {
      const parts = line.split(/\s+/);
      if (parts.length > 1) doc.name = parts[1];
      if (line.includes('circular')) doc.topology = 'circular';
      continue;
    }
    
    if (line.startsWith('DEFINITION')) {
      doc.description = line.substring(10).trim();
      continue;
    }

    if (line.startsWith('FEATURES')) {
      inFeatures = true;
      continue;
    }

    if (line.startsWith('ORIGIN')) {
      inFeatures = false;
      inOrigin = true;
      if (currentFeature) {
        currentFeature.qualifiers = currentQualifiers;
        doc.features!.push(currentFeature);
        currentFeature = null;
      }
      continue;
    }

    if (inOrigin) {
      if (line.startsWith('//')) break;
      // Strip numbers and spaces
      doc.sequence += line.replace(/[\d\s]/g, '').toUpperCase();
      continue;
    }

    if (inFeatures) {
      if (!line.startsWith(' ')) continue; // Safety
      
      const isNewFeature = line.length > 5 && line.substring(0, 5) === '     ' && line[5] !== ' ';
      
      if (isNewFeature) {
        if (currentFeature) {
          currentFeature.qualifiers = currentQualifiers;
          doc.features!.push(currentFeature);
        }
        
        const featureStr = line.substring(5).trim();
        const firstSpace = featureStr.indexOf(' ');
        if (firstSpace === -1) continue;
        
        const type = featureStr.substring(0, firstSpace);
        const locationStr = featureStr.substring(firstSpace).trim();
        
        const strand = locationStr.startsWith('complement') ? -1 : 1;
        const cleanLoc = locationStr.replace(/[^\d\.]/g, ' ').trim().split(/\s+/);
        
        let start = 0;
        let end = 0;
        if (cleanLoc.length >= 2) {
           start = Math.max(0, parseInt(cleanLoc[0], 10) - 1);
           end = parseInt(cleanLoc[cleanLoc.length - 1], 10);
        } else if (cleanLoc.length === 1) {
           start = Math.max(0, parseInt(cleanLoc[0], 10) - 1);
           end = start + 1;
        }

        currentFeature = {
          id: generateId(),
          name: type, // Default to type, override if /label or /gene found
          type,
          start,
          end,
          strand
        };
        currentQualifiers = {};
        currentQualifierKey = '';
      } else if (currentFeature && line.length > 21) {
        // Qualifier
        const qualStr = line.substring(21).trim();
        if (qualStr.startsWith('/')) {
          const eqIdx = qualStr.indexOf('=');
          if (eqIdx !== -1) {
            currentQualifierKey = qualStr.substring(1, eqIdx);
            let val = qualStr.substring(eqIdx + 1).replace(/^"|"$/g, '');
            currentQualifiers[currentQualifierKey] = [val];
            
            if (currentQualifierKey === 'label' || currentQualifierKey === 'gene' || currentQualifierKey === 'note') {
              if (currentFeature.name === currentFeature.type) {
                 currentFeature.name = val;
              }
            }
          } else {
            currentQualifierKey = qualStr.substring(1);
            currentQualifiers[currentQualifierKey] = ['true'];
          }
        } else if (currentQualifierKey) {
          // Continuation of previous qualifier
          currentQualifiers[currentQualifierKey][0] += ' ' + qualStr.replace(/"$/g, '');
        }
      }
    }
  }

  // Remove whitespace from sequence just in case
  if (doc.sequence) {
    doc.sequence = doc.sequence.replace(/\s/g, '');
  }

  return doc;
}

export function calculateFastqStats(reads: FastqRead[]): FastqStats {
  let minLength = Infinity;
  let maxLength = 0;
  let totalLength = 0;
  let totalGC = 0;
  let totalQual = 0;
  let totalBases = 0;
  const lengthDist: Record<number, number> = {};
  const qualDist: Record<number, number> = {};

  for (const read of reads) {
    const len = read.seq.length;
    if (len === 0) continue;
    
    if (len < minLength) minLength = len;
    if (len > maxLength) maxLength = len;
    totalLength += len;
    
    // length dist (bucket by 10)
    const lenBucket = Math.floor(len / 10) * 10;
    lengthDist[lenBucket] = (lengthDist[lenBucket] || 0) + 1;

    let gcCount = 0;
    for (let i = 0; i < len; i++) {
      const char = read.seq[i];
      if (char === 'G' || char === 'C' || char === 'g' || char === 'c') gcCount++;
    }
    totalGC += (gcCount / len) * 100;

    let readQualSum = 0;
    for (let i = 0; i < read.qual.length; i++) {
      const q = read.qual[i];
      readQualSum += q;
      const qBucket = Math.floor(q / 2) * 2; // bucket by 2
      qualDist[qBucket] = (qualDist[qBucket] || 0) + 1;
    }
    totalQual += readQualSum;
    totalBases += len;
  }

  const readCount = reads.length;
  if (readCount === 0) {
    return {
      readCount: 0, avgLength: 0, minLength: 0, maxLength: 0,
      avgGC: 0, avgQuality: 0, lengthDistribution: {}, qualityDistribution: {}
    };
  }

  return {
    readCount,
    avgLength: totalLength / readCount,
    minLength: minLength === Infinity ? 0 : minLength,
    maxLength,
    avgGC: totalGC / readCount,
    avgQuality: totalBases > 0 ? totalQual / totalBases : 0,
    lengthDistribution: lengthDist,
    qualityDistribution: qualDist
  };
}

export async function parseFastqFile(file: File): Promise<FastqDocument> {
  const isGz = file.name.endsWith('.gz');
  const buffer = await file.arrayBuffer();
  let text = '';

  if (isGz) {
    const decompressed = fflate.gunzipSync(new Uint8Array(buffer));
    text = fflate.strFromU8(decompressed);
  } else {
    text = new TextDecoder().decode(buffer);
  }

  const lines = text.split(/\r?\n/);
  const reads: FastqRead[] = [];
  
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++;
      continue;
    }

    if (!lines[i].startsWith('@')) {
      i++;
      continue;
    }

    if (i + 3 >= lines.length) break;

    const id = lines[i].substring(1).split(/\s+/)[0]; // get ID part
    const seq = lines[i + 1].trim();
    const qualString = lines[i + 3].trim();
    
    const qual: number[] = [];
    for (let j = 0; j < qualString.length; j++) {
      qual.push(qualString.charCodeAt(j) - 33);
    }

    reads.push({ id, seq, qual, qualString });
    i += 4;
  }

  const stats = calculateFastqStats(reads);

  return {
    type: 'fastq',
    id: generateId(),
    name: file.name,
    description: `Imported FASTQ with ${reads.length} reads`,
    reads,
    stats,
    createdTimestamp: Date.now(),
    updatedTimestamp: Date.now()
  };
}
