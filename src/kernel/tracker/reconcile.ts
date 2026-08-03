/**
 * kernel/tracker/reconcile.ts — detect and report drift between the live tracker
 * and the projected work model. Ported from the predecessor's
 * lib/tracker-projection/reconcile.mjs.
 *
 * The rule, straight out of kernel/tracker/authority.ts: a domain-owned field is
 * never overwritten by the tracker, and a tracker-owned field is never
 * overwritten by the domain. Everything here follows from that. A divergence on
 * a tracker-owned field is an ABSORBED legitimate tracker update (the snapshot
 * adopts it); a divergence on a domain-owned field is a CONFLICT — reported as
 * drift, never clobbered.
 *
 * Pure, like the rest of kernel/tracker: no IO and no tracker access. The
 * store-aware half lives in kernel/store/reconcile.ts.
 *
 * Changed from v2, for the same reason projection.ts changed: v2 defaulted
 * `reconciledAt` to `new Date().toISOString()`, so reconciling read the clock and
 * two identical reconciles were never equal. Here the timestamp is a required
 * argument. The kernel does not read the clock; the host supplies the time.
 */

import { AUTHORITY } from './authority.ts';
import { valuesEqual } from './projection.ts';
import type { Projection, ProjectionState } from './projection.ts';

export interface AbsorbedField {
  readonly field: string;
  readonly from: unknown;
  readonly to: unknown;
}

export interface ConflictField {
  readonly field: string;
  readonly domain: unknown;
  readonly tracker: unknown;
}

export interface ReconcileResult {
  readonly external_id: string;
  readonly state: ProjectionState;
  readonly absorbed: readonly AbsorbedField[];
  readonly conflicts: readonly ConflictField[];
}

export interface ReconcileOptions {
  /**
   * The domain-authoritative record, when a materialized one exists. Without it
   * the projection's captured `fields` snapshot is the domain baseline.
   */
  readonly domainRecord?: Record<string, unknown> | null;
}

/** Reconcile one projection against its current live tracker issue. */
export function reconcileProjection(
  projection: Projection,
  liveIssue: Record<string, unknown> | null,
  options: ReconcileOptions = {},
): ReconcileResult {
  const domainRecord = options.domainRecord ?? null;
  const absorbed: AbsorbedField[] = [];
  const conflicts: ConflictField[] = [];

  for (const [field, authority] of Object.entries(projection.field_authority ?? {})) {
    const liveValue = liveIssue ? liveIssue[field] : undefined;

    if (authority === AUTHORITY.TRACKER) {
      const snapshotValue = projection.fields?.[field];
      if (!valuesEqual(liveValue, snapshotValue)) {
        absorbed.push({ field, from: snapshotValue, to: liveValue });
      }
      continue;
    }

    const authoritativeValue =
      domainRecord && field in domainRecord ? domainRecord[field] : projection.fields?.[field];
    if (!valuesEqual(liveValue, authoritativeValue)) {
      conflicts.push({ field, domain: authoritativeValue, tracker: liveValue });
    }
  }

  const state: ProjectionState =
    conflicts.length > 0 ? 'drifted' : absorbed.length > 0 ? 'reconciling' : 'in_sync';
  return { external_id: projection.external_id, state, absorbed, conflicts };
}

/**
 * Apply a reconciliation result to a projection snapshot: tracker-owned fields
 * the tracker legitimately changed are adopted into `fields`; domain-owned
 * conflicts are left untouched (reported, never clobbered). Returns a new
 * projection; the input is not mutated and `raw_record` never changes.
 */
export function applyReconciliation(
  projection: Projection,
  liveIssue: Record<string, unknown> | null,
  result: ReconcileResult,
  reconciledAt: string,
): Projection {
  const fields: Record<string, unknown> = { ...(projection.fields ?? {}) };
  for (const { field } of result.absorbed) {
    fields[field] = liveIssue ? structuredClone(liveIssue[field]) : fields[field];
  }
  return {
    ...projection,
    fields,
    state: result.conflicts.length > 0 ? 'drifted' : 'in_sync',
    reconciledAt,
  };
}

export interface DriftReport {
  readonly ok: boolean;
  readonly counts: {
    readonly total: number;
    readonly inSync: number;
    readonly absorbed: number;
    readonly drifted: number;
    readonly missing: number;
  };
  readonly inSync: readonly ReconcileResult[];
  readonly absorbed: readonly ReconcileResult[];
  readonly drifted: readonly ReconcileResult[];
  readonly missing: readonly { external_id: string; state: ProjectionState; reason: string }[];
  readonly reconciledAt: string;
}

/**
 * Fold reconciliation across a whole projection set against a live tracker
 * snapshot. A projection whose issue vanished from the tracker is `missing`: a
 * deleted tracker item marks the projection drifted, it does not delete domain
 * work.
 */
export function reconcileAll(
  projections: readonly Projection[],
  liveIssues: readonly Record<string, unknown>[],
  reconciledAt: string,
  options: { readonly domainRecords?: Record<string, Record<string, unknown>> } = {},
): DriftReport {
  const domainRecords = options.domainRecords ?? {};
  const liveById = new Map<string, Record<string, unknown>>();
  for (const issue of liveIssues ?? []) {
    if (issue && typeof issue.id === 'string') liveById.set(issue.id, issue);
  }

  const inSync: ReconcileResult[] = [];
  const absorbed: ReconcileResult[] = [];
  const drifted: ReconcileResult[] = [];
  const missing: { external_id: string; state: ProjectionState; reason: string }[] = [];

  for (const projection of projections ?? []) {
    const liveIssue = liveById.get(projection.external_id);
    if (!liveIssue) {
      missing.push({
        external_id: projection.external_id,
        state: 'drifted',
        reason: 'issue-absent-from-tracker',
      });
      continue;
    }
    const result = reconcileProjection(projection, liveIssue, {
      domainRecord: domainRecords[projection.external_id] ?? null,
    });
    if (result.conflicts.length > 0) drifted.push(result);
    else if (result.absorbed.length > 0) absorbed.push(result);
    else inSync.push(result);
  }

  return {
    ok: drifted.length === 0 && missing.length === 0,
    counts: {
      total: (projections ?? []).length,
      inSync: inSync.length,
      absorbed: absorbed.length,
      drifted: drifted.length,
      missing: missing.length,
    },
    inSync,
    absorbed,
    drifted,
    missing,
    reconciledAt,
  };
}

/**
 * The safe per-edge write-back plan for a projection's domain-owned dependency
 * edges: one `dep add <issue> <depends-on>` per edge, never a single graph
 * create — the graph path is lossy, a lesson this program already paid for.
 * Returns the plan; nothing reaches a tracker unless a caller executes it.
 */
export function planDependencyProjection(projection: Projection): {
  external_id: string;
  commands: string[][];
} {
  const raw = (projection.fields as Record<string, unknown> | undefined)?.dependencies;
  const edges = Array.isArray(raw) ? raw : [];
  const commands: string[][] = [];
  for (const edge of edges) {
    const record = edge as { depends_on_id?: unknown; issue_id?: unknown } | null;
    const dependsOn = record?.depends_on_id;
    const issueId = record?.issue_id ?? projection.external_id;
    if (typeof dependsOn === 'string' && typeof issueId === 'string') {
      commands.push(['dep', 'add', issueId, dependsOn]);
    }
  }
  return { external_id: projection.external_id, commands };
}
