/**
 * kernel/run/promotion.ts — the dispatcher's side of `draft -> challenged ->
 * final`: it records verdicts, refuses the ones a role recorded about its own
 * work, and derives the state from what is on the record.
 *
 * The split with completion/promotion.ts is the commitment, not a layering
 * preference. That module is pure and answers "given these verdicts, what state
 * is this in". This one owns the only path by which a verdict becomes recorded
 * at all, and it is not reachable from a capability token (see
 * capabilities/tokens.ts — a role's grants are draft submission and work-log
 * append, and `record-verdict` is not among them and cannot be added to a
 * minted token). Commitment 14 puts the transition with the dispatcher; keeping
 * the recording surface in a module no role holds a key to is what makes that
 * true in code rather than in prose.
 *
 * VERDICTS LIVE IN THE WORK LOG. There is no verdicts table, and that is a
 * decision rather than an omission. The work log is already append-only at the
 * storage layer (UPDATE and DELETE raise triggers — see store/open.ts), which is
 * exactly the property a verdict needs: commitment 15 makes the log load-bearing
 * for trust, and a verdict that can be revised after the fact carries none. A
 * second table would have to re-earn that guarantee, and a second table that
 * forgot to would look identical from the outside until the day it mattered.
 * Drafts ride the same substrate for the same reason.
 *
 * Because the state is derived from an append-only log, "advance the promotion"
 * is not an operation that exists anywhere in the kernel. The only way to move a
 * deliverable is to cause a verdict to be written by someone who is not its
 * author, and there is no code path in which a role is that someone.
 *
 * Same disciplines as the rest of run/: no clock, no environment.
 */

import type { Store } from '../store/open.ts';
import { appendWorkLog, readWorkLog } from '../store/worklog.ts';
import { getTask, listTasks } from '../store/tasks.ts';
import { VERDICT_OUTCOMES, promotionState } from '../completion/promotion.ts';
import type { Promotion, Verdict, VerdictOutcome } from '../completion/promotion.ts';
import type { Brief } from '../brief/schema.ts';

/** A verdict that counted. The dispatcher writes these; a role cannot. */
export const VERDICT_ACTION = 'verdict-recorded';

/**
 * A verdict that was refused. Written for the refusals a role could plausibly
 * have caused, because an attempt to self-promote is the single most useful
 * event this whole mechanism produces and dropping it silently would leave the
 * safeguard working and invisible — which is how the predecessor's version of
 * this failure went unnoticed long enough to become a habit.
 */
export const VERDICT_REFUSED_ACTION = 'verdict-refused';

/** A draft submitted by a role through its capability token. */
export const DRAFT_ACTION = 'draft-submitted';

/** The derived state, written down at settle so a user can read it. */
export const PROMOTION_ACTION = 'promotion-derived';

export const VERDICT_REFUSALS = [
  'unknown-task',
  'self-verdict',
  'unknown-outcome',
  'unreasoned-waiver',
] as const;

export type VerdictRefusal = (typeof VERDICT_REFUSALS)[number];

export interface RecordVerdict {
  readonly task: string;
  /** The challenge id the brief named. */
  readonly challenge: string;
  readonly outcome: string;
  /** Who recorded it: a second role, the dispatcher, or the user for a waiver. */
  readonly by: string;
  /** Injected; the kernel never reads the clock. */
  readonly at: string;
  /** Anything the verdict needs to carry — a waiver's reason, a check's detail. */
  readonly detail?: Record<string, unknown>;
}

export interface VerdictRecord {
  readonly recorded: boolean;
  /** Work log sequence of the entry written — the verdict, or its refusal. */
  readonly seq: number | null;
  readonly refusal: VerdictRefusal | null;
  readonly reason: string | null;
}

export interface TaskPromotion extends Promotion {
  readonly task: string;
  readonly run: string;
  /** The role that produced the deliverable. Its own verdicts do not count. */
  readonly role: string;
  readonly required: readonly string[];
  /**
   * Challenges whose surviving verdict was recorded against a second attempt.
   *
   * Carried because "passed" and "passed once it was sent back" are different
   * facts about the same document, and only the first is visible in a state.
   * A run that repairs everything to green and reports nothing but green has
   * turned a true signal into a flattering one, which is the failure the
   * source-standing disclosure exists to prevent — reintroduced through the
   * side door if the repair itself goes unrecorded.
   */
  readonly repaired: readonly string[];
}

export interface SubmittedDraft {
  readonly seq: number;
  readonly role: string;
  readonly deliverable: unknown;
  readonly at: string;
}

/**
 * Every entry for one task, in append order.
 *
 * Reads the run and filters in memory rather than adding a query to
 * store/worklog.ts. A run is tens of tasks with tens of entries each, so the
 * cost is nothing, and worklog.ts staying a two-function module (append, read)
 * is worth more than the query: the shape of that file is itself an argument
 * that history cannot be rewritten.
 */
function entriesFor(store: Store, run: string, task: string) {
  return readWorkLog(store, run).filter((entry) => entry.task === task);
}

