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
 */

import type { Store } from './open.ts';
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
