/**
 * kernel/state/decisions.ts — unified inbox / approvals surface for format v1.
 *
 * Typed entries behind one user-facing Inbox. Security-critical distinctions
 * stay in `kind`; the person does not learn seven verbs.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './deliverables.ts';

export type DecisionKind =
  | 'requires_decision'
  | 'requires_action_approval'
  | 'requires_trust'
  | 'blocked';

export interface Decision {
  readonly id: string;
  readonly runId: string | null;
  readonly kind: DecisionKind;
  readonly question: string;
  readonly state: 'open' | 'resolved';
  readonly resolution: unknown;
  readonly raisedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

interface Row {
  readonly id: string;
  readonly run_id: string | null;
  readonly kind: DecisionKind;
  readonly question: string;
  readonly state: 'open' | 'resolved';
  readonly resolution_json: string | null;
  readonly raised_at: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
}

function toDecision(row: Row): Decision {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    question: row.question,
    state: row.state,
    resolution: row.resolution_json ? JSON.parse(row.resolution_json) : null,
    raisedAt: row.raised_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export function raiseDecision(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId?: string;
    readonly kind: DecisionKind;
    readonly question: string;
    readonly at: string;
  },
): Decision {
  store.db
    .prepare(
      `INSERT INTO decisions (id, run_id, kind, question, state, raised_at)
       VALUES (?, ?, ?, ?, 'open', ?)`,
    )
    .run(input.id, input.runId ?? null, input.kind, input.question, input.at);
  appendActivity(store, {
    at: input.at,
    kind: 'decision.raised',
    runId: input.runId,
    payload: { decisionId: input.id, kind: input.kind },
  });
  return getDecision(store, input.id)!;
}

export function resolveDecision(
  store: StateStore,
  input: {
    readonly id: string;
    readonly resolution: unknown;
    readonly resolvedBy: string;
    readonly at: string;
  },
): Decision {
  const result = store.db
    .prepare(
      `UPDATE decisions
          SET state = 'resolved', resolution_json = ?, resolved_at = ?, resolved_by = ?
        WHERE id = ? AND state = 'open'`,
    )
    .run(
      JSON.stringify(input.resolution ?? null),
      input.at,
      input.resolvedBy,
      input.id,
    );
  if (result.changes === 0) {
    throw new Error(`decision ${input.id} is not open`);
  }
  const decision = getDecision(store, input.id)!;
  appendActivity(store, {
    at: input.at,
    kind: 'decision.resolved',
    runId: decision.runId ?? undefined,
    payload: { decisionId: input.id, resolvedBy: input.resolvedBy },
  });
  return decision;
}

export function getDecision(store: StateStore, id: string): Decision | null {
  const row = store.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
    | Row
    | undefined;
  return row ? toDecision(row) : null;
}

export function listOpenDecisions(store: StateStore): Decision[] {
  const rows = store.db
    .prepare(`SELECT * FROM decisions WHERE state = 'open' ORDER BY raised_at, id`)
    .all() as unknown as Row[];
  return rows.map(toDecision);
}
