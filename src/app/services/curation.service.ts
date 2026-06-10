import { Injectable } from '@angular/core';
import { CurationConfig, targetKey, groupKey } from '../models/curation.model';
import {
  GeneResult,
  TargetResult,
  MutationGroup,
  AnalysisSummary,
  AnalysisBreakdown,
  MultiReferenceResponse
} from '../models/analysis.model';

/**
 * Result-slot-like shape produced by curation computation.
 * Only the fields that change during curation are included here;
 * the caller merges them back into the live ResultSlot.
 */
export interface CuratedOutput {
  genes: GeneResult[];
  mergedGenes: GeneResult[];
  ambiguousReadCount: number;
  totalMergedAmbiguous: number;
  totalRawReads: number;
  totalMergedRawReads: number;
  totalPhredPassed: number;
  totalMergedPhredPassed: number;
  totalAnchorMatched: number;
  totalMergedAnchorMatched: number;
  allFileResults: any[];
  multiFileCount: number;
}

@Injectable({ providedIn: 'root' })
export class CurationService {

  // ── Master entry point ─────────────────────────────────────────────────────

  /**
   * Produce a fully recalculated curated result from the original data
   * and the curation configuration.  Nothing is mutated in-place — the
   * returned object is a deep-cloned, filtered, recalculated copy.
   */
  computeCuratedResult(
    originalAllFileResults: any[],
    originalMergedGenes: GeneResult[],
    originalTotalMergedAmbiguous: number,
    originalTotalMergedRawReads: number,
    originalTotalMergedPhredPassed: number,
    originalTotalMergedAnchorMatched: number,
    config: CurationConfig
  ): CuratedOutput {

    // 1. Deep clone the file results so we never touch the originals
    const clonedFiles: any[] = JSON.parse(JSON.stringify(originalAllFileResults));

    // 2. Filter files
    const includedFiles = clonedFiles.filter(
      fr => !config.excludedFiles.includes(this.extractFileName(fr.fastq_file))
    );

    // 3. For each file (included or excluded), filter genes/targets/groups inside its MRD
    // This allows excluded files to still be viewed with gene/target/group curations applied.
    for (const fr of clonedFiles) {
      const mrd = fr.multi_reference_result as MultiReferenceResponse | undefined;
      if (!mrd?.genes) continue;
      mrd.genes = this.filterAndRecalcGenes(mrd.genes, config);
    }

    // 4. Rebuild merged genes across included files
    const merged = this.rebuildMergedGenes(includedFiles, config);

    // 5. Recalculate aggregated debug totals from included files
    let totalAmb = 0, totalRaw = 0, totalPhred = 0, totalAnchor = 0;
    for (const fr of includedFiles) {
      const mrd = fr.multi_reference_result as MultiReferenceResponse | undefined;
      if (!mrd) continue;
      totalAmb += mrd.ambiguous_read_count ?? 0;
      totalRaw += mrd.debug?.total_reads_parsed ?? 0;
      totalPhred += mrd.debug?.phred_passed_count ?? 0;
      totalAnchor += mrd.debug?.usable_for_assignment_count ?? mrd.debug?.anchor_matched_count ?? 0;
    }

    return {
      genes: merged,        // will be replaced by updateVisibleGenes
      mergedGenes: merged,
      ambiguousReadCount: totalAmb,
      totalMergedAmbiguous: totalAmb,
      totalRawReads: totalRaw,
      totalMergedRawReads: totalRaw,
      totalPhredPassed: totalPhred,
      totalMergedPhredPassed: totalPhred,
      totalAnchorMatched: totalAnchor,
      totalMergedAnchorMatched: totalAnchor,
      allFileResults: clonedFiles,
      multiFileCount: clonedFiles.length
    };
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  private extractFileName(path: string): string {
    return (path || '').split('/').pop() || path || '';
  }

  /**
   * Filter genes, targets, and groups according to config, then recalculate
   * stats for every remaining target from its included groups.
   */
  private filterAndRecalcGenes(genes: GeneResult[], config: CurationConfig): GeneResult[] {
    return genes
      .filter(g => !config.excludedGenes.includes(g.gene))
      .map(g => {
        const filteredTargets = (g.analysis_result?.targets ?? [])
          .filter(t => !config.excludedTargets.includes(targetKey(g.gene, t.target_id)))
          .map(t => this.recalcTarget(t, g.gene, config));

        // Recompute gene-level assigned_read_count from included targets
        const totalAssigned = filteredTargets.reduce(
          (s, t) => s + (t.summary?.aligned_reads ?? 0), 0
        );

        return {
          ...g,
          assigned_read_count: totalAssigned,
          analysis_result: {
            ...g.analysis_result,
            targets: filteredTargets
          }
        } as GeneResult;
      });
  }

  /**
   * For one target: filter out excluded groups, then recompute breakdown,
   * summary and group-level percentages from the included groups only.
   */
  private recalcTarget(target: TargetResult, geneName: string, config: CurationConfig): TargetResult {
    const allGroups: MutationGroup[] = target.top_groups ?? [];

    const includedGroups = allGroups.filter(
      g => !config.excludedGroups.includes(groupKey(geneName, target.target_id, g.read_inner))
    );
    const excludedGroups = allGroups.filter(
      g => config.excludedGroups.includes(groupKey(geneName, target.target_id, g.read_inner))
    );

    const includedReads = includedGroups.reduce((s, g) => s + g.read_count, 0);

    // Recompute breakdown from included groups
    let outOfFrame = 0, inFrame = 0, noIndel = 0, substitution = 0;
    for (const g of includedGroups) {
      const c = (g.classification || '').toLowerCase();
      if (c.includes('out-of-frame') || c.includes('out_of_frame')) outOfFrame += g.read_count;
      else if (c.includes('in-frame') || c.includes('in_frame')) inFrame += g.read_count;
      else if (c.includes('no indel') || c.includes('no_indel')) noIndel += g.read_count;
      else if (c.includes('substitution')) substitution += g.read_count;
    }

    const pct = (v: number) => includedReads > 0
      ? Math.round((v / includedReads) * 10000) / 100
      : 0;

    const newBreakdown: AnalysisBreakdown = {
      out_of_frame: outOfFrame,
      in_frame: inFrame,
      no_indel: noIndel,
      substitution: substitution,
      ambiguous: target.breakdown?.ambiguous ?? 0,
      failed: target.breakdown?.failed ?? 0,
      failure_reasons: target.breakdown?.failure_reasons
    };

    const modified = outOfFrame + inFrame;
    const excludedReads = excludedGroups.reduce((s, g) => s + g.read_count, 0);

    const newSummary: AnalysisSummary = {
      ...target.summary,
      total_reads: Math.max(0, (target.summary?.total_reads ?? 0) - excludedReads),
      matched_reads: Math.max(0, (target.summary?.matched_reads ?? 0) - excludedReads),
      aligned_reads: Math.max(0, (target.summary?.aligned_reads ?? 0) - excludedReads),
      unmodified: noIndel,
      modified: modified,
      editing_efficiency: pct(modified),
      out_of_frame_pct: pct(outOfFrame),
      in_frame_pct: pct(inFrame),
      no_indel_pct: pct(noIndel),
      substitution_pct: pct(substitution),
      substitution_reads: substitution,
      indel_editing_efficiency: pct(modified),
      failed_reads: target.summary?.failed_reads ?? 0
    };

    // Recompute group-level percentages and re-rank for included groups
    const rankedIncluded = includedGroups
      .sort((a, b) => b.read_count - a.read_count)
      .map((g, i) => ({
        ...g,
        group_rank: i + 1,
        read_pct: pct(g.read_count)
      }));

    // Re-rank excluded groups at the bottom
    const rankedExcluded = excludedGroups
      .sort((a, b) => b.read_count - a.read_count)
      .map((g, i) => ({
        ...g,
        group_rank: includedGroups.length + i + 1,
        read_pct: pct(g.read_count)
      }));

    const rankedGroups = [...rankedIncluded, ...rankedExcluded];

    return {
      ...target,
      summary: newSummary,
      breakdown: newBreakdown,
      top_groups: rankedGroups
    };
  }

  /**
   * Merge genes across multiple files (same logic as AppStateService.handleAnalysisComplete
   * but operating on already-filtered data).
   */
  private rebuildMergedGenes(fileResults: any[], config: CurationConfig): GeneResult[] {
    const geneMap = new Map<string, GeneResult>();

    for (const fileResult of fileResults) {
      const mrd: MultiReferenceResponse | undefined = fileResult?.multi_reference_result;
      if (!mrd) continue;

      for (const geneRes of (mrd.genes ?? [])) {
        if (geneMap.has(geneRes.gene)) {
          const ex = geneMap.get(geneRes.gene)!;
          ex.assigned_read_count += geneRes.assigned_read_count;

          if (ex.analysis_result?.targets && geneRes.analysis_result?.targets) {
            ex.analysis_result.targets.forEach((extT: any, tidx: number) => {
              const newT = geneRes.analysis_result.targets[tidx];
              if (!newT) return;

              const s1 = extT.summary, s2 = newT.summary;
              const b1 = extT.breakdown || { out_of_frame: 0, in_frame: 0, no_indel: 0, substitution: 0, failed: 0 };
              const b2 = newT.breakdown || { out_of_frame: 0, in_frame: 0, no_indel: 0, substitution: 0, failed: 0 };

              b1.out_of_frame += b2.out_of_frame || 0;
              b1.in_frame += b2.in_frame || 0;
              b1.no_indel += b2.no_indel || 0;
              b1.substitution += b2.substitution || 0;
              b1.failed = (b1.failed || 0) + (b2.failed || b2.ambiguous || 0);
              b1.ambiguous = b1.failed;
              extT.breakdown = b1;

              s1.total_reads += s2.total_reads;
              s1.matched_reads += s2.matched_reads;
              s1.aligned_reads += s2.aligned_reads;

              const ta = s1.aligned_reads || 1;
              const pct = (v: number) => Math.round((v / ta) * 10000) / 100;

              s1.out_of_frame_pct = pct(b1.out_of_frame);
              s1.in_frame_pct = pct(b1.in_frame);
              s1.no_indel_pct = pct(b1.no_indel);
              s1.substitution_pct = pct(b1.substitution);
              s1.modified = b1.out_of_frame + b1.in_frame;
              s1.unmodified = b1.no_indel;
              s1.substitution_reads = b1.substitution;
              s1.editing_efficiency = pct(s1.modified);
              s1.indel_editing_efficiency = pct(s1.modified);
              s1.substitution_policy = 'separate_category_indel_editing_excludes_substitutions';
              s1.failed_reads = b1.failed;

              if (newT.top_groups && extT.top_groups) {
                const gm = new Map<string, any>();
                [...extT.top_groups, ...newT.top_groups].forEach((g: any) => {
                  if (gm.has(g.read_inner)) {
                    gm.get(g.read_inner).read_count += g.read_count;
                  } else {
                    gm.set(g.read_inner, { ...g });
                  }
                });
                
                const allMergedGroups = Array.from(gm.values());
                const targetId = extT.target_id;
                
                const includedGroups = allMergedGroups.filter(
                  g => !config.excludedGroups.includes(groupKey(geneRes.gene, targetId, g.read_inner))
                );
                const excludedGroups = allMergedGroups.filter(
                  g => config.excludedGroups.includes(groupKey(geneRes.gene, targetId, g.read_inner))
                );

                const rankedIncluded = includedGroups
                  .sort((a, b) => b.read_count - a.read_count)
                  .map((g, i) => ({
                    ...g,
                    group_rank: i + 1,
                    read_pct: pct(g.read_count)
                  }));

                const rankedExcluded = excludedGroups
                  .sort((a, b) => b.read_count - a.read_count)
                  .map((g, i) => ({
                    ...g,
                    group_rank: includedGroups.length + i + 1,
                    read_pct: pct(g.read_count)
                  }));

                extT.top_groups = [...rankedIncluded, ...rankedExcluded];
              }
            });
          }
        } else {
          geneMap.set(geneRes.gene, JSON.parse(JSON.stringify(geneRes)));
        }
      }
    }

    return Array.from(geneMap.values());
  }
}
