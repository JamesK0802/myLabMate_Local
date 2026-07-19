export interface AlignmentResult {
  seq1Aligned: string;
  seq2Aligned: string;
  score: number;
  identityPct: number;
  gapCount: number;
}

export function alignPairwise(
  seq1: string,
  seq2: string,
  type: 'global' | 'local' = 'global',
  matchScore = 1,
  mismatchScore = -1,
  gapPenalty = -2
): AlignmentResult {
  const m = seq1.length;
  const n = seq2.length;
  
  // Matrix initialization
  const matrix: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const traceback: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  // Traceback codes: 1 = Diagonal (match/mismatch), 2 = Up (gap in seq2), 3 = Left (gap in seq1), 0 = Stop (for local)

  let maxScore = 0;
  let maxI = 0;
  let maxJ = 0;

  for (let i = 1; i <= m; i++) {
    if (type === 'global') matrix[i][0] = i * gapPenalty;
    traceback[i][0] = 2; // Up
  }
  for (let j = 1; j <= n; j++) {
    if (type === 'global') matrix[0][j] = j * gapPenalty;
    traceback[0][j] = 3; // Left
  }
  
  if (type === 'local') {
    traceback[0][0] = 0;
  }

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const match = seq1[i - 1] === seq2[j - 1] ? matchScore : mismatchScore;
      const diag = matrix[i - 1][j - 1] + match;
      const up = matrix[i - 1][j] + gapPenalty;
      const left = matrix[i][j - 1] + gapPenalty;
      
      let best = Math.max(diag, up, left);
      if (type === 'local' && best < 0) best = 0;
      
      matrix[i][j] = best;
      
      if (best === diag && (type === 'global' || best > 0)) traceback[i][j] = 1;
      else if (best === up && (type === 'global' || best > 0)) traceback[i][j] = 2;
      else if (best === left && (type === 'global' || best > 0)) traceback[i][j] = 3;
      else traceback[i][j] = 0;
      
      if (type === 'local' && best > maxScore) {
        maxScore = best;
        maxI = i;
        maxJ = j;
      }
    }
  }

  // Traceback
  let aligned1 = '';
  let aligned2 = '';
  let currI = type === 'global' ? m : maxI;
  let currJ = type === 'global' ? n : maxJ;
  
  while (currI > 0 || currJ > 0) {
    if (type === 'local' && matrix[currI][currJ] === 0) break;
    
    const dir = traceback[currI][currJ];
    
    if (dir === 1) { // Diagonal
      aligned1 = seq1[currI - 1] + aligned1;
      aligned2 = seq2[currJ - 1] + aligned2;
      currI--;
      currJ--;
    } else if (dir === 2) { // Up
      aligned1 = seq1[currI - 1] + aligned1;
      aligned2 = '-' + aligned2;
      currI--;
    } else if (dir === 3) { // Left
      aligned1 = '-' + aligned1;
      aligned2 = seq2[currJ - 1] + aligned2;
      currJ--;
    } else {
      break;
    }
  }

  // Calculate stats
  let matches = 0;
  let gaps = 0;
  for (let i = 0; i < aligned1.length; i++) {
    if (aligned1[i] === '-' || aligned2[i] === '-') {
      gaps++;
    } else if (aligned1[i] === aligned2[i]) {
      matches++;
    }
  }
  
  const identityPct = aligned1.length > 0 ? (matches / aligned1.length) * 100 : 0;
  const finalScore = type === 'global' ? matrix[m][n] : maxScore;

  return {
    seq1Aligned: aligned1,
    seq2Aligned: aligned2,
    score: finalScore,
    identityPct,
    gapCount: gaps
  };
}
