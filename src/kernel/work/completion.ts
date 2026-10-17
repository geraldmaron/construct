import { type StateStore } from '../state/open.ts';
import { type RefResolver } from '../project/evidence.ts';
import { getRun } from '../state/runs.ts';
import { runExecutionProblems } from '../workflow/verification.ts';
import { requireNonEmpty, canonicalInstant } from '../state/rows.ts';
import { releasePaths } from './leases.ts';
import { appendActivity } from '../state/activity.ts';
import {
  type WorkItem,
  isRunDelivery,
  rowOf,
  toWork,
  TERMINAL,
  liveClaim,
  getWork,
  recordEvent,
  childrenOf,
  isDelegationAttempt,
  acceptanceOf,
  readinessOf,
} from './helpers.ts';

/**
 * A run that failed or was cancelled can never deliver its artifact, so its
 * delivery reservation is cancelled with it, whoever holds the reservation:
 * the run's end is the authority, not a session's token.
 */
export function endRunDelivery(
  store: StateStore,
  input: { readonly runId: string; readonly state: 'failed' | 'cancelled'; readonly at: string },
): void {
  const row = rowOf(store, `work-${input.runId}-delivery`);
  if (!row) return;
  const work = toWork(row);
  if (TERMINAL.includes(work.status) || !isRunDelivery(work) || (work.scope as { runId?: unknown }).runId !== input.runId) return;
  const live = liveClaim(row, input.at);
  setTerminal(store, {
    id: work.id,
    owner: live ? row.claim_owner! : 'kernel',
    token: live ? row.claim_token! : undefined,
    at: input.at,
    reason: `its run ${input.runId} was ${input.state}, so it can never deliver`,
    status: 'cancelled',
  });
}

export function completeWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly token?: string;
    readonly at: string;
    readonly reason?: string;
    readonly expectedRevision?: number;
    readonly resolveEvidence?: RefResolver;
  },
): WorkItem {
  const scope = getWork(store, input.id)?.scope as { kind?: string; runId?: string } | null;
  if (scope?.kind === 'managed_delivery') {
    if (
      !scope.runId ||
      !input.resolveEvidence ||
      getRun(store, scope.runId)?.state !== 'succeeded' ||
      runExecutionProblems(store, scope.runId, input.resolveEvidence).length
    )
      throw new Error('managed delivery completes only with its succeeded run and current artifact review; use submit_work');
  }
  return setTerminal(store, { ...input, status: 'completed' });
}

export function cancelWork(
  store: StateStore,
  input: {
    readonly id: string;
    readonly actor: string;
    readonly at: string;
    readonly reason: string;
    readonly token?: string;
    readonly expectedRevision?: number;
  },
): WorkItem {
  return setTerminal(store, {
    id: input.id,
    owner: input.actor,
    token: input.token,
    at: input.at,
    reason: input.reason,
    expectedRevision: input.expectedRevision,
    status: 'cancelled',
  });
}

