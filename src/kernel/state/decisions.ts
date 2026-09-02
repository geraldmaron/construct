/**
 * kernel/state/decisions.ts — the inbox: calls that belong to a person.
 *
 * A decision is raised by a run (or by Construct itself), stays open until a
 * person resolves or a run withdraws it, and records who answered.
 */

import type { StateStore } from './open.ts';
import { appendActivity } from './activity.ts';
import { assertTransition, parseJson, requireInstant, requireNonEmpty, requireOneOf, toJson } from './rows.ts';

export const DECISION_KINDS = ['decision', 'approval', 'clarification', 'blocked'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_STATES = ['open', 'resolved', 'withdrawn'] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

const DECISION_TRANSITIONS: Readonly<Record<DecisionState, readonly DecisionState[]>> = {
  open: ['resolved', 'withdrawn'],
  resolved: [],
  withdrawn: [],
};

export interface Decision {
  readonly id: string;
  readonly runId: string | null;
  readonly stepRunId: string | null;
  readonly kind: DecisionKind;
  readonly question: string;
  readonly options: readonly string[] | null;
  readonly subject: unknown;
  readonly state: DecisionState;
  readonly resolution: unknown;
  readonly raisedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
}

interface Row {
  readonly id: string;
  readonly run_id: string | null;
  readonly step_run_id: string | null;
  readonly kind: DecisionKind;
  readonly question: string;
  readonly options_json: string | null;
  readonly subject_json: string | null;
  readonly state: DecisionState;
  readonly resolution_json: string | null;
  readonly raised_at: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
}

function toDecision(row: Row): Decision {
  const options = parseJson(row.options_json);
  return {
    id: row.id,
    runId: row.run_id,
    stepRunId: row.step_run_id,
    kind: row.kind,
    question: row.question,
    options: Array.isArray(options) ? (options as string[]) : null,
    subject: parseJson(row.subject_json),
    state: row.state,
    resolution: parseJson(row.resolution_json),
    raisedAt: row.raised_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export function raiseDecision(
  store: StateStore,
  input: {
    readonly id: string;
    readonly kind: DecisionKind;
    readonly question: string;
    readonly runId?: string;
    readonly stepRunId?: string;
    readonly options?: readonly string[];
    readonly subject?: unknown;
    readonly at: string;
  },
): Decision {
  requireNonEmpty(input.id, 'decision.id');
  requireOneOf(input.kind, DECISION_KINDS, 'decision.kind');
  requireNonEmpty(input.question, 'decision.question');
  requireInstant(input.at, 'decision.at');
  return store.transaction(() => {
    const row = store.db
      .prepare(
        `INSERT INTO decisions (id, run_id, step_run_id, kind, question, options_json, subject_json, state, raised_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?) RETURNING *`,
      )
      .get(
        input.id,
        input.runId ?? null,
        input.stepRunId ?? null,
        input.kind,
        input.question,
        input.options === undefined ? null : toJson(input.options),
        input.subject === undefined ? null : toJson(input.subject),
        input.at,
      ) as unknown as Row;
    appendActivity(store, {
      at: input.at,
      kind: 'decision.raised',
      runId: input.runId ?? null,
      stepRunId: input.stepRunId ?? null,
      payload: { decisionId: input.id, kind: input.kind },
    });
    return toDecision(row);
  });
}

export function getDecision(store: StateStore, id: string): Decision | null {
  const row = store.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as Row | undefined;
  return row ? toDecision(row) : null;
}

export function listOpenDecisions(store: StateStore, runId?: string): Decision[] {
  const rows = store.db
    .prepare(
      `SELECT * FROM decisions WHERE state = 'open' AND (? IS NULL OR run_id = ?) ORDER BY raised_at, id`,
    )
    .all(runId ?? null, runId ?? null) as unknown as Row[];
  return rows.map(toDecision);
}

export function resolveDecision(
  store: StateStore,
  input: { readonly id: string; readonly resolution: unknown; readonly by: string; readonly at: string },
): Decision {
  requireNonEmpty(input.by, 'decision.by');
  requireInstant(input.at, 'decision.at');
  return store.transaction(() => {
    const current = getDecision(store, input.id);
    if (!current) throw new Error(`no decision ${input.id}`);
    assertTransition(DECISION_TRANSITIONS, `decision ${input.id}`, current.state, 'resolved');
    if (current.options && typeof input.resolution === 'string' && !current.options.includes(input.resolution)) {
      throw new Error(
        `decision ${input.id} offers ${current.options.join(' | ')}; "${input.resolution}" is not one of them`,
      );
    }
    store.db
      .prepare(
        `UPDATE decisions SET state = 'resolved', resolution_json = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`,
      )
      .run(toJson(input.resolution), input.at, input.by, input.id);
    appendActivity(store, {
      at: input.at,
      kind: 'decision.resolved',
      runId: current.runId,
      stepRunId: current.stepRunId,
      actor: input.by,
      payload: { decisionId: input.id, kind: current.kind },
    });
    return getDecision(store, input.id)!;
  });
}

/** A run withdraws a question it no longer needs answered. */
export function withdrawDecision(
  store: StateStore,
  input: { readonly id: string; readonly reason: string; readonly at: string },
): Decision {
  requireInstant(input.at, 'decision.at');
  return store.transaction(() => {
    const current = getDecision(store, input.id);
    if (!current) throw new Error(`no decision ${input.id}`);
    assertTransition(DECISION_TRANSITIONS, `decision ${input.id}`, current.state, 'withdrawn');
    store.db
      .prepare(`UPDATE decisions SET state = 'withdrawn', resolution_json = ?, resolved_at = ? WHERE id = ?`)
      .run(toJson({ withdrawn: true, reason: input.reason }), input.at, input.id);
    appendActivity(store, {
      at: input.at,
      kind: 'decision.withdrawn',
      runId: current.runId,
      stepRunId: current.stepRunId,
      payload: { decisionId: input.id, reason: input.reason },
    });
    return getDecision(store, input.id)!;
  });
}
