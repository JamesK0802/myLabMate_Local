import { findGrnaCutSite, extractWindow, isReadUsable, applyClassification } from './classifier';

import { FastqRead } from './fastq-parser';

export interface BenchmarkInputRow {
  gene: string;
  target: string;
  reference: string;
  grna: string;
  reads: FastqRead[];
}

export function runSplitPreview(dataset: any[]): any {
  const rows = [];
  for (const row of dataset) {
    const total = row.reads.length;
    const train_cnt = Math.floor(total * 0.8);
    rows.push({
      gene: row.gene,
      target: row.target,
      total: total,
      train_count: train_cnt,
      test_count: total - train_cnt
    });
  }
  return {
    rows,
    total: rows.reduce((sum, r) => sum + r.total, 0),
    train_count: rows.reduce((sum, r) => sum + r.train_count, 0),
    test_count: rows.reduce((sum, r) => sum + r.test_count, 0)
  };
}

export function runBenchmark(
  dataset: BenchmarkInputRow[],
  phredThreshold: number,
  window: number,
  margin: number,
  subset: 'train' | 'test',
  progressCallback: (pct: number, stage: string) => void
): any {
  const totalRows = dataset.length;
  progressCallback(5, "Deriving cut sites from gRNA + PAM…");

  const cutSiteInfo: Record<string, any> = {};
  const targetsInfoMap: Record<string, any> = {};

  for (let i = 0; i < totalRows; i++) {
    const row = dataset[i];
    const key = `${row.gene}::${row.target}`;
    const refStr = row.reference.trim().toUpperCase();
    const grnaStr = row.grna.trim().toUpperCase();
    const ci = findGrnaCutSite(refStr, grnaStr);
    const refWin = extractWindow(refStr, ci.cut_site, window);

    cutSiteInfo[key] = ci;
    targetsInfoMap[key] = {
      gene: row.gene,
      target: row.target,
      ref_window: refWin,
      sgrna_seq: grnaStr,
      cut_index_in_window: ci.cut_site
    };

    const pct = Math.round(5 + ((i + 1) / totalRows) * 10);
    progressCallback(pct, `Cut site: ${row.gene} › ${row.target} (${ci.strand}, pos ${ci.cut_site}, PAM=${ci.pam_found ? '✓' : '✗ fallback'})`);
  }

  const targetsList = Object.values(targetsInfoMap);

  progressCallback(15, "Tagging and splitting reads…");
  const allReads: any[] = [];
  const splitInfo: any[] = [];
  const cutSiteReport: any[] = [];

  for (let i = 0; i < totalRows; i++) {
    const row = dataset[i];
    const key = `${row.gene}::${row.target}`;
    const ci = cutSiteInfo[key];

    const readsTagged = row.reads.map(r => ({
      seq: r.seq,
      qual: r.qual,
      true_gene: row.gene,
      true_target: row.target
    }));

    // Seeded shuffle to match python's random.shuffle with seed 42
    let seed = 42;
    function random() {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    }

    for (let j = readsTagged.length - 1; j > 0; j--) {
      const randIdx = Math.floor(random() * (j + 1));
      const tmp = readsTagged[j];
      readsTagged[j] = readsTagged[randIdx];
      readsTagged[randIdx] = tmp;
    }

    const splitIdx = Math.floor(readsTagged.length * 0.8);
    const trainPart = readsTagged.slice(0, splitIdx);
    const testPart = readsTagged.slice(splitIdx);

    splitInfo.push({
      gene: row.gene,
      target: row.target,
      total: readsTagged.length,
      train_count: trainPart.length,
      test_count: testPart.length
    });

    cutSiteReport.push({
      gene: row.gene,
      target: row.target,
      strand: ci.strand,
      cut_site: ci.cut_site,
      grna_start: ci.grna_start,
      grna_end: ci.grna_end,
      pam: ci.pam,
      pam_found: ci.pam_found
    });

    if (subset === 'train') {
      allReads.push(...trainPart);
    } else {
      allReads.push(...testPart);
    }
  }

  const totalReads = allReads.length;
  if (totalReads === 0) {
    return { error: 'No reads in selected subset' };
  }

  progressCallback(25, `Classifying ${totalReads.toLocaleString()} reads (${subset} subset)…`);

  const counts: any = {
    total: totalReads,
    filtered: 0,
    usable: 0,
    correct: 0,
    wrong: 0,
    ambiguous: 0,
    fail_no_anchor: 0,
    fail_quality: 0,
    fail_similarity: 0,
    fail_no_coverage: 0,
    fail_no_alignment: 0
  };

  const perClassMetrics: Record<string, any> = {};
  for (const t of targetsList) {
    const k = `${t.gene}::${t.target}`;
    perClassMetrics[k] = {
      gene: t.gene,
      target: t.target,
      true_total: 0,
      correct: 0,
      wrong: 0,
      ambiguous: 0,
      filtered: 0
    };
  }

  const batchSize = 500;
  for (let i = 0; i < totalReads; i += batchSize) {
    const batch = allReads.slice(i, i + batchSize);
    for (const r of batch) {
      const classKey = `${r.true_gene}::${r.true_target}`;
      perClassMetrics[classKey].true_total += 1;

      // Classify read
      const res = applyClassification(r.seq, r.qual, targetsList, phredThreshold, margin);

      if (!res.assigned) {
        if (res.reason === 'filtered') {
          // Check usability fail reason on true reference window
          const trueWin = targetsInfoMap[classKey].ref_window;
          const trueSgrna = targetsInfoMap[classKey].sgrna_seq;
          const trueCutIdx = targetsInfoMap[classKey].cut_index_in_window;
          const [, failReason] = isReadUsable(r.seq, r.qual, trueWin, phredThreshold, trueSgrna, trueCutIdx);
          counts.filtered += 1;
          counts[`fail_${failReason}`] = (counts[`fail_${failReason}`] || 0) + 1;
          perClassMetrics[classKey].filtered += 1;
        } else {
          counts.usable += 1;
          counts.ambiguous += 1;
          perClassMetrics[classKey].ambiguous += 1;
        }
      } else {
        counts.usable += 1;
        if (res.predicted_gene === r.true_gene && res.predicted_target === r.true_target) {
          counts.correct += 1;
          perClassMetrics[classKey].correct += 1;
        } else {
          counts.wrong += 1;
          perClassMetrics[classKey].wrong += 1;
        }
      }
    }

    if (i % 1000 === 0 || i + batch.length === totalReads) {
      const pct = Math.round(25 + (i / totalReads) * 70);
      progressCallback(pct, `Classified ${(i + batch.length).toLocaleString()} / ${totalReads.toLocaleString()} reads`);
    }
  }

  progressCallback(100, "Benchmark complete");

  const usableCnt = counts.usable;
  const usableRate = totalReads > 0 ? Math.round((usableCnt / totalReads) * 1000) / 10 : 0;

  const correctRate = usableCnt > 0 ? Math.round((counts.correct / usableCnt) * 1000) / 10 : 0;
  const wrongRate = usableCnt > 0 ? Math.round((counts.wrong / usableCnt) * 1000) / 10 : 0;
  const ambiguousRate = usableCnt > 0 ? Math.round((counts.ambiguous / usableCnt) * 1000) / 10 : 0;

  const correctRateTotal = totalReads > 0 ? Math.round((counts.correct / totalReads) * 1000) / 10 : 0;
  const wrongRateTotal = totalReads > 0 ? Math.round((counts.wrong / totalReads) * 1000) / 10 : 0;
  const ambiguousRateTotal = totalReads > 0 ? Math.round((counts.ambiguous / totalReads) * 1000) / 10 : 0;

  const formattedPerClass = Object.values(perClassMetrics).map((m: any) => {
    const cTotal = m.true_total;
    const cUsable = m.correct + m.wrong + m.ambiguous;
    m.total = cTotal;
    m.correct_rate = cUsable > 0 ? Math.round((m.correct / cUsable) * 1000) / 10 : 0;
    return m;
  });

  return {
    subset,
    total: totalReads,
    total_reads: totalReads,
    usable: usableCnt,
    usable_reads: usableCnt,
    usable_rate: usableRate,
    filtered_out: counts.filtered,
    filtered: counts.filtered,

    correct: counts.correct,
    correct_count: counts.correct,
    wrong: counts.wrong,
    wrong_count: counts.wrong,
    ambiguous: counts.ambiguous,
    ambiguous_count: counts.ambiguous,

    correct_rate: correctRate,
    wrong_rate: wrongRate,
    ambiguous_rate: ambiguousRate,

    correct_rate_total: correctRateTotal,
    wrong_rate_total: wrongRateTotal,
    ambiguous_rate_total: ambiguousRateTotal,

    fail_no_anchor: counts.fail_no_anchor || 0,
    fail_quality: counts.fail_quality || 0,
    fail_similarity: counts.fail_similarity || 0,
    fail_no_coverage: counts.fail_no_coverage || 0,
    fail_no_alignment: counts.fail_no_alignment || 0,

    per_class: formattedPerClass,
    split_info: splitInfo,
    cut_sites: cutSiteReport
  };
}