/**
 * Record a verdict about a task's deliverable, or refuse it.
 *
 * A verdict from the role that produced the work is refused at the door and
 * written down as an attempt. completion/promotion.ts also discards self-recorded
 * verdicts when it derives, and the redundancy is deliberate: this check keeps a
 * self-verdict out of the record, and that one keeps the derivation correct for
 * any caller who never came through here. Neither is load-bearing alone, which
 * is the property worth having.
 */
export function recordVerdict(store: Store, input: RecordVerdict): VerdictRecord {
  const task = getTask(store, input.task);
  if (!task) {
    // Nothing to attribute an attempt to, and nowhere to file it: without the
    // task row there is no run, no producing role, and therefore no way to tell
    // whether this was a self-verdict. Refused, unlogged, and reported.
    return {
      recorded: false,
      seq: null,
      refusal: 'unknown-task',
      reason: `no task ${input.task} in this store`,
    };
  }

  const refuse = (refusal: VerdictRefusal, reason: string): VerdictRecord => {
    const seq = appendWorkLog(store, {
      run: task.run,
      task: task.id,
      role: 'construct',
      action: VERDICT_REFUSED_ACTION,
      detail: {
        refusal,
        reason,
        challenge: input.challenge,
        outcome: input.outcome,
        by: input.by,
        producedBy: task.role,
      },
      at: input.at,
    });
    return { recorded: false, seq, refusal, reason };
  };

  if (!(VERDICT_OUTCOMES as readonly string[]).includes(input.outcome)) {
    return refuse(
      'unknown-outcome',
      `"${input.outcome}" is not a verdict — expected one of ${VERDICT_OUTCOMES.join(', ')}`,
    );
  }

  if (input.by === task.role) {
    return refuse(
      'self-verdict',
      `${task.role} cannot record a verdict on its own deliverable — the transition is the dispatcher's (commitment 14)`,
    );
  }

  const seq = appendWorkLog(store, {
    run: task.run,
    task: task.id,
    role: 'construct',
    action: VERDICT_ACTION,
    detail: {
      challenge: input.challenge,
      outcome: input.outcome as VerdictOutcome,
      by: input.by,
      producedBy: task.role,
      ...(input.detail ?? {}),
    },
    at: input.at,
  });
  return { recorded: true, seq, refusal: null, reason: null };
}

/**
 * Where a task's deliverable stands on the reliance axis. Null when the task is
 * unknown — an answer of `draft` for a task that does not exist would be a
 * fabricated reassurance.
 *
 * The required challenges come off the brief, which declared them (commitment
 * 10: briefs declare, a dispatcher satisfies). A brief that named none leaves
 * the deliverable at `draft` forever, which is the intended reading: nobody
 * challenged it.
 */
export function promotionOf(store: Store, taskId: string): TaskPromotion | null {
  const task = getTask(store, taskId);
  if (!task) return null;

  const required = (task.brief as Brief | null)?.challenges ?? [];
  const verdicts: Verdict[] = [];
  const repaired = new Set<string>();
  for (const entry of entriesFor(store, task.run, task.id)) {
    if (entry.action !== VERDICT_ACTION) continue;
    const detail = entry.detail as {
      challenge?: unknown;
      outcome?: unknown;
      by?: unknown;
      attempt?: unknown;
    } | null;
    if (typeof detail?.challenge !== 'string' || typeof detail.by !== 'string') continue;
    if (!(VERDICT_OUTCOMES as readonly string[]).includes(detail.outcome as string)) continue;
    verdicts.push({
      challenge: detail.challenge,
      outcome: detail.outcome as VerdictOutcome,
      by: detail.by,
    });
    // Last one per challenge wins here for the same reason it wins in
    // promotionState: a re-check supersedes its own earlier result.
    if (detail.attempt === 'repaired') repaired.add(detail.challenge);
    else repaired.delete(detail.challenge);
  }

  const promotion = promotionState({ role: task.role, required, verdicts });
  return {
    ...promotion,
    task: task.id,
    run: task.run,
    role: task.role,
    required,
    repaired: required.filter((challenge) => repaired.has(challenge)),
  };
}

/**
 * The most recent draft a role submitted for this task, or null.
 *
 * Latest wins and earlier ones stay on the record: a role that revises after a
 * failed challenge has produced two drafts, and which one it is standing on now
 * is a different question from what it stood on before.
 */
export function latestDraft(store: Store, taskId: string): SubmittedDraft | null {
  const task = getTask(store, taskId);
  if (!task) return null;

  let latest: SubmittedDraft | null = null;
  for (const entry of entriesFor(store, task.run, task.id)) {
    if (entry.action !== DRAFT_ACTION) continue;
    const detail = entry.detail as { deliverable?: unknown } | null;
    latest = { seq: entry.seq, role: entry.role, deliverable: detail?.deliverable ?? null, at: entry.at };
  }
  return latest;
}

