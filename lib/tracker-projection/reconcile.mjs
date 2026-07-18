/**
 * lib/tracker-projection/reconcile.mjs — detect-and-report drift between the
 * live bd tracker and the projected Work model (construct-b0nny.27 / E8),
 * realizing target-model.md concept 16's field-authority reconciliation.
 *
 * The rule (concept 16 Enforcement, directive §9): a domain-owned field is
 * never overwritten by the tracker, a tracker-owned field is never overwritten
 * by the domain. So a divergence on a tracker-owned field is an *absorbed*
 * legitimate bd update (the snapshot should adopt it); a divergence on a
 * domain-owned field is a *conflict* — reported as drift, never clobbered
 * ("reconciliation detects and reports drift rather than clobbering").
 *
 * Default reconciliation mutates nothing in bd. `planDependencyProjection`
 * emits the *safe* per-edge `bd dep add` write-back plan (dry-run by default),
 * never `bd create --graph` — honoring the program's standing lesson that the
 * `--graph` path is lossy.
 */

import { valuesEqual } from './projection.mjs';
import { AUTHORITY } from './field-authority.mjs';

/**
 * Reconcile one Projection against its current live bd issue (and, when a
 * materialized domain `work` store exists, the domain-authoritative values).
 * Without a `domainRecord`, the projection's captured `fields` snapshot is the
 * domain baseline for domain-owned fields.
 *
 * @param {object} projection
 * @param {object} liveIssue - the current bd issue for this projection
 * @param {{ domainRecord?: object|null }} [opts]
 * @returns {{ external_id: string, state: string, absorbed: object[], conflicts: object[] }}
 */
export function reconcileProjection(projection, liveIssue, { domainRecord = null } = {}) {
  const absorbed = [];
  const conflicts = [];

  for (const [field, authority] of Object.entries(projection?.field_authority ?? {})) {
    const liveValue = liveIssue ? liveIssue[field] : undefined;

    if (authority === AUTHORITY.TRACKER) {
      const snapshotValue = projection.fields?.[field];
      if (!valuesEqual(liveValue, snapshotValue)) {
        absorbed.push({ field, from: snapshotValue, to: liveValue });
      }
      continue;
    }

    const authoritativeValue = domainRecord && field in domainRecord
      ? domainRecord[field]
      : projection.fields?.[field];
    if (!valuesEqual(liveValue, authoritativeValue)) {
      conflicts.push({ field, domain: authoritativeValue, tracker: liveValue });
    }
  }

  const state = conflicts.length > 0 ? 'drifted' : (absorbed.length > 0 ? 'reconciling' : 'in_sync');
  return { external_id: projection.external_id, state, absorbed, conflicts };
}

/**
 * Apply an absorbed reconciliation result to a projection snapshot: tracker-
 * owned fields bd legitimately changed are adopted into `fields`; domain-owned
 * conflicts are left untouched (reported, never clobbered). Returns a new
 * projection object; the input is not mutated, and `raw_record` never changes.
 *
 * @param {object} projection
 * @param {object} liveIssue
 * @param {{ external_id: string, state: string, absorbed: object[], conflicts: object[] }} result
 * @param {string} [reconciledAt]
 * @returns {object} updated projection
 */
export function applyReconciliation(projection, liveIssue, result, reconciledAt = null) {
  const fields = { ...(projection.fields ?? {}) };
  for (const { field } of result.absorbed) {
    fields[field] = liveIssue ? structuredClone(liveIssue[field]) : fields[field];
  }
  const state = result.conflicts.length > 0 ? 'drifted' : 'in_sync';
  return { ...projection, fields, state, reconciledAt: reconciledAt || new Date().toISOString() };
}

/**
 * Fold per-projection reconciliation across the whole projection set against a
 * live bd snapshot. A projection whose bead vanished from bd is `missing`
 * (concept 16 Deletion behavior: a deleted tracker item marks the Projection
 * drifted, it does not delete domain Work).
 *
 * @param {object[]} projections
 * @param {object[]} liveIssues - the current `bd list --all --json` snapshot
 * @param {{ domainRecords?: Record<string, object> }} [opts]
 * @returns {object} drift report
 */
export function reconcileAll(projections, liveIssues, { domainRecords = {} } = {}) {
  const liveById = new Map();
  for (const issue of liveIssues || []) {
    if (issue && typeof issue.id === 'string') liveById.set(issue.id, issue);
  }

  const inSync = [];
  const absorbed = [];
  const drifted = [];
  const missing = [];

  for (const projection of projections || []) {
    const liveIssue = liveById.get(projection.external_id);
    if (!liveIssue) {
      missing.push({ external_id: projection.external_id, state: 'drifted', reason: 'bead-absent-from-tracker' });
      continue;
    }
    const result = reconcileProjection(projection, liveIssue, { domainRecord: domainRecords[projection.external_id] ?? null });
    if (result.conflicts.length > 0) drifted.push(result);
    else if (result.absorbed.length > 0) absorbed.push(result);
    else inSync.push(result);
  }

  return {
    ok: drifted.length === 0 && missing.length === 0,
    counts: {
      total: (projections || []).length,
      inSync: inSync.length,
      absorbed: absorbed.length,
      drifted: drifted.length,
      missing: missing.length,
    },
    inSync,
    absorbed,
    drifted,
    missing,
    reconciledAt: new Date().toISOString(),
  };
}

/**
 * Emit the safe per-edge write-back plan for a projection's domain-owned
 * dependency edges: one `bd dep add <issue> <depends-on>` per edge, never a
 * single `bd create --graph` (the lossy path this program already learned to
 * avoid). Dry-run only — returns the command plan; nothing reaches the bd shell
 * boundary unless a caller executes it.
 *
 * @param {object} projection
 * @returns {{ external_id: string, commands: string[][] }}
 */
export function planDependencyProjection(projection) {
  const edges = Array.isArray(projection?.fields?.dependencies) ? projection.fields.dependencies : [];
  const commands = [];
  for (const edge of edges) {
    const dependsOn = edge?.depends_on_id;
    const issueId = edge?.issue_id ?? projection.external_id;
    if (typeof dependsOn === 'string' && typeof issueId === 'string') {
      commands.push(['dep', 'add', issueId, dependsOn]);
    }
  }
  return { external_id: projection.external_id, commands };
}
