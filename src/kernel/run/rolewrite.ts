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
import { appendWorkLog } from '../store/worklog.ts';
import { authorizeRoleToken } from '../capabilities/tokens.ts';
import type { Denial } from '../capabilities/tokens.ts';
import { DRAFT_ACTION } from './promotion.ts';

/** Prefixed onto every action a role chooses for itself. */
export const ROLE_ACTION_PREFIX = 'role:';

/** What a refused write is filed under. */
export const CAPABILITY_DENIED_ACTION = 'capability-denied';

/** Where a denial is filed when the caller did not even name a run. */
const UNATTRIBUTED = 'unattributed';

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
  | { readonly ok: true; readonly seq: number; readonly role: string }
  | {
      readonly ok: false;
      readonly denial: Denial;
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
 * Submit a draft of the deliverable.
 *
 * Submitting does not promote. The draft lands on the record and the promotion
 * state is derived from verdicts that are not this role's to record — see
 * promotion.ts. A role can submit as many drafts as it likes and move nothing.
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
  const seq = appendWorkLog(store, {
    run: scope.run,
    task: scope.task,
    role: scope.role,
    action: DRAFT_ACTION,
    detail: { deliverable: request.deliverable },
    at: credential.at,
  });
  return { ok: true, seq, role: scope.role };
}
