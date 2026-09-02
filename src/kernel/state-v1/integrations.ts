/**
 * kernel/state-v1/integrations.ts — host integration fingerprints for reconcile.
 */

import type { StateStore } from './open.ts';

export type IntegrationStatus = 'installed' | 'absent' | 'broken';

export interface IntegrationState {
  readonly hostId: string;
  readonly status: IntegrationStatus;
  readonly constructVersion: string;
  readonly generationVersion: string;
  readonly contentFingerprint: string | null;
  readonly path: string | null;
  readonly kind: string;
  readonly updatedAt: string;
}

interface Row {
  readonly host_id: string;
  readonly status: IntegrationStatus;
  readonly construct_version: string;
  readonly generation_version: string;
  readonly content_fingerprint: string | null;
  readonly path: string | null;
  readonly kind: string;
  readonly updated_at: string;
}

function toIntegration(row: Row): IntegrationState {
  return {
    hostId: row.host_id,
    status: row.status,
    constructVersion: row.construct_version,
    generationVersion: row.generation_version,
    contentFingerprint: row.content_fingerprint,
    path: row.path,
    kind: row.kind,
    updatedAt: row.updated_at,
  };
}

export function upsertIntegration(
  store: StateStore,
  input: {
    readonly hostId: string;
    readonly status: IntegrationStatus;
    readonly constructVersion: string;
    readonly generationVersion: string;
    readonly contentFingerprint?: string;
    readonly path?: string;
    readonly kind: string;
    readonly at: string;
  },
): IntegrationState {
  store.db
    .prepare(
      `INSERT INTO integration_state (
         host_id, status, construct_version, generation_version,
         content_fingerprint, path, kind, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET
         status = excluded.status,
         construct_version = excluded.construct_version,
         generation_version = excluded.generation_version,
         content_fingerprint = excluded.content_fingerprint,
         path = excluded.path,
         kind = excluded.kind,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.hostId,
      input.status,
      input.constructVersion,
      input.generationVersion,
      input.contentFingerprint ?? null,
      input.path ?? null,
      input.kind,
      input.at,
    );
  return getIntegration(store, input.hostId)!;
}

export function getIntegration(store: StateStore, hostId: string): IntegrationState | null {
  const row = store.db
    .prepare('SELECT * FROM integration_state WHERE host_id = ?')
    .get(hostId) as Row | undefined;
  return row ? toIntegration(row) : null;
}

export function listIntegrations(store: StateStore): IntegrationState[] {
  const rows = store.db
    .prepare('SELECT * FROM integration_state ORDER BY host_id')
    .all() as unknown as Row[];
  return rows.map(toIntegration);
}
