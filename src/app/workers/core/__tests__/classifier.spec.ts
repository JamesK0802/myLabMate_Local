import { describe, it, expect } from 'vitest';
import { windowEndpointRegression } from './fixtures/window-endpoint-regression';
import { unsupportedTerminalTail } from './fixtures/unsupported-terminal-tail';
import { windowCompetitionRegression } from './fixtures/window-competition-regression';
import {
  reverseComplement,
  avgPhred,
  findGrnaCutSite,
  getWindowBounds,
  cutIndexInWindow,
  extractWindow,
  scoreReadAgainstWindow,
  applyGeneClassification,
  applyClassification,
  isReadUsable,
  clearClassifierCache
} from '../classifier';

describe('Classifier Core Utilities', () => {
  it('repairs fragmented ranking contradictions without using sample labels in classification', () => {
    const classes=Object.fromEntries(Object.entries(windowEndpointRegression.references).map(([gene,r])=>{
      const cut=findGrnaCutSite(r.sequence,r.guide).cut_site;
      return [gene,[{gene,target:'gRNA2',sgrna_seq:r.guide,ref_window:extractWindow(r.sequence,cut,90),cut_index_in_window:45}]];
    }));
    for (const read of windowCompetitionRegression) {
      const qual=Array.from(read.quality,c=>c.charCodeAt(0)-33);
      for (const result of [applyGeneClassification(read.sequence,qual,classes,20,.02,0,0),
          applyClassification(read.sequence,qual,Object.values(classes).flat(),20,.02,0,0)]) {
        expect(result.assigned ? result.predicted_gene : result.reason).toBe(read.expected);
      }
      const reversed=applyGeneClassification(reverseComplement(read.sequence),[...qual].reverse(),classes,20,.02,0,0);
      expect(reversed.assigned ? reversed.predicted_gene : reversed.reason).toBe(read.expected);
      const acceptedGenes=new Set<string>();
      const scores=new Set<number | undefined>();
      let rejected=false;
      for (const margin of [0,.005,.01,.02,.05,.1]) {
        const result=applyGeneClassification(read.sequence,qual,classes,20,margin,0,0);
        scores.add(result.top1_score);
        if (result.assigned) {
          expect(rejected).toBe(false);
          acceptedGenes.add(result.predicted_gene!);
        } else rejected=true;
      }
      expect(acceptedGenes.size).toBeLessThanOrEqual(1);
      expect(scores.size).toBe(1);
    }
  });
  it('does not extend cut coverage into a weakly matching non-reference terminal tail', () => {
    const {read,reference,guide} = unsupportedTerminalTail;
    for (const sequence of [read,reverseComplement(read)]) {
      const [usable,reason] = isReadUsable(sequence,null,reference,20,guide,45);
      expect(usable).toBe(false);
      expect(reason).toBe('no_coverage');
    }
    // Mirror reference coordinates to exercise the opposite terminal branch.
    const mirrored = isReadUsable(read,null,reverseComplement(reference),20,reverseComplement(guide),45);
    expect(mirrored[0]).toBe(false);
    expect(mirrored[1]).toBe('no_coverage');
  });
  it('corrects the diagnosed 720/1770 single-control reads without sample labels in classification', () => {
    for (const read of windowEndpointRegression.reads) {
      const classes = Object.fromEntries(Object.entries(windowEndpointRegression.references).map(([gene,r]) => {
        const cut = findGrnaCutSite(r.sequence,r.guide).cut_site;
        return [gene,[{gene,target:'gRNA2',sgrna_seq:r.guide,
          ref_window:extractWindow(r.sequence,cut,read.window),
          cut_index_in_window:cutIndexInWindow(r.sequence,cut,read.window)}]];
      }));
      const qual = Array.from(read.quality,c=>c.charCodeAt(0)-33);
      expect(applyGeneClassification(read.sequence,qual,classes,20,.01,0,10).predicted_gene,read.label).toBe(read.expected);
    }
  });
  it('should calculate reverse complement correctly', () => {
    expect(reverseComplement('ACTG')).toBe('CAGT');
    expect(reverseComplement('actg')).toBe('CAGT');
    expect(reverseComplement('AATTCG')).toBe('CGAATT');
  });

  it('should calculate average Phred score correctly', () => {
    expect(avgPhred([40, 40, 40])).toBe(40.0);
    expect(avgPhred([30, 20, 10])).toBe(20.0);
    expect(avgPhred(null)).toBe(40.0);
    expect(avgPhred([])).toBe(40.0);
  });

  it('should find gRNA cut site (forward strand)', () => {
    const reference = 'GCGCATGCATCGATCGATCGATCGATCGATCGATCGATCGATC';
    // Let's place a gRNA: ATCGATCGATCGATCGATCG (20bp) followed by PAM (NGG, e.g. TGG)
    // index in reference where gRNA starts: 8
    const grna = 'ATCGATCGATCGATCGATCG';
    const ref = 'GCGCATGC' + grna + 'TGG' + 'ATCGATCGATCGATC';
    const res = findGrnaCutSite(ref, grna);

    expect(res.strand).toBe('forward');
    expect(res.pam_found).toBe(true);
    expect(res.grna_start).toBe(8);
    expect(res.grna_end).toBe(28);
    expect(res.cut_site).toBe(25); // cut site is grna_end - 3
    expect(res.pam).toBe('TGG');
  });

  it('uses the same cut coordinate when a forward PAM is included in the guide input', () => {
    const spacer = 'ATCGATCGATCGATCGATCG';
    const reference = `GCGCATGC${spacer}TGGATCGATCG`;
    const result = findGrnaCutSite(reference, `${spacer}TGG`);

    expect(result.strand).toBe('forward');
    expect(result.pam_found).toBe(true);
    expect(result.cut_site).toBe(25);
  });

  it('resolves a reverse reference-oriented guide with its included CCN PAM', () => {
    const matchedGuide = `CCA${'ATCG'.repeat(5)}`;
    const reference = `TTTT${matchedGuide}AAAA`;
    const result = findGrnaCutSite(reference, matchedGuide);

    expect(result.strand).toBe('reverse');
    expect(result.pam_found).toBe(true);
    expect(result.cut_site).toBe(10);
  });

  it('should get correct window bounds', () => {
    const ref = 'A'.repeat(100);
    expect(getWindowBounds(ref, 50, 40)).toEqual([30, 70]);
    expect(getWindowBounds(ref, 10, 40)).toEqual([0, 30]);
    expect(getWindowBounds(ref, 90, 40)).toEqual([70, 100]);
    expect(getWindowBounds(ref, 50, 60, 20, 40)).toEqual([30, 90]);
    expect(getWindowBounds(ref, 10, 60, 20, 40)).toEqual([0, 50]);
  });

  it('should get correct cut index in window', () => {
    const ref = 'A'.repeat(100);
    expect(cutIndexInWindow(ref, 50, 40)).toBe(20);
    expect(cutIndexInWindow(ref, 10, 40)).toBe(10);
    expect(cutIndexInWindow(ref, 50, 60, 20, 40)).toBe(20);
  });

  it('should extract correct window subsegment', () => {
    const ref = 'abcdefghijklmnopqrstuvwxyz';
    expect(extractWindow(ref, 10, 10)).toBe('fghijklmno'); // cutSite = 10, windowSize = 10, [10-5, 10+5] = [5, 15] = 'fghijklmno'
    expect(extractWindow(ref, 10, 6, 2, 4)).toBe('ijklmn');
  });

  it('should score read against window using alignment scoring', () => {
    const window = 'AAAAAAAAAAAAAAAAAAAA';
    // Score should be 1.0 for perfect match
    expect(scoreReadAgainstWindow(window, window)).toBe(1.0);
    // Score should be 0 for unrelated sequence
    expect(scoreReadAgainstWindow('CCCCCCCCCCCCCCCCCCCC', window)).toBe(0.0);
  });

  it('does not collapse X-separated segments into artificial adjacent evidence', () => {
    const window = 'AAAACCCC';
    const segmentScore = Math.max(
      scoreReadAgainstWindow('AAAA', window),
      scoreReadAgainstWindow('CCCC', window),
    );
    const guardedScore = scoreReadAgainstWindow('AAAAXXXXCCCC', window);
    expect(guardedScore).toBeCloseTo(segmentScore);
  });

  it('aligns an exact short direct-input window inside a long read', () => {
    const target = 'AACATCAATC';
    const read = `${'G'.repeat(25)}${target}${'T'.repeat(25)}`;
    const [usable, reason, result] = isReadUsable(read, null, target, 0, '', 5);

    expect(usable).toBe(true);
    expect(reason).toBe('ok');
    expect(result?.read_window).toBe(target);
  });

  it('does not reuse a usability decision across different FASTQ qualities', () => {
    clearClassifierCache();
    const reference = 'ACGTTGCACTGATCG' + 'CCGTA'.repeat(8) + 'TGCATGACCTAGTCA';
    const guide = reference.substring(25, 45);
    const cutIndex = 35;
    const highQuality = new Array(reference.length).fill(40);
    const lowQuality = new Array(reference.length).fill(5);

    expect(isReadUsable(reference, highQuality, reference, 20, guide, cutIndex)[0]).toBe(true);
    const [usable, reason] = isReadUsable(reference, lowQuality, reference, 20, guide, cutIndex);
    expect(usable).toBe(false);
    expect(reason).toBe('quality');
  });

  it('accepts up to four alignment errors in a 15 bp terminal anchor', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = `${left}${'CCGTA'.repeat(4)}${guide}${'AGTCC'.repeat(4)}${right}`;
    const cutIndex = left.length + 20 + 10;
    const mutatePrefix = (count: number) => reference
      .split('')
      .map((base, index) => index < count ? (base === 'A' ? 'C' : 'A') : base)
      .join('');
    const fourErrors = mutatePrefix(4);
    const fiveErrors = mutatePrefix(5);

    expect(isReadUsable(fourErrors, null, reference, 0, guide, cutIndex)[0]).toBe(true);
    const [usable, reason] = isReadUsable(fiveErrors, null, reference, 0, guide, cutIndex);
    expect(usable).toBe(false);
    expect(reason).toBe('no_anchor');
  });

  it('counts a terminal deletion as one anchor error', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = `${left}${'CCGTA'.repeat(4)}${guide}${'AGTCC'.repeat(4)}${right}`;
    const cutIndex = left.length + 20 + 10;
    const oneBaseDeletion = `${reference[0]}${reference.substring(2)}`;

    const [usable, reason] = isReadUsable(oneBaseDeletion, null, reference, 0, guide, cutIndex);
    expect(usable).toBe(true);
    expect(reason).toBe('ok');
  });

  it('keeps terminal X padding unobserved instead of counting it as an anchor error', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = `${left}${'CCGTA'.repeat(4)}${guide}${'AGTCC'.repeat(4)}${right}`;
    const cutIndex = left.length + 20 + 10;
    const leftTruncated = reference.substring(8);

    const [usable, reason, result] = isReadUsable(leftTruncated, null, reference, 0, guide, cutIndex);
    expect(usable).toBe(true);
    expect(reason).toBe('ok');
    expect(result?.left_x).toBe(8);
  });

  it('should exclude cut-site mutations only when exclusionFlank is configured', () => {
    const window = 'ATCGGCTAAGCTTGCCGAATCGCCTAGGCTA';
    // Read has a mutation right at cut site (index 16)
    const readWithCutSiteMutation = window.substring(0, 16) + 'T' + window.substring(17);
    // Read has a mutation far from cut site (index 2)
    const readWithFarMutation = window.substring(0, 2) + 'T' + window.substring(3);

    const scoreCutSite = scoreReadAgainstWindow(readWithCutSiteMutation, window, 16, 0.0, 2);
    const scoreCutSiteDefault = scoreReadAgainstWindow(readWithCutSiteMutation, window, 16);
    const scoreFar = scoreReadAgainstWindow(readWithFarMutation, window, 16, 0.0, 0);

    expect(scoreCutSite).toBe(1.0);
    expect(scoreCutSiteDefault).toBeLessThan(1.0);
    expect(scoreCutSite).toBeGreaterThan(scoreFar);
  });

  it('rechecks an unseeded competing homoeolog at an independently located window', () => {
    const left = 'ACGTTGCACTGATCG';
    const guide = 'GATTACAGTCGATCGTACGA';
    const right = 'TGCATGACCTAGTCA';
    const reference = left + 'CGGATCCGTA' + guide + 'AGTCCGATCA' + right;
    const mutated = reference.split('').map((b,i) =>
      [2,32,reference.length-3].includes(i) ? (b==='A'?'C':'A') : b).join('');
    expect(mutated.includes(left)).toBe(false);
    expect(mutated.includes(right)).toBe(false);
    expect(mutated.includes(guide)).toBe(false);
    const competitor = reference.split('').map((b,i) =>
      [2,16,18,21,23,reference.length-3].includes(i) ? (b==='A'?'C':'A') : b).join('');
    const classes = [
      {gene:'A',target:'g',ref_window:reference,sgrna_seq:guide,cut_index_in_window:35},
      {gene:'B',target:'g',ref_window:competitor,sgrna_seq:guide,cut_index_in_window:35},
    ];
    expect(isReadUsable(mutated,null,reference,20,guide,35)[1]).toBe('no_alignment');
    expect(isReadUsable(mutated,null,competitor,20,guide,35)[0]).toBe(true);
    const classify = (read:string,qualities:number[]|null=null) =>
      applyGeneClassification(read,qualities,{A:[classes[0]],B:[classes[1]]},20,.01);
    expect(classify(mutated).predicted_gene).toBe('A');
    expect(classify(reverseComplement(mutated)).predicted_gene).toBe('A');
    expect(applyClassification(mutated,null,classes,20,.01).predicted_gene).toBe('A');
    expect(classify(mutated,new Array(mutated.length).fill(5)).reason).toBe('filtered');
    expect(isReadUsable(mutated.slice(0,-15),null,reference,20,guide,35)[0]).toBe(false);
    expect(isReadUsable(mutated.slice(0,15)+'X'.repeat(50)+mutated.slice(-15),null,reference,20,guide,35)[0]).toBe(false);
  });

  it('projects the same observed locus across differently clipped homologous references', () => {
    const guide = 'GATTACAGTCGATCGTACGA';
    const core = 'ACGTTGCACTGATCG'+'CGGATCCGTA'+guide+'AGTCCGATCA'+'TGCATGACCTAGTCA';
    const change = (seq:string,indices:number[]) => seq.split('').map((b,i)=>indices.includes(i)?(b==='A'?'C':'A'):b).join('');
    const a = 'G'.repeat(23)+core+'T'.repeat(23);
    const b = change(core,[16,18,21,23]);
    const read = change(core,[32]);
    const classes = {
      A:[{gene:'A',target:'g',ref_window:a,sgrna_seq:guide,cut_index_in_window:58}],
      B:[{gene:'B',target:'g',ref_window:b,sgrna_seq:guide,cut_index_in_window:35}],
    };
    expect(isReadUsable(read,null,a,20,guide,58)[1]).toBe('no_alignment');
    const result = applyGeneClassification(read,null,classes,20,.01,0,0);
    expect(result.predicted_gene).toBe('A');
    const recovered = result.validated_windows!['g'].result;
    expect(recovered.seed_recovered).toBe(true);
    expect(recovered.read_window).toBe('X'.repeat(23)+read+'X'.repeat(23));
    expect(recovered.left_x).toBe(23);
    expect(recovered.right_x).toBe(23);
    expect(applyGeneClassification(read,null,{A:classes.A},20,.01).assigned).toBe(false);
    const unrelatedGuide = {...classes.A[0],sgrna_seq:'TCGATGCAACGTAGCTGACT'};
    expect(applyGeneClassification(read,null,{A:[unrelatedGuide],B:classes.B},20,.01).predicted_gene).toBe('B');
  });

  it('does not mistake inserted query bases for observed missing reference-end bases', () => {
    const reference = 'ACGTTGCACTGATCGCGGATCCGTAGATTACAGTCGATCGTACGAAGTCCGATCATGCATGACCTAGTCA';
    // Eight inserted bases compensate in raw length for eight unobserved end
    // bases. The reference endpoint, not query length, determines padding.
    const read = reference.slice(0,30)+'TTGGAACC'+reference.slice(30,-8);
    const [usable,,result] = isReadUsable(read,null,reference,20,'',35);
    expect(usable).toBe(true);
    expect(result!.right_x).toBeGreaterThan(0);
    expect(result!.read_window.endsWith('X'.repeat(result!.right_x))).toBe(true);
    expect(result!.observed_read).toContain('TTGGAACC');
    const reverse = isReadUsable(reverseComplement(read),null,reference,20,'',35);
    expect(reverse[0]).toBe(true);
    expect(reverse[2]!.read_window).toBe(result!.read_window);
  });

  it('keeps observed terminal anchor errors rather than masking them as unknown', () => {
    const reference = 'ACGTTGCACTGATCGCGGATCCGTAGATTACAGTCGATCGTACGAAGTCCGATCATGCATGACCTAGTCA';
    const changed = reference.slice(0,-5)+reference.slice(-5).split('').map(b=>b==='A'?'C':'A').join('');
    for (const sequence of [changed,reverseComplement(changed)]) {
      const [usable,,result] = isReadUsable(sequence,null,reference,20,'',35);
      // Edit distance may accept a shifted terminal motif, but its observed
      // errors must still remain in the observation, never become X padding.
      if (usable) {
        expect(result!.right_x).toBe(0);
        expect(result!.read_window).toBe(changed);
      }
    }
  });

  it('should weight far-from-cut-site alignment positions higher when distanceWeight > 0', () => {
    const refWin = 'ACGTACGTACGTACGTACGTACGTACGTACGT';
    const cutIdx = 16;
    // Score with distanceWeight = 2.0 vs 0.0
    const scoreZeroWeight = scoreReadAgainstWindow(refWin, refWin, cutIdx, 0.0, 2);
    const scoreHighWeight = scoreReadAgainstWindow(refWin, refWin, cutIdx, 2.0, 2);

    expect(scoreZeroWeight).toBe(1.0);
    expect(scoreHighWeight).toBe(1.0);
  });

  it('penalizes both read insertions and deletions outside the configured exclusion', () => {
    const ref = 'ACGTTGCACTGATCGAGTCCGATCATGCATGACCTAGTCA';
    const inserted = ref.slice(0,10) + 'AAAA' + ref.slice(10);
    const deleted = ref.slice(0,10) + ref.slice(14);
    expect(scoreReadAgainstWindow(inserted,ref,25,0,0)).toBeLessThan(1);
    expect(scoreReadAgainstWindow(deleted,ref,25,0,0)).toBeLessThan(1);
    expect(scoreReadAgainstWindow(inserted,ref,10,0,5)).toBeCloseTo(1);
    expect(scoreReadAgainstWindow(deleted,ref,12,0,5)).toBeCloseTo(1);
    expect(scoreReadAgainstWindow(ref,ref)).toBe(1);
    expect(scoreReadAgainstWindow('X'.repeat(10)+ref.slice(10),ref,25)).toBe(1);
    expect(scoreReadAgainstWindow(ref.slice(0,-10)+'X'.repeat(10),ref,25)).toBe(1);
  });

  it('keeps both mates for mutation calls but scores only the located classification window', () => {
    const ref = 'ACGTTGCACTGATCGAGTCCGATCATGCATGACCTAGTCA';
    const guide = ref.slice(10,30);
    const read = 'GGGGGGGGGG'+ref+'TTTTTTTTTT'+'X'.repeat(40)+'ACACACACACACACACACAC';
    const [usable,,res] = isReadUsable(read,null,ref,20,guide,20);
    expect(usable).toBe(true);
    expect(res?.read_window).toBe(read);
    expect(res?.classification_window).toBe(ref);
    const result = applyClassification(read,null,[{gene:'A',target:'g',ref_window:ref,sgrna_seq:guide,cut_index_in_window:20}],20,.01);
    expect(result.top1_score).toBe(1);
  });

  describe('observed two-flank coverage across large deletions', () => {
    const left = 'ACGTTGCACTGATCG';
    const right = 'TGCATGACCTAGTCA';
    const reference = left + 'C'.repeat(170) + right;
    const junction = left + 'CC' + right;

    it('accepts a spanning molecule even when the offset-estimated cut is outside it', () => {
      clearClassifierCache();
      const [usable, reason, aligned] = isReadUsable(junction, null, reference, 20, '', 100);
      expect(usable).toBe(true);
      expect(reason).toBe('ok');
      expect(aligned?.read_window).toBe(junction);
      expect(aligned?.left_x).toBe(0);
      expect(aligned?.right_x).toBe(0);
    });

    it('accepts the reverse-complement orientation', () => {
      expect(isReadUsable(reverseComplement(junction), null, reference, 20, '', 100)[0]).toBe(true);
    });

    it('does not rescue terminal truncation with only one observed flank', () => {
      expect(isReadUsable(left + 'CC', null, reference, 20, '', 100)[0]).toBe(false);
      expect(isReadUsable('CC' + right, null, reference, 20, '', 100)[0]).toBe(false);
    });

    it('does not connect flanks separated by unobserved X bases', () => {
      expect(isReadUsable(left + 'X'.repeat(170) + right, null, reference, 20, '', 100)[0]).toBe(false);
      expect(isReadUsable('X'.repeat(200), null, reference, 20, '', 100)[0]).toBe(false);
    });

    it('does not rescue reversed anchors or a repeated ambiguous anchor pair', () => {
      expect(isReadUsable(right + 'CC' + left, null, reference, 20, '', 100)[0]).toBe(false);
      expect(isReadUsable(left + left + 'CC' + right, null, reference, 20, '', 100)[0]).toBe(false);
    });

    it('keeps the quality gate and ordinary WT reads unchanged', () => {
      expect(isReadUsable(junction, new Array(junction.length).fill(5), reference, 20, '', 100)[1]).toBe('quality');
      expect(isReadUsable(reference, null, reference, 20, '', 100)[0]).toBe(true);
    });

    it('does not relax minimum coverage for a short window without full 15-bp anchors', () => {
      const short = 'ACGTTGCACT';
      expect(isReadUsable(short, null, short, 20, '', 5)[0]).toBe(false);
    });
  });
});
