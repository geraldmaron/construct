/**
 * kernel/state-v1/decisions.ts — unified inbox / approvals surface for format v1.
 *
 * Typed entries behind one user-facing Inbox. Security-critical distinctions
 * stay in `kind`; the person does not learn seven verbs.
 */

import type { StateStore } from './open.ts';
import { appendActivity, getDeliverableByTask, setTrustState } from './deliverables.ts';
import { operatorRevokeTask } from './tasks.ts';

export const DECISION_KINDS = [
  'requires_decision',
  'requires_action_approval',
  'requires_trust',
  'requires_waiver',
  'requires_revocation',
  'requires_verdict',
  'requires_consent',
  'blocked',
] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

export interface DecisionSubject {
  readonly taskId?: string;
  readonly challengeId?: string;
  readonly deliverableId?: string;
  readonly workspace?: string;
  readonly settingsPath?: string;
  readonly runId?: string;
}

export interface Decision {
  readonly id: string;
  readonly runId: string | null;
  readonly kind: DecisionKind;
  readonly question: string;
  readonly subject: DecisionSubject | null;
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
  readonly subject_json: string | null;
  readonly state: 'open' | 'resolved';
  readonly resolution_json: string | null;
  readonly raised_at: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
}

function parseSubject(raw: string | null): DecisionSubject | null {
  if (raw === null || raw === '') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as DecisionSubject;
  } catch {
    return null;
  }
}

function toDecision(row: Row): Decision {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    question: row.question,
    subject: parseSubject(row.subject_json),
    state: row.state,
    resolution: row.resolution_json ? JSON.parse(row.resolution_json) : null,
    raisedAt: row.raised_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

function assertKind(kind: string): asserts kind is DecisionKind {
  if (!(DECISION_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `decision kind must be one of ${DECISION_KINDS.join(' | ')} (got ${kind})`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    return { text: value };
  }
  return { value };
}

function reasonFrom(resolution: unknown): string {
  const rec = asRecord(resolution);
  for (const key of ['reason', 'text', 'resolution'] as const) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return JSON.stringify(resolution ?? null);
}

function callFrom(resolution: unknown): string {
  const rec = asRecord(resolution);
  for (const key of ['call', 'verdict', 'text'] as const) {
    const v = rec[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim().toLowerCase();
  }
  return '';
}

/**
 * Apply the side effect this kind promises before the row flips to resolved.
 * Recording-only kinds (requires_decision, blocked, bare action approval) no-op here.
 */
export function applyDecisionEffect(
  store: StateStore,
  decision: Decision,
  resolution: unknown,
  input: { readonly resolvedBy: string; readonly at: string },
): void {
  const subject = decision.subject ?? {};
  switch (decision.kind) {
    case 'requires_waiver': {
      const taskId = subject.taskId;
      const challengeId = subject.challengeId;
      if (!taskId || !challengeId) {
        throw new Error('requires_waiver needs subject.taskId and subject.challengeId');
      }
      const reason = reasonFrom(resolution);
      if (!reason) throw new Error('requires_waiver resolution needs a reason');
      appendActivity(store, {
        at: input.at,
        kind: 'control.waived',
        runId: decision.runId ?? subject.runId,
        taskId,
        payload: {
          decisionId: decision.id,
          challengeId,
          reason,
          by: input.resolvedBy,
        },
      });
      return;
    }
    case 'requires_revocation': {
      const taskId = subject.taskId;
      if (!taskId) throw new Error('requires_revocation needs subject.taskId');
      const reason = reasonFrom(resolution);
      if (!reason) throw new Error('requires_revocation resolution needs a reason');
      const revoked = operatorRevokeTask(store, {
        id: taskId,
        reason,
        at: input.at,
        by: input.resolvedBy,
      });
      appendActivity(store, {
        at: input.at,
        kind: 'control.revoked',
        runId: decision.runId ?? revoked.runId,
        taskId,
        payload: {
          decisionId: decision.id,
          reason,
          by: input.resolvedBy,
        },
      });
      return;
    }
    case 'requires_verdict': {
      const taskId = subject.taskId;
      if (!taskId) throw new Error('requires_verdict needs subject.taskId');
      const call = callFrom(resolution);
      const trustState =
        call === 'confirm' || call === 'accept' || call === 'accepted'
          ? 'accepted'
          : call === 'dismiss' || call === 'missed' || call === 'reject' || call === 'challenged'
            ? 'challenged'
            : null;
      if (trustState === null) {
        throw new Error(
          'requires_verdict resolution needs call=confirm|dismiss (or accept|reject)',
        );
      }
      setTrustState(store, {
        taskId,
        trustState,
        at: input.at,
        by: input.resolvedBy,
        decisionId: decision.id,
      });
      return;
    }
    case 'requires_consent': {
      const rec = asRecord(resolution);
      const raw = rec.set ?? rec.text ?? rec.value;
      const set =
        typeof raw === 'string'
          ? raw.trim().toLowerCase()
          : raw === true
            ? 'on'
            : raw === false
              ? 'off'
              : '';
      if (set !== 'on' && set !== 'off') {
        throw new Error('requires_consent resolution needs set=on|off');
      }
      appendActivity(store, {
        at: input.at,
        kind: 'consent.set',
        runId: decision.runId ?? undefined,
        payload: {
          decisionId: decision.id,
          workspace: subject.workspace ?? 'default',
          set,
          by: input.resolvedBy,
        },
      });
      return;
    }
    case 'requires_trust': {
      const taskId = subject.taskId;
      if (taskId) {
        if (!getDeliverableByTask(store, taskId)) {
          throw new Error(`no deliverable for task ${taskId} to trust`);
        }
        setTrustState(store, {
          taskId,
          trustState: 'accepted',
          at: input.at,
          by: input.resolvedBy,
          decisionId: decision.id,
        });
        return;
      }
      appendActivity(store, {
        at: input.at,
        kind: 'trust.ratified',
        runId: decision.runId ?? undefined,
        payload: {
          decisionId: decision.id,
          settingsPath: subject.settingsPath ?? null,
          by: input.resolvedBy,
          resolution: asRecord(resolution),
        },
      });
      return;
    }
    case 'requires_action_approval':
    case 'requires_decision':
    case 'blocked':
      return;
    default: {
      const _exhaustive: never = decision.kind;
      void _exhaustive;
    }
  }
}

export function raiseDecision(
  store: StateStore,
  input: {
    readonly id: string;
    readonly runId?: string;
    readonly kind: DecisionKind;
    readonly question: string;
    readonly subject?: DecisionSubject;
    readonly at: string;
  },
): Decision {
  assertKind(input.kind);
  store.db
    .prepare(
      `INSERT INTO decisions (id, run_id, kind, question, subject_json, state, raised_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      input.id,
      input.runId ?? null,
      input.kind,
      input.question,
      input.subject ? JSON.stringify(input.subject) : null,
      input.at,
    );
  appendActivity(store, {
    at: input.at,
    kind: 'decision.raised',
    runId: input.runId,
    payload: { decisionId: input.id, kind: input.kind, subject: input.subject ?? null },
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
  const open = getDecision(store, input.id);
  if (!open || open.state !== 'open') {
    throw new Error(`decision ${input.id} is not open`);
  }
  applyDecisionEffect(store, open, input.resolution, {
    resolvedBy: input.resolvedBy,
    at: input.at,
  });
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
    payload: { decisionId: input.id, resolvedBy: input.resolvedBy, kind: decision.kind },
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
