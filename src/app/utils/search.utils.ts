import { reverseComplement } from './biology.utils';

export const IUPAC_MAP: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]', K: '[GT]', M: '[AC]',
  B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]',
  N: '[ACGT]'
};

export function buildIupacRegex(query: string): RegExp {
  const pattern = query.toUpperCase().split('').map(char => IUPAC_MAP[char] || char).join('');
  return new RegExp(pattern, 'gi');
}

export interface SearchMatch {
  start: number;
  end: number; // exclusive
  strand: 1 | -1;
  match: string;
}

export function searchSequence(query: string, sequence: string, searchRevComp: boolean = true): SearchMatch[] {
  if (!query || !sequence) return [];
  const regex = buildIupacRegex(query);
  const matches: SearchMatch[] = [];
  
  // Forward strand
  let m;
  while ((m = regex.exec(sequence)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, strand: 1, match: m[0] });
    regex.lastIndex = m.index + 1; // Allow overlapping matches if necessary
  }
  
  // Reverse strand
  if (searchRevComp) {
    const revQuery = reverseComplement(query); 
    const revRegex = buildIupacRegex(revQuery);
    while ((m = revRegex.exec(sequence)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, strand: -1, match: m[0] });
      revRegex.lastIndex = m.index + 1;
    }
  }
  
  // Sort by start position
  return matches.sort((a, b) => a.start - b.start);
}
