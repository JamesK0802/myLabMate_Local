import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { FormControl, FormGroup } from '@angular/forms';
import { AnalysisPageComponent } from './analysis-page.component';
import { extractWindow, findGrnaCutSite } from '../../workers/core/classifier';

const guide = 'ACGTTACGATCGTACCTGAC';
function gene(left: string, right: string) {
  return { gene_reference: left + guide + 'AGG' + right, geneTargets: [{ gRNA: guide }] };
}
function setup(genes: any[], overrides: Record<string, any[]> = {}) {
  const page = Object.create(AnalysisPageComponent.prototype) as AnalysisPageComponent;
  const form = new FormGroup({ genes: new FormControl(genes), customWindowEnabled: new FormControl(false),
    customWindowLeft: new FormControl(0), customWindowRight: new FormControl(0) });
  (page as any).state = { analysisForm: form, activeReferenceKey: 'default', referenceConfigs: overrides };
  return { page, form };
}
describe('Cover full ref', () => {
  it('enables asymmetric windows and covers every reference including file overrides', () => {
    const genes = [gene('AAAA', 'TT')];
    const other = gene('A'.repeat(50), 'T'.repeat(80));
    const { page, form } = setup(genes, { default: [], file: [other] });
    page.coverFullReference();
    const v = form.getRawValue();
    expect(v.customWindowEnabled).toBe(true);
    for (const g of [...genes, other]) {
      const cut = findGrnaCutSite(g.gene_reference, guide).cut_site;
      expect(extractWindow(g.gene_reference, cut, v.customWindowLeft! + v.customWindowRight!, v.customWindowLeft!, v.customWindowRight!)).toBe(g.gene_reference);
    }
    expect(v.customWindowLeft).toBe(findGrnaCutSite(other.gene_reference, guide).cut_site);
    expect(v.customWindowRight).toBe(other.gene_reference.length - v.customWindowLeft!);
  });
  it('does not invent a midpoint when a guide is absent', () => {
    const { page, form } = setup([{ gene_reference: 'AAAA', geneTargets: [{ gRNA: guide }] }]);
    page.coverFullReference();
    expect(page.fullRefWindowError).toBeTruthy();
    expect(form.getRawValue().customWindowEnabled).toBe(false);
  });
  it('asks for a reference when configuration is empty', () => {
    const { page, form } = setup([]);
    page.coverFullReference();
    expect(page.fullRefWindowError).toBeTruthy();
    expect(form.getRawValue().customWindowEnabled).toBe(false);
  });
});
