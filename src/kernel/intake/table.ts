/**
 * kernel/intake/table.ts — the shape of a workspace preset's classification
 * table, and the static registry of the four presets ported from v2.
 *
 * v2 resolved a preset's table two ways: a static id→module map, and a
 * repo-relative `classificationTable` path it `require()`d at call time. Only
 * the first survives the port. A kernel module that reads a path off a config
 * object and loads code from the repo it happens to be running in is exactly
 * the ambient-repo assumption this rewrite exists to remove — so a caller with
 * a custom table now passes the table itself (classify accepts a
 * ClassificationTable directly), which is strictly more capable and involves no
 * filesystem at all.
 */

export interface ClassificationEntry {
  readonly intakeType: string;
  readonly keywords: readonly string[];
  readonly rdStage: string;
  readonly primaryOwner: string;
  readonly recommendedChain: readonly string[];
  readonly recommendedAction: string;
  readonly risk: string;
  readonly requiresApproval: boolean;
}

export interface Triage {
  readonly intakeType: string;
  readonly rdStage: string;
  readonly primaryOwner: string;
  readonly recommendedChain: readonly string[];
  readonly recommendedAction: string;
  readonly risk: string;
  readonly requiresApproval: boolean;
}

export interface ClassificationTable {
  readonly id: string;
  readonly INTAKE_TYPES: readonly string[];
  readonly STAGES: readonly string[];
  /** Fallback triage when nothing in the table matched. */
  readonly UNKNOWN_TRIAGE: Triage;
  /** Curated order — classify breaks score ties by it, so it is load-bearing. */
  readonly CLASSIFICATION_TABLE: readonly ClassificationEntry[];
}

import rndTable from './tables/rnd.ts';
import operationsTable from './tables/operations.ts';
import creativeTable from './tables/creative.ts';
import researchTable from './tables/research.ts';

export const DEFAULT_PRESET_ID = 'rnd';

export const TABLES: Readonly<Record<string, ClassificationTable>> = {
  rnd: rndTable,
  operations: operationsTable,
  creative: creativeTable,
  research: researchTable,
};

export const DEFAULT_TABLE = rndTable;

/**
 * The set of recommended next actions a triage can name. Ported from v2's
 * classify.mjs, where it was exported for callers to validate against.
 */
export const RECOMMENDED_ACTIONS = [
  'summarize',
  'clarify',
  'research',
  'create-hypothesis',
  'draft-prd',
  'draft-rfc',
  'draft-adr',
  'create-experiment',
  'diagnose',
  'implement',
  'evaluate',
  'release-review',
  'create-runbook',
  'archive',
] as const;

export { rndTable, operationsTable, creativeTable, researchTable };
