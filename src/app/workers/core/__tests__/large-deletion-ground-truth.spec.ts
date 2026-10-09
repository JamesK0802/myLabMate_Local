import {describe,it,expect} from 'vitest';
import {extractWindow,cutIndexInWindow,isReadUsable,clearClassifierCache} from '../classifier';
import {classifyMutationWithAlignment,clearAnalyzerCache} from '../analyzer';

describe('Deterministic large-deletion ground-truth controls',()=>{
  let seed=123456789;
  const dna=(n:number)=>Array.from({length:n},()=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return 'ACGT'[(seed>>>28)&3];
  }).join('');
  const reference=dna(466);
  for(const size of [200,240,280,320,360,400]){
    for(const jitter of [-5,0,5]){
      it(`recovers a contiguous ${size}-bp deletion at cut jitter ${jitter}`,()=>{
        clearClassifierCache(); clearAnalyzerCache();
        const start=Math.floor((466-size)/2)+jitter;
        const seq=reference.slice(0,start)+reference.slice(start+size);
        const win=extractWindow(reference,232,466);
        const cut=cutIndexInWindow(reference,232,466);
        const [ok,,r]=isReadUsable(seq,null,win,20,'',cut);
        expect(ok).toBe(true);
        const mutation=classifyMutationWithAlignment(win,r!.read_window!,r!.left_x!,r!.right_x!);
        expect(mutation.net_indel).toBe(-size);
        expect(mutation.tokens.filter(t=>t.type==='delete')).toHaveLength(1);
        expect(mutation.tokens.filter(t=>t.type==='insert'||t.type==='substitute'||t.type==='unobserved')).toHaveLength(0);
      });
    }
  }
});