/**
 * Write the derived state down where a user reads it.
 *
 * Derived and logged, never stored: the entry is a statement about what the
 * record said at that moment, not a field anyone can later disagree with. Two
 * of these for one task are not a conflict — they are a before and an after.
 */
export function logPromotion(store: Store, taskId: string, at: string): TaskPromotion | null {
  const promotion = promotionOf(store, taskId);
  if (!promotion) return null;

  appendWorkLog(store, {
    run: promotion.run,
    task: promotion.task,
    role: 'construct',
    action: PROMOTION_ACTION,
    detail: {
      state: promotion.state,
      outstanding: promotion.outstanding,
      failing: promotion.failing,
      producedBy: promotion.role,
    },
    at,
  });
  return promotion;
}

/**
 * The user waiving one challenge on one deliverable.
 *
 * Commitment 13's last sentence, and every word of it is a constraint: waivers
 * are the user's alone, per deliverable, per challenge, and are logged — never
 * a global off-switch. So this takes a task and a challenge and nothing
 * broader; there is no configuration key, no environment variable, and no
 * skip-all flag, because a waiver that can be set once and forgotten is the
 * global off-switch arriving under another name.
 *
 * A reason is required. A waiver without one is indistinguishable from the
 * check never having been asked for, and the reason is the whole reason the
 * record is worth keeping — a person reading this deliverable in six months
 * needs to know why the challenge was set aside, not merely that it was.
 *
 * It rides the same verdict path as every other outcome, so there is exactly
 * one place a challenge outcome is recorded and exactly one derivation of
 * promotion state. `waived` was already in the vocabulary; nothing could write
 * it until now.
 */
export function waiveChallenge(
  store: Store,
  input: { readonly task: string; readonly challenge: string; readonly by: string; readonly reason: string; readonly at: string },
): VerdictRecord {
  if (input.reason.trim() === '') {
    const task = getTask(store, input.task);
    const reason = 'a waiver needs a stated reason — an unreasoned waiver is indistinguishable from the challenge never being asked for';
    if (!task) {
      return { recorded: false, seq: null, refusal: 'unknown-task', reason: `no task ${input.task} in this store` };
    }
    const seq = appendWorkLog(store, {
      run: task.run,
      task: task.id,
      role: 'construct',
      action: VERDICT_REFUSED_ACTION,
      detail: { refusal: 'unreasoned-waiver', reason, challenge: input.challenge, outcome: 'waived', by: input.by, producedBy: task.role },
      at: input.at,
    });
    return { recorded: false, seq, refusal: 'unreasoned-waiver', reason };
  }

  return recordVerdict(store, {
    task: input.task,
    challenge: input.challenge,
    outcome: 'waived',
    by: input.by,
    at: input.at,
    detail: { reason: input.reason },
  });
}

/**
 * How long a settled deliverable may sit at `draft` before it is worth
 * naming. Nothing in the store forces a verdict — a deliverable with no
 * required challenges stays draft forever by design, and one with
 * outstanding challenges stays draft until somebody answers them
 * (completion/promotion.ts) — so silence here is normal, not a defect.
 * Three days is chosen for a single operator running this on their own
 * machine: short enough that a forgotten draft is still recent when named,
 * long enough that a weekend away from the machine never trips it on its
 * own. There is no override for it; a fixed default a person can read in
 * the line that uses it is more honest than a setting nobody sets.
 */
export const DEFAULT_STALE_DRAFT_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

/** One settled deliverable that has sat at `draft` longer than the threshold. */
export interface StaleDraft {
  readonly run: string;
  readonly task: string;
  readonly role: string;
  readonly settledAt: string;
  /** `now` minus `settledAt`, in milliseconds. */
  readonly ageMs: number;
}

/**
 * Every settled task whose deliverable is still `draft` and has been for
 * longer than `thresholdMs`, oldest first.
 *
 * Built on `promotionOf` rather than a second derivation, so this can never
 * disagree with it about which tasks are still draft — there is exactly one
 * place promotion state is computed, and this reads it instead of guessing
 * at it from the work log directly. A task that never settled — still
 * running, or failed with no deliverable — is not this function's business:
 * draft is a property of a produced result, and a task with no result has
 * nothing to review yet.
 *
 * `now` is supplied, never read, for the same reason as everywhere else
 * under run/: a caller that wants "as of right now" passes its own clock in.
 */
export function staleUnreviewedDrafts(
  store: Store,
  opts: { readonly now: string; readonly thresholdMs: number },
): readonly StaleDraft[] {
  const nowMs = Date.parse(opts.now);
  const stale: StaleDraft[] = [];
  for (const task of listTasks(store)) {
    if (task.state !== 'done' || task.settledAt === null) continue;
    const promotion = promotionOf(store, task.id);
    if (promotion === null || promotion.state !== 'draft') continue;
    const ageMs = nowMs - Date.parse(task.settledAt);
    if (ageMs > opts.thresholdMs) {
      stale.push({ run: task.run, task: task.id, role: task.role, settledAt: task.settledAt, ageMs });
    }
  }
  return stale.sort((a, b) => b.ageMs - a.ageMs);
}
