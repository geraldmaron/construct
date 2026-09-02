/**
 * kernel/state-v1/runs.ts — run aggregate helpers for format v1.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './deliverables.ts';

export interface Run {
  readonly id: string;
  readonly outcome: string;
  readonly status: 'open' | 'closed';
  readonly createdAt: string;
  readonly closedAt: string | null;
}

export interface RunConcern {
  readonly domain: string;
  readonly why: string;
}

interface RunRow {
  readonly id: string;
  readonly outcome: string;
  readonly status: 'open' | 'closed';
  readonly created_at: string;
  readonly closed_at: string | null;
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    outcome: row.outcome,
    status: row.status,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export function startRun(
  store: StateStore,
  input: {
    readonly id: string;
    readonly outcome: string;
    readonly at: string;
    readonly concerns?: readonly RunConcern[];
  },
): Run {
  store.db
    .prepare(
      `INSERT INTO runs (id, outcome, status, created_at) VALUES (?, ?, 'open', ?)`,
    )
    .run(input.id, input.outcome, input.at);

  for (const concern of input.concerns ?? []) {
    store.db
      .prepare(
        `INSERT INTO run_concerns (run_id, domain, why) VALUES (?, ?, ?)`,
      )
      .run(input.id, concern.domain, concern.why);
  }

  appendActivity(store, {
    at: input.at,
    kind: 'run.started',
    runId: input.id,
    payload: { outcome: input.outcome, concerns: input.concerns ?? [] },
  });

  const row = store.db.prepare('SELECT * FROM runs WHERE id = ?').get(input.id) as unknown as RunRow;
  return toRun(row);
}

export function getRun(store: StateStore, id: string): Run | null {
  const row = store.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as
    | RunRow
    | undefined;
  return row ? toRun(row) : null;
}

export function listRunConcerns(store: StateStore, runId: string): RunConcern[] {
  const rows = store.db
    .prepare('SELECT domain, why FROM run_concerns WHERE run_id = ? ORDER BY domain')
    .all(runId) as Array<{ domain: string; why: string }>;
  return rows.map((r) => ({ domain: r.domain, why: r.why }));
}
