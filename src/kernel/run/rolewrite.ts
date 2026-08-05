/**
 * kernel/run/rolewrite.ts — the only door a role's capability token opens.
 *
 * Two writes, and no third. A role submits drafts and appends to the work log in
 * its own name; everything else it might want — recording a verdict, settling
 * its task, resolving a decision, writing under another role — has no function
 * here to call, which is a stronger statement than a function that checks.
 *
 * ROLE-WRITTEN LOG ENTRIES ARE NAMESPACED, and this is the part that is easy to
 * get subtly wrong. The work log is where verdicts live (see promotion.ts), so
 * an unrestricted `append-work-log` grant would be a verdict-write surface
 * wearing a different name: a role that could choose its own action string could
 * write `verdict-recorded` and promote itself through the log instead of through
 * the dispatcher. The obvious fix — a denylist of reserved actions — fails on the
 * day someone adds a dispatcher action and does not update the list, and that
 * day is invisible until it costs something. So every role-chosen action is
 * prefixed instead. A role cannot express a dispatcher action at all, no list is
 * kept in sync, and the guarantee holds for actions that do not exist yet.
 *
 * `draft-submitted` is written unprefixed, and that is not an exception to the
 * rule. It is not an action a role chose; it is the fixed meaning of the
 * `submit-draft` grant, reachable only by holding that grant. The namespace
 * governs what a role may NAME, not what a grant may DO.
 *
 * Denials are recorded, never dropped. A refused write is the most informative
 * event this surface produces — commitment 14 exists because the predecessor's
 * equivalent went unwatched — and a safeguard that works silently is
 * indistinguishable from one that has stopped working.
 *
 * Same disciplines as the rest of run/: no clock, no environment.
 */

import type { Store } from '../store/open.ts';
import {
  appendWorkLog,
  countWorkLogEntries,
  countWorkLogEntriesByPrefix,
} from '../store/worklog.ts';

/** Role-authored notes for a task, whatever action names the role chose. */
function countRoleNotes(store: Store, run: string, task: string): number {
  return countWorkLogEntriesByPrefix(store, run, task, ROLE_ACTION_PREFIX);
}
import { authorizeRoleToken } from '../capabilities/tokens.ts';
import type { Denial } from '../capabilities/tokens.ts';
import { DRAFT_ACTION } from './promotion.ts';

/** Prefixed onto every action a role chooses for itself. */
export const ROLE_ACTION_PREFIX = 'role:';

/** What a refused write is filed under. */
export const CAPABILITY_DENIED_ACTION = 'capability-denied';

/** Where a denial is filed when the caller did not even name a run. */
const UNATTRIBUTED = 'unattributed';

/**
 * What a role is told about the two writes it holds.
 *
 * This block exists because the surface was built, registered, reachable — and
 * never mentioned to the model. A live four-role run finished with every role
 * reporting and not one draft submitted, because nothing in the assignment said
 * the tools were there. Both host registrations were proven by probes that pass
 * an explicit "call submit_draft" instruction, which demonstrates plumbing and
 * not that any real dispatch flows through it.
 *
 * Kept beside the grants rather than in the coordinator on purpose: the sentence
 * describing what a role may do and the code enforcing it should be impossible
 * to change independently. The wording follows STANCE_PROTOCOL — a fixed block
 * in plain imperative English, because that is the shape live models actually
 * follow.
 *
 * Deliberately host-agnostic. It names no registration mechanism, because a role
 * has no business knowing which host it landed on, and the tool names are given
 * unprefixed with a note that hosts namespace them differently — Claude exposes
 * `mcp__construct__submit_draft` where OpenCode exposes `construct_submit_draft`,
 * and a role told only one spelling would be wrong on the other host.
 */
export const WRITE_SURFACE_PROTOCOL = [
  'You can write back to Construct. A server named "construct" gives you exactly',
  'two tools, and no others:',
  '',
  '  submit_draft      — put your deliverable on the record. Submitting does not',
  '                      promote it: it stays a draft until it survives challenges',
  '                      that are not yours to record.',
  '  append_work_log   — record one line, in your own name, about what you',
  '                      reviewed, flagged, or could not determine.',
  '',
  'Call submit_draft exactly once, with your finished deliverable, before you',
  'stop. Your reply text is read as well, but the draft is what lands on the',
  'record attributed to you.',
  '',
  'Your host may show these names with a prefix. Use whatever spelling appears in',
  'your own tool list; the names above are the unprefixed ones.',
].join('\n');

