/**
 * kernel/state-v1/sources.ts — authoritative project sources for format v1.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './deliverables.ts';

export interface Source {
  readonly id: string;
  readonly kind: string;
  readonly locator: string;
  readonly authority: string;
  readonly status: 'active' | 'retired';
  readonly metadata: unknown;
  readonly createdAt: string;
  readonly retiredAt: string | null;
}

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly locator: string;
  readonly authority: string;
  readonly status: 'active' | 'retired';
  readonly metadata_json: string | null;
  readonly created_at: string;
  readonly retired_at: string | null;
}

function toSource(row: Row): Source {
  return {
    id: row.id,
    kind: row.kind,
    locator: row.locator,
    authority: row.authority,
    status: row.status,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
    retiredAt: row.retired_at,
  };
}

export function addSource(
  store: StateStore,
  input: {
    readonly id: string;
    readonly kind: string;
    readonly locator: string;
    readonly authority: string;
    readonly metadata?: unknown;
    readonly at: string;
  },
): Source {
  store.db
    .prepare(
      `INSERT INTO sources (id, kind, locator, authority, status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      input.id,
      input.kind,
      input.locator,
      input.authority,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      input.at,
    );
  appendActivity(store, {
    at: input.at,
    kind: 'source.read',
    payload: { sourceId: input.id, kind: input.kind, locator: input.locator },
  });
  return getSource(store, input.id)!;
}

export function getSource(store: StateStore, id: string): Source | null {
  const row = store.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Row | undefined;
  return row ? toSource(row) : null;
}

export function listSources(store: StateStore): Source[] {
  const rows = store.db
    .prepare(`SELECT * FROM sources WHERE status = 'active' ORDER BY kind, locator`)
    .all() as unknown as Row[];
  return rows.map(toSource);
}
