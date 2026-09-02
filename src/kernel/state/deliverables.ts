/**
 * kernel/state/deliverables.ts — what a run produces, and how far it is trusted.
 *
 * Trust is a separate machine from step completion: a step succeeding leaves
 * its deliverable a draft. Only an explicit, recorded judgment moves it.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './activity.ts';
import { assertTransition, parseJson, requireInstant, requireNonEmpty, requireOneOf, toJson } from './rows.ts';

export const TRUST_STATES = ['draft', 'validated', 'challenged', 'accepted', 'final', 'rejected'] as const;
export type TrustState = (typeof TRUST_STATES)[number];

export const TRUST_TRANSITIONS: Readonly<Record<TrustState, readonly TrustState[]>> = {
  draft: ['validated', 'challenged', 'rejected'],
  validated: ['challenged', 'accepted', 'rejected'],
  challenged: ['draft', 'validated', 'accepted', 'rejected'],
  accepted: ['final', 'challenged'],
  final: [],
  rejected: ['draft'],
};

export interface Deliverable {
  readonly id: string;
  readonly runId: string;
  readonly stepRunId: string | null;
  readonly kind: string;
  readonly body: unknown;
  readonly trustState: TrustState;
  readonly verification: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  readonly id: string;
  readonly run_id: string;
  readonly step_run_id: string | null;
  readonly kind: string;
  readonly body_json: string;
  readonly trust_state: TrustState;
  readonly verification_json: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

function toDeliverable(row: Row): Deliverable {
  return {
    id: row.id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    kind: row.kind,
    body: parseJson(row.body_json),
    trustState: row.trust_state,
    verification: parseJson(row.verification_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Create a draft, or replace the body of an existing draft/rejected one. */
export function upsertDraft(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId: string;
    readonly stepRunId?: string;
    readonly kind: string;
    readonly body: unknown;
    readonly at: string;
  },
): Deliverable {
  requireNonEmpty(input.id, 'deliverable.id');
  requireNonEmpty(input.kind, 'deliverable.kind');
  requireInstant(input.at, 'deliverable.at');
  return store.transaction(() => {
    const existing = getDeliverable(store, input.id);
    if (existing) {
      if (existing.trustState !== 'draft' && existing.trustState !== 'rejected') {
        throw new Error(
          `deliverable ${input.id} is ${existing.trustState}; only a draft or rejected deliverable can be redrafted`,
        );
      }
      store.db
        .prepare(
          `UPDATE deliverables SET body_json = ?, trust_state = 'draft', verification_json = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(toJson(input.body), input.at, input.id);
    } else {
      store.db
        .prepare(
          `INSERT INTO deliverables (id, run_id, step_run_id, kind, body_json, trust_state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
        )
        .run(input.id, input.runId, input.stepRunId ?? null, input.kind, toJson(input.body), input.at, input.at);
    }
    appendActivity(store, {
      at: input.at,
      kind: 'deliverable.drafted',
      runId: input.runId,
      stepRunId: input.stepRunId ?? null,
      payload: { deliverableId: input.id, kind: input.kind },
    });
    return getDeliverable(store, input.id)!;
  });
}

export function getDeliverable(store: StateStore, id: string): Deliverable | null {
  const row = store.db.prepare('SELECT * FROM deliverables WHERE id = ?').get(id) as Row | undefined;
  return row ? toDeliverable(row) : null;
}

export function listDeliverables(store: StateStore, runId: string): Deliverable[] {
  const rows = store.db
    .prepare('SELECT * FROM deliverables WHERE run_id = ? ORDER BY created_at, id')
    .all(runId) as unknown as Row[];
  return rows.map(toDeliverable);
}

/**
 * Move trust. The actor and the basis are recorded; a validator's result or a
 * challenge verdict travels in `verification`.
 */
export function setTrustState(
  store: StateStore,
  input: {
    readonly id: string;
    readonly trustState: TrustState;
    readonly actor: string;
    readonly at: string;
    readonly verification?: unknown;
    readonly reason?: string;
  },
): Deliverable {
  requireOneOf(input.trustState, TRUST_STATES, 'deliverable.trustState');
  requireNonEmpty(input.actor, 'deliverable.actor');
  requireInstant(input.at, 'deliverable.at');
  return store.transaction(() => {
    const current = getDeliverable(store, input.id);
    if (!current) throw new Error(`no deliverable ${input.id}`);
    assertTransition(TRUST_TRANSITIONS, `deliverable ${input.id}`, current.trustState, input.trustState);
    store.db
      .prepare(
        `UPDATE deliverables SET trust_state = ?, verification_json = COALESCE(?, verification_json), updated_at = ? WHERE id = ?`,
      )
      .run(
        input.trustState,
        input.verification === undefined ? null : toJson(input.verification),
        input.at,
        input.id,
      );
    appendActivity(store, {
      at: input.at,
      kind: 'deliverable.trust',
      runId: current.runId,
      stepRunId: current.stepRunId,
      actor: input.actor,
      payload: { deliverableId: input.id, from: current.trustState, to: input.trustState, reason: input.reason ?? null },
    });
    return getDeliverable(store, input.id)!;
  });
}