/**
 * What a role is told when it holds no write surface.
 *
 * A dispatch without a role environment is legitimate — it is the safe default
 * whenever no capability secret is in play — so this must not read as a failure
 * or send the model hunting for a tool that is not there. Saying nothing was the
 * old behavior and is worse than either: a model that has been given tools on
 * other runs and none here cannot tell the difference from silence.
 */
export const NO_WRITE_SURFACE_NOTE = [
  'You have no write surface on this run, which is normal and not an error.',
  'Report in your reply text and do not look for a tool to call.',
].join('\n');

export interface RoleCredential {
  /** The bearer string the role presented. Unknown, because it is untrusted input. */
  readonly token: unknown;
  /** The kernel's signing secret. Injected. */
  readonly secret: string;
  /** Injected; the kernel never reads the clock. Judges expiry and stamps the entry. */
  readonly at: string;
}

export interface RoleAppend {
  /**
   * The run and task the caller believes it is writing to.
   *
   * Carried in the request even though the token already names both, so that a
   * mismatch is an error rather than a silent redirection. A role holding a
   * token for task A and asking to write to task B has a bug or an intent worth
   * seeing; taking the scope off the token alone would quietly write to A and
   * report success.
   */
  readonly run: string;
  readonly task: string;
  /** Namespaced under ROLE_ACTION_PREFIX before it is stored. */
  readonly action: string;
  readonly detail?: unknown;
}

export interface DraftSubmission {
  readonly run: string;
  readonly task: string;
  readonly deliverable: unknown;
}

export type WriteOutcome =
  | {
      readonly ok: true;
      readonly seq: number;
      readonly role: string;
      /**
       * Guidance carried in the tool reply itself. Observed on a live run: a
       * small model read a bare {ok:true} as "continue" and resubmitted its
       * draft twenty times until the host timeout killed the task, so a
       * resubmission's success now says out loud that stopping is the next
       * move.
       */
      readonly note?: string;
    }
  | {
      readonly ok: false;
      readonly denial: Denial | 'draft-cap' | 'note-cap';
      readonly reason: string;
      /** The work log sequence the denial itself was filed under. */
      readonly seq: number;
    };

function refuse(
  store: Store,
  credential: RoleCredential,
  scope: { run: string; task: string },
  grant: string,
  denial: Denial,
  reason: string,
): WriteOutcome {
  const seq = appendWorkLog(store, {
    run: scope.run.trim() || UNATTRIBUTED,
    task: scope.task.trim() || null,
    role: 'construct',
    action: CAPABILITY_DENIED_ACTION,
    // The token itself is never logged. What is useful is what was attempted and
    // why it was refused; the bearer string is a secret and a log is not a vault.
    detail: { grant, denial, reason },
    at: credential.at,
  });
  return { ok: false, denial, reason, seq };
}

/**
 * Append one entry to the work log in the role's own name.
 *
 * The role, run and task on the stored entry come from the verified token, not
 * from the request — a role writes in its own name because there is no argument
 * with which to write in another's.
 */
