import {
  ClassInfo,
  applyGeneClassification,
  cutIndexInWindow,
  extractWindow,
  findGrnaCutSite,
  isReadUsable,
} from './classifier';
import { FastqRead } from './fastq-parser';

export interface BenchmarkInputRow {
  gene: string;
  target: string;
  reference: string;
  grna: string;
  reads: FastqRead[];
}

export interface BenchmarkOptions {
  phredThreshold: number;
  windowSize: number;
  marginThreshold: number;
  cutSiteDistanceWeight?: number;
  cutSiteExclusionFlank?: number;
  customWindowLeft?: number;
  customWindowRight?: number;
  platform?: 'nanopore' | 'illumina';
  preprocessing?: {
    inputMolecules: number;
    normalizedMolecules: number;
    filteredMolecules: number;
    consensusMolecules: number;
    paddedMolecules: number;
  };
}

/** Benchmark the current deterministic allocator over every supplied read. */
export function runBenchmark(
  dataset: BenchmarkInputRow[],
  options: BenchmarkOptions,
  progressCallback: (pct: number, stage: string) => void
): any {
  progressCallback(5, 'Building current target windows…');

  const geneClasses: Record<string, ClassInfo[]> = {};
  const trueContexts: Record<string, ClassInfo> = {};
  const cutSiteReport: any[] = [];

  dataset.forEach((row, index) => {
    const reference = row.reference.trim().toUpperCase();
    const grna = row.grna.trim().toUpperCase();
    const cut = findGrnaCutSite(reference, grna);
    if (cut.grna_start < 0) throw new Error(`gRNA was not found in the reference for ${row.gene} › ${row.target}.`);
    const refWindow = extractWindow(reference, cut.cut_site, options.windowSize, options.customWindowLeft, options.customWindowRight);
    const cutIndex = cutIndexInWindow(reference, cut.cut_site, options.windowSize, options.customWindowLeft, options.customWindowRight);
    const classInfo: ClassInfo = {
      gene: row.gene,
      target: row.target,
      ref_window: refWindow,
      sgrna_seq: grna,
      cut_index_in_window: cutIndex,
    };
    (geneClasses[row.gene] ||= []).push(classInfo);
    trueContexts[`${row.gene}\u0000${row.target}`] = classInfo;
    cutSiteReport.push({
      gene: row.gene, target: row.target, strand: cut.strand, cut_site: cut.cut_site,
      grna_start: cut.grna_start, grna_end: cut.grna_end, pam: cut.pam, pam_found: cut.pam_found,
    });
    progressCallback(5 + Math.round(((index + 1) / Math.max(1, dataset.length)) * 10), `Window: ${row.gene} › ${row.target}`);
  });

  const taggedReads = dataset.flatMap(row => row.reads.map(read => ({ ...read, true_gene: row.gene, true_target: row.target })));
  if (!taggedReads.length) throw new Error('No FASTQ reads were available for benchmarking.');

  const counts: {
    filtered: number; usable: number; correct: number; wrong: number; ambiguous: number;
    fail_no_anchor: number; fail_quality: number; fail_similarity: number;
    fail_no_coverage: number; fail_no_alignment: number; [key: string]: number;
  } = {
    filtered: 0, usable: 0, correct: 0, wrong: 0, ambiguous: 0,
    fail_no_anchor: 0, fail_quality: 0, fail_similarity: 0,
    fail_no_coverage: 0, fail_no_alignment: 0,
  };
  const perClass: Record<string, any> = {};
  dataset.forEach(row => {
    const key = `${row.gene}\u0000${row.target}`;
    perClass[key] ||= { gene: row.gene, target: row.target, total: 0, correct: 0, wrong: 0, ambiguous: 0, filtered: 0 };
  });

  progressCallback(15, `Classifying ${taggedReads.length.toLocaleString()} reads with the current allocator…`);
  taggedReads.forEach((read, index) => {
    const key = `${read.true_gene}\u0000${read.true_target}`;
    const metrics = perClass[key];
    metrics.total++;
    const result = applyGeneClassification(
      read.seq, read.qual, geneClasses, options.phredThreshold, options.marginThreshold,
      options.cutSiteDistanceWeight ?? 0, options.cutSiteExclusionFlank ?? 0
    );

    if (!result.assigned) {
      if (result.reason === 'filtered') {
        const trueContext = trueContexts[key];
        const [, failReason] = isReadUsable(
          read.seq, read.qual, trueContext.ref_window, options.phredThreshold,
          trueContext.sgrna_seq || '', trueContext.cut_index_in_window ?? -1
        );
        counts.filtered++;
        counts[`fail_${failReason}`] = (counts[`fail_${failReason}`] || 0) + 1;
        metrics.filtered++;
      } else {
        counts.usable++;
        counts.ambiguous++;
        metrics.ambiguous++;
      }
    } else {
      counts.usable++;
      if (result.predicted_gene === read.true_gene) {
        counts.correct++;
        metrics.correct++;
      } else {
        counts.wrong++;
        metrics.wrong++;
      }
    }

    if (index % 500 === 0 || index === taggedReads.length - 1) {
      progressCallback(15 + Math.round(((index + 1) / taggedReads.length) * 85), `Classified ${(index + 1).toLocaleString()} / ${taggedReads.length.toLocaleString()} reads`);
    }
  });

  const total = taggedReads.length;
  const usable = counts.usable;
  const pct = (value: number, denominator: number) => denominator ? Math.round((value / denominator) * 1000) / 10 : 0;
  const formattedPerClass = Object.values(perClass).map((entry: any) => ({
    ...entry,
    correct_rate: pct(entry.correct, entry.correct + entry.wrong + entry.ambiguous),
  }));
  const prep = options.preprocessing;

  return {
    subset: 'all', platform: options.platform || 'nanopore', total, total_reads: total,
    usable, usable_reads: usable, usable_rate: pct(usable, total),
    filtered_out: counts.filtered, filtered: counts.filtered,
    correct: counts.correct, correct_count: counts.correct,
    wrong: counts.wrong, wrong_count: counts.wrong,
    ambiguous: counts.ambiguous, ambiguous_count: counts.ambiguous,
    correct_rate: pct(counts.correct, usable), wrong_rate: pct(counts.wrong, usable),
    ambiguous_rate: pct(counts.ambiguous, usable), correct_rate_total: pct(counts.correct, total),
    wrong_rate_total: pct(counts.wrong, total), ambiguous_rate_total: pct(counts.ambiguous, total),
    fail_no_anchor: counts.fail_no_anchor || 0, fail_quality: counts.fail_quality || 0,
    fail_similarity: counts.fail_similarity || 0, fail_no_coverage: counts.fail_no_coverage || 0,
    fail_no_alignment: counts.fail_no_alignment || 0,
    per_class: formattedPerClass, split_info: [], cut_sites: cutSiteReport,
    preprocessing: prep ? {
      input_molecules: prep.inputMolecules,
      normalized_molecules: prep.normalizedMolecules,
      filtered_molecules: prep.filteredMolecules,
      consensus_molecules: prep.consensusMolecules,
      padded_molecules: prep.paddedMolecules,
    } : undefined,
  };
}
