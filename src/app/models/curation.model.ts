/**
 * Curation / Subset configuration model.
 *
 * A CurationConfig describes which items to EXCLUDE from a curated view.
 * The original result data is never mutated — the config is applied as a
 * derived-state layer by CurationService.
 */

export interface CurationConfig {
  /** Title of the source (original) result */
  sourceResultTitle: string;

  /** UUID of the source result, if it was saved to the DB */
  sourceResultId?: string;

  /** User-given name for this curated view */
  curatedViewName: string;

  /** ISO-8601 timestamp when the curation was created */
  createdAt: string;

  // ── Exclusion sets ────────────────────────────────────────────────────────
  // All stored as stable string identifiers.

  /** Excluded FASTQ file names (matches fastq_file field) */
  excludedFiles: string[];

  /** Excluded gene names */
  excludedGenes: string[];

  /** Excluded targets as "gene::target_id" composite keys */
  excludedTargets: string[];

  /** Excluded annotation groups as "gene::target_id::read_inner" composite keys */
  excludedGroups: string[];
}

/** Create a blank CurationConfig with empty exclusion lists. */
export function emptyCurationConfig(): CurationConfig {
  return {
    sourceResultTitle: '',
    curatedViewName: '',
    createdAt: new Date().toISOString(),
    excludedFiles: [],
    excludedGenes: [],
    excludedTargets: [],
    excludedGroups: []
  };
}

// ── Helper key builders ──────────────────────────────────────────────────────

export function targetKey(gene: string, targetId: string): string {
  return `${gene}::${targetId}`;
}

export function groupKey(gene: string, targetId: string, readInner: string): string {
  return `${gene}::${targetId}::${readInner}`;
}
