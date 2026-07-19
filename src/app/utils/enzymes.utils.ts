import { RestrictionSite, Topology } from '../models/sequence.model';
import { reverseComplement } from './biology.utils';

export interface EnzymeDefinition {
  name: string;
  recognitionSeq: string; // 5' to 3'
  cutTopOffset: number;   // Cut position relative to 5' start of recognition on top strand
  cutBottomOffset: number; // Cut position relative to 5' start of recognition on top strand (for bottom strand cut)
  isTypeIIS: boolean;
}

export const COMMON_ENZYMES: EnzymeDefinition[] = [
  { name: 'EcoRI', recognitionSeq: 'GAATTC', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'BamHI', recognitionSeq: 'GGATCC', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'HindIII', recognitionSeq: 'AAGCTT', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'XhoI', recognitionSeq: 'CTCGAG', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'NotI', recognitionSeq: 'GCGGCCGC', cutTopOffset: 2, cutBottomOffset: 6, isTypeIIS: false },
  { name: 'SpeI', recognitionSeq: 'ACTAGT', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'XbaI', recognitionSeq: 'TCTAGA', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'PstI', recognitionSeq: 'CTGCAG', cutTopOffset: 5, cutBottomOffset: 1, isTypeIIS: false },
  { name: 'NheI', recognitionSeq: 'GCTAGC', cutTopOffset: 1, cutBottomOffset: 5, isTypeIIS: false },
  { name: 'KpnI', recognitionSeq: 'GGTACC', cutTopOffset: 5, cutBottomOffset: 1, isTypeIIS: false },
  { name: 'SacI', recognitionSeq: 'GAGCTC', cutTopOffset: 5, cutBottomOffset: 1, isTypeIIS: false },
  { name: 'BsaI', recognitionSeq: 'GGTCTC', cutTopOffset: 7, cutBottomOffset: 11, isTypeIIS: true },
  { name: 'BsmBI', recognitionSeq: 'CGTCTC', cutTopOffset: 7, cutBottomOffset: 11, isTypeIIS: true },
  { name: 'Esp3I', recognitionSeq: 'CGTCTC', cutTopOffset: 7, cutBottomOffset: 11, isTypeIIS: true },
];

function iupacToRegex(seq: string): RegExp {
  const map: Record<string, string> = {
    A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
    R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]',
    K: '[GT]', M: '[AC]', B: '[CGT]', D: '[AGT]',
    H: '[ACT]', V: '[ACG]', N: '[ATCG]'
  };
  const pattern = seq.toUpperCase().split('').map(c => map[c] || c).join('');
  return new RegExp(`(?=(${pattern}))`, 'g'); // Use lookahead to find overlapping matches
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function findRestrictionSites(
  seq: string, 
  topology: Topology, 
  enzymes: EnzymeDefinition[] = COMMON_ENZYMES
): RestrictionSite[] {
  const sites: RestrictionSite[] = [];
  const seqUpper = seq.replace(/U/gi, 'T').toUpperCase();
  const len = seqUpper.length;
  
  // For circular, append the start of the sequence to handle sites crossing the origin
  const maxRecLen = Math.max(...enzymes.map(e => e.recognitionSeq.length));
  const searchSeq = topology === 'circular' ? seqUpper + seqUpper.substring(0, maxRecLen - 1) : seqUpper;

  enzymes.forEach(enzyme => {
    const fwdRegex = iupacToRegex(enzyme.recognitionSeq);
    const revSeq = reverseComplement(enzyme.recognitionSeq);
    const revRegex = iupacToRegex(revSeq);
    const isPalindromic = enzyme.recognitionSeq === revSeq;

    // Search forward strand
    let match;
    while ((match = fwdRegex.exec(searchSeq)) !== null) {
      const start = match.index;
      if (start >= len) break; // Ignore matches fully in the appended region
      
      let cutTop = (start + enzyme.cutTopOffset) % len;
      let cutBottom = (start + enzyme.cutBottomOffset) % len;
      
      sites.push({
        id: generateId(),
        enzyme: enzyme.name,
        recognitionStart: start,
        recognitionEnd: (start + enzyme.recognitionSeq.length) % len,
        cutPosition1: cutTop,
        cutPosition2: cutBottom,
        strand: 1,
        isTypeIIS: enzyme.isTypeIIS
      });
      // Advance regex manually because of lookahead
      fwdRegex.lastIndex = match.index + 1;
    }

    if (!isPalindromic) {
      // Search reverse strand
      while ((match = revRegex.exec(searchSeq)) !== null) {
        const start = match.index;
        if (start >= len) break;
        
        // Reverse strand calculations
        const recEnd = (start + enzyme.recognitionSeq.length) % len;
        // On reverse strand, top cut is offset from the END of the match backwards
        // Actually, rev match start corresponds to the 3' end of the bottom strand recognition
        // Wait, it's easier to map from the 5' of the bottom strand.
        // Let's just use the recognition length to flip offsets.
        const recLen = enzyme.recognitionSeq.length;
        const offsetBottomFrom5PrimeOfBottom = enzyme.cutTopOffset; // the cut on the strand containing the recog seq
        const offsetTopFrom5PrimeOfBottom = enzyme.cutBottomOffset; // the cut on the other strand
        
        // Match start is the 5' of the bottom strand
        let cutBottom = (start + offsetBottomFrom5PrimeOfBottom) % len;
        let cutTop = (start + offsetTopFrom5PrimeOfBottom) % len;

        sites.push({
          id: generateId(),
          enzyme: enzyme.name,
          recognitionStart: start, // We will render it mapped to the bottom strand
          recognitionEnd: recEnd,
          cutPosition1: cutTop,
          cutPosition2: cutBottom,
          strand: -1,
          isTypeIIS: enzyme.isTypeIIS
        });
        revRegex.lastIndex = match.index + 1;
      }
    }
  });

  return sites.sort((a, b) => a.recognitionStart - b.recognitionStart);
}