export function appendAsRole(
  store: Store,
  credential: RoleCredential,
  request: RoleAppend,
): WriteOutcome {
  const authorization = authorizeRoleToken(credential.token, credential.secret, {
    grant: 'append-work-log',
    run: request.run,
    task: request.task,
    now: credential.at,
  });
  if (!authorization.ok) {
    return refuse(
      store,
      credential,
      request,
      'append-work-log',
      authorization.denial,
      authorization.reason,
    );
  }

  const { scope } = authorization;

  // The same wall the draft cap is, for the same observed loop: with drafts
  // capped, a role that wanted to ask a question spun "awaiting_clarification"
  // through this surface hundreds of times until the host timeout killed the
  // task. Notes are counted across all role-authored actions per task, so the
  // loop cannot dodge the cap by varying the action name.
  const notes = countRoleNotes(store, scope.run, scope.task);
  if (notes >= NOTE_CAP) {
    const marked = countWorkLogEntries(store, scope.run, scope.task, NOTE_CAP_ACTION);
    const seq =
      marked > 0
        ? 0
        : appendWorkLog(store, {
            run: scope.run,
            task: scope.task,
            role: scope.role,
            action: NOTE_CAP_ACTION,
            detail: { cap: NOTE_CAP },
            at: credential.at,
          });
    return {
      ok: false,
      denial: 'note-cap',
      reason:
        `${String(NOTE_CAP)} work log entries are already on the record for this task and this one was NOT recorded. ` +
        'If something blocks you, say so in your deliverable and finish. Stop now — do not call append_work_log again.',
      seq,
    };
  }

  const seq = appendWorkLog(store, {
    run: scope.run,
    task: scope.task,
    role: scope.role,
    action: `${ROLE_ACTION_PREFIX}${request.action}`,
    detail: request.detail ?? null,
    at: credential.at,
  });
  return { ok: true, seq, role: scope.role };
}

/**
 * How many drafts one task may put on the record. Supersession is legal — a
 * clean live run submitted twice — but a role in a loop submitted twenty-plus
 * times over ten minutes until the host timeout killed the task. Five is
 * generous for legitimate revision and small enough that a loop hits the wall
 * in seconds, not minutes.
 */
export const DRAFT_CAP = 5;

/** The one-time log marker that the cap closed a task's draft window. */
export const DRAFT_CAP_ACTION = 'draft-cap-reached';

/**
 * How many notes one task may put on the record through append_work_log.
 * Generous for real work — the richest legitimate run observed used a
 * handful — and small enough that the observed clarification loop hits the
 * wall in seconds rather than running to the host timeout.
 */
export const NOTE_CAP = 25;

/** The one-time log marker that the cap closed a task's note window. */
export const NOTE_CAP_ACTION = 'note-cap-reached';

/**
 * Submit a draft of the deliverable.
 *
 * Submitting does not promote. The draft lands on the record and the promotion
 * state is derived from verdicts that are not this role's to record — see
 * promotion.ts. A role may supersede its draft up to DRAFT_CAP times; past
 * that, submissions are refused with a stop message, and the cap event lands
 * on the append-only log exactly once rather than once per retry — the log
 * records that the window closed, not the shape of the loop that hit it.
 */
export function submitDraft(
  store: Store,
  credential: RoleCredential,
  request: DraftSubmission,
): WriteOutcome {
  const authorization = authorizeRoleToken(credential.token, credential.secret, {
    grant: 'submit-draft',
    run: request.run,
    task: request.task,
    now: credential.at,
  });
  if (!authorization.ok) {
    return refuse(
      store,
      credential,
      request,
      'submit-draft',
      authorization.denial,
      authorization.reason,
    );
  }

  const { scope } = authorization;

  const drafts = countWorkLogEntries(store, scope.run, scope.task, DRAFT_ACTION);
  if (drafts >= DRAFT_CAP) {
    const marked = countWorkLogEntries(store, scope.run, scope.task, DRAFT_CAP_ACTION);
    const seq =
      marked > 0
        ? 0
        : appendWorkLog(store, {
            run: scope.run,
            task: scope.task,
            role: scope.role,
            action: DRAFT_CAP_ACTION,
            detail: { cap: DRAFT_CAP },
            at: credential.at,
          });
    return {
      ok: false,
      denial: 'draft-cap',
      reason:
        `${String(DRAFT_CAP)} drafts are already on the record for this task and this one was NOT recorded. ` +
        'Your work is done. Stop now — do not call submit_draft again.',
      seq,
    };
  }

  const seq = appendWorkLog(store, {
    run: scope.run,
    task: scope.task,
    role: scope.role,
    action: DRAFT_ACTION,
    detail: { deliverable: request.deliverable },
    at: credential.at,
  });
  if (drafts > 0) {
    return {
      ok: true,
      seq,
      role: scope.role,
      note:
        `draft ${String(drafts + 1)} is on the record and supersedes your earlier draft. ` +
        'If this is your final draft, stop now — do not call submit_draft again.',
    };
  }
  return { ok: true, seq, role: scope.role };
}
