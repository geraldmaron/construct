/**
 * kernel/store/projections.ts — persistence for the tracker projection mirror.
 *
 * The pure projection logic lives in kernel/tracker/projection.ts and stays
 * pure; this module is the storage half that harvest deliberately deferred.
 *
 * `raw_record` is the immutable audit copy that makes an import provably
 * zero-loss, so it round-trips verbatim and is never rewritten by an upsert of
 * an existing row — only `fields`, `state`, and the reconcile timestamp move.
 * Rewriting the audit copy on re-import would quietly destroy the evidence it
 * exists to preserve.
 *
 * Two ways in, and the difference between them is who is asserting. An import
 * from the tracker writes the whole snapshot (`putProjection`): the tracker is
 * the authority on its own row and the snapshot is what it said. A crossing
 * from Construct writes through `projectDomainFields`, which carries only what
 * the domain side may assert. Without that split the wholesale upsert would
 * make the authority rule unenforceable at exactly the moment it matters — a
 * domain assertion replaces `fields` outright, so a status or an assignee an
 * import had recorded would vanish on the next outward write.
 */

import type { Store } from './open.ts';
import { AUTHORITY, isDomainOwned } from '../tracker/authority.ts';
import type { Authority } from '../tracker/authority.ts';
import type { Projection, ProjectionState } from '../tracker/projection.ts';

interface Row {
  readonly id: string;
  readonly workspace: string | null;
  readonly work: string | null;
  readonly tracker: string;
  readonly external_id: string;
  readonly state: string;
  readonly field_authority: string;
  readonly fields: string;
  readonly raw_record: string;
  readonly imported_at: string | null;
  readonly reconciled_at: string | null;
}

function toProjection(row: Row): Projection {
  return {
    id: row.id,
    workspace: row.workspace,
    work: row.work,
    tracker: row.tracker,
    external_id: row.external_id,
    state: row.state as ProjectionState,
    field_authority: JSON.parse(row.field_authority) as Record<string, Authority>,
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    raw_record: JSON.parse(row.raw_record),
    importedAt: row.imported_at,
    reconciledAt: row.reconciled_at,
  };
}

/**
 * Insert or update a projection. On conflict the audit copy (`raw_record`) and
 * the original `imported_at` are preserved; everything the reconciler owns is
 * replaced.
 */
export function putProjection(store: Store, projection: Projection): void {
  store.db
    .prepare(
      `INSERT INTO projections
         (id, workspace, work, tracker, external_id, state,
          field_authority, fields, raw_record, imported_at, reconciled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         workspace       = excluded.workspace,
         work            = excluded.work,
         state           = excluded.state,
         field_authority = excluded.field_authority,
         fields          = excluded.fields,
         reconciled_at   = excluded.reconciled_at`,
    )
    .run(
      projection.id,
      projection.workspace,
      projection.work,
      projection.tracker,
      projection.external_id,
      projection.state,
      JSON.stringify(projection.field_authority),
      JSON.stringify(projection.fields),
      JSON.stringify(projection.raw_record),
      projection.importedAt,
      projection.reconciledAt,
    );
}

/**
 * Write what the domain side asserts about one issue, under the authority map.
 *
 * A domain-owned field is projected. A tracker-owned field is not: it is
 * dropped from the assertion rather than written, so a value the tracker
 * recorded stays exactly as it was and a value the tracker never recorded is
 * never invented here. That is the reconciliation rule — a tracker-owned field
 * is never overwritten by the domain — held at the one place a domain
 * assertion becomes a row, instead of trusted to every caller that builds one.
 *
 * The audit copy is untouched by the filter. `raw_record` preserves the
 * assertion verbatim, including any tracker-owned field it carried, because
 * what Construct proposed is exactly the thing an auditor later needs to read;
 * what is filtered is `fields`, the snapshot reconciliation diffs against.
 */
export function projectDomainFields(store: Store, projection: Projection): void {
  const existing = getProjection(store, projection.id);
  const fields: Record<string, unknown> = { ...(existing?.fields ?? {}) };
  const authority: Record<string, Authority> = { ...(existing?.field_authority ?? {}) };
  for (const [field, value] of Object.entries(projection.fields ?? {})) {
    if (!isDomainOwned(field)) continue;
    fields[field] = value;
    authority[field] = AUTHORITY.DOMAIN;
  }
  putProjection(store, { ...projection, fields, field_authority: authority });
}

/**
 * Record that a crossing landed: as of `at`, the fields the domain asserted are
 * what the tracker holds. No field moves — the change was already projected
 * before it crossed, and this says only that the world received it.
 *
 * Returns whether a row was there to mark, so a caller never reports a mirror
 * it did not have.
 */
export function markProjectionSynced(store: Store, id: string, at: string): boolean {
  const result = store.db
    .prepare("UPDATE projections SET state = 'in_sync', reconciled_at = ? WHERE id = ?")
    .run(at, id);
  return Number(result.changes) > 0;
}

export function getProjection(store: Store, id: string): Projection | null {
  const row = store.db.prepare('SELECT * FROM projections WHERE id = ?').get(id) as Row | undefined;
  return row ? toProjection(row) : null;
}

export function listProjections(store: Store, tracker?: string): Projection[] {
  const rows = (
    tracker
      ? store.db.prepare('SELECT * FROM projections WHERE tracker = ? ORDER BY id').all(tracker)
      : store.db.prepare('SELECT * FROM projections ORDER BY id').all()
  ) as unknown as Row[];
  return rows.map(toProjection);
}

export function countProjections(store: Store): number {
  const row = store.db.prepare('SELECT COUNT(*) AS n FROM projections').get() as { n: number };
  return row.n;
}