export function reopenWork(
  store: StateStore,
  input: { readonly id: string; readonly actor: string; readonly at: string; readonly reason: string; readonly expectedRevision?: number },
): WorkItem {
  requireNonEmpty(input.reason, 'work.reopen.reason');
  return store.transaction(() => {
    const current = getWork(store, input.id);
    if (!current) throw new Error(`no work ${input.id}`);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (current.status !== 'completed' && current.status !== 'cancelled' && current.status !== 'historical') {
      throw new Error(`work ${input.id} is ${current.status}; only completed, cancelled, or historical work reopens`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = 'open', completed_at = NULL, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.reason, input.at, input.id);
    recordEvent(store, input.id, input.at, 'reopened', input.actor, current.revision + 1, { reason: input.reason, from: current.status });
    return getWork(store, input.id)!;
  });
}

export function supersedeWork(
  store: StateStore,
  input: { readonly id: string; readonly successorId: string; readonly actor: string; readonly at: string; readonly reason: string },
): WorkItem {
  return store.transaction(() => {
    const current = getWork(store, input.id);
    const successor = getWork(store, input.successorId);
    if (!current) throw new Error(`no work ${input.id}`);
    if (!successor) throw new Error(`no work ${input.successorId}`);
    store.db
      .prepare(
        `UPDATE work_items SET status = 'superseded', superseded_by = ?, reason = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.successorId, input.reason, input.at, input.id);
    recordEvent(store, input.id, input.at, 'superseded', input.actor, current.revision + 1, {
      successorId: input.successorId,
      reason: input.reason,
    });
    return getWork(store, input.id)!;
  });
}

function setTerminal(
  store: StateStore,
  input: {
    readonly id: string;
    readonly owner: string;
    readonly token?: string;
    readonly at: string;
    readonly reason?: string;
    readonly expectedRevision?: number;
    readonly status: 'completed' | 'cancelled';
  },
): WorkItem {
  input = { ...input, at: canonicalInstant(input.at, 'work.at') };
  return store.transaction(() => {
    const row = rowOf(store, input.id);
    if (!row) throw new Error(`no work ${input.id}`);
    const current = toWork(row);
    if (input.expectedRevision !== undefined && current.revision !== input.expectedRevision) {
      throw new Error(`work ${input.id} is at revision ${String(current.revision)}; expected ${String(input.expectedRevision)}`);
    }
    if (TERMINAL.includes(current.status)) throw new Error(`work ${input.id} is already ${current.status}`);
    const unfinished = childrenOf(store, input.id).filter((c) => !TERMINAL.includes(c.status));
    const attempts = unfinished.filter((c) => isDelegationAttempt(store, c.id));
    const openChildren = unfinished.filter((c) => !attempts.includes(c));
    if (openChildren.length > 0) {
      throw new Error(
        `work ${input.id} still has ${String(openChildren.length)} open child item(s): ${openChildren
          .slice(0, 5)
          .map((c) => c.id)
          .join(', ')}${openChildren.length > 5 ? ', …' : ''}; complete or cancel them first`,
      );
    }
    const running = attempts.filter((c) => liveClaim(rowOf(store, c.id)!, input.at));
    if (running.length > 0) {
      throw new Error(
        `work ${input.id} has a delegated attempt still running (${running.map((c) => c.id).join(', ')}); cancel it or let it finish first`,
      );
    }
    if (input.status === 'completed' && acceptanceOf(current).length > 0 && !input.reason?.trim()) {
      throw new Error(`work ${input.id} has acceptance criteria; say how they were met in the reason`);
    }
    if (input.status === 'completed') {
      // Ownership is checked below; readiness here checks whether the work can
      // truthfully finish, including changes that occurred during a claim.
      const ready = readinessOf(store, { ...current, claimOwner: null, claimUntil: null }, input.at);
      if (!ready.ready) throw new Error(`work ${input.id} cannot complete: ${ready.blockers.join('; ')}`);
    }
    // Expiry frees acquisition, never settlement by a stale generation.
    if (row.status === 'claimed' && !liveClaim(row, input.at) && (input.status === 'completed' || input.token !== undefined)) {
      throw new Error(`work ${input.id} claim expired; claim the work again before settling it`);
    }
    // A live claim is settled only with both its owner and token.
    if (liveClaim(row, input.at) && (input.token !== row.claim_token || input.owner !== row.claim_owner)) {
      throw new Error(
        `work ${input.id} is held by ${row.claim_owner} until ${row.claim_until}; ${input.token ? 'that owner and token do not hold it' : 'settle it with the token its claim returned, or take it over once it is free'}`,
      );
    }
    if (input.token !== undefined && row.status !== 'claimed') {
      throw new Error(`work ${input.id} is not held under that token; claim it before settling it`);
    }
    store.db
      .prepare(
        `UPDATE work_items SET status = ?, completed_at = ?, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            claim_session = NULL, claim_agent = NULL, claim_lane = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`,
      )
      .run(input.status, input.at, input.reason ?? null, input.at, input.id);
    releasePaths(store, { workId: input.id, now: input.at, reason: input.status });
    recordEvent(store, input.id, input.at, input.status, input.owner, current.revision + 1, { reason: input.reason ?? null });
    for (const attempt of attempts) {
      const ended = `its parent ${input.id} was ${input.status}`;
      store.db
        .prepare(`UPDATE work_items SET status = 'cancelled', completed_at = ?, reason = ?, claim_owner = NULL, claim_token = NULL, claim_until = NULL,
            claim_session = NULL, claim_agent = NULL, claim_lane = NULL, revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(input.at, ended, input.at, attempt.id);
      releasePaths(store, { workId: attempt.id, now: input.at, reason: 'cancelled' });
      recordEvent(store, attempt.id, input.at, 'cancelled', input.owner, attempt.revision + 1, { reason: ended });
    }
    appendActivity(store, { at: input.at, kind: `work.${input.status}`, actor: input.owner, payload: { workId: input.id } });
    return getWork(store, input.id)!;
  });
}

export function associateRun(
  store: StateStore,
  input: { readonly workId: string; readonly runId: string; readonly role: 'implements' | 'verifies' | 'reviews'; readonly at: string },
): void {
  if (!getWork(store, input.workId)) throw new Error(`no work ${input.workId}`);
  store.db
    .prepare(`INSERT OR IGNORE INTO work_runs (work_id, run_id, role, created_at) VALUES (?, ?, ?, ?)`)
    .run(input.workId, input.runId, input.role, input.at);
}
