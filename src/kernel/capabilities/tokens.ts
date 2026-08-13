/**
 * kernel/capabilities/tokens.ts — the capability token a role holds: scoped to
 * one run and one task, granting exactly three writes and nothing else.
 *
 * Commitment 14 exists because an ungated write surface let a role under
 * completion pressure mark its own challenge passed in the predecessor. The
 * durable fix has two halves. completion/promotion.ts is the first: promotion is
 * DERIVED from recorded verdicts, so there is no setter to reach even for a
 * caller holding every permission there is. This module is the second: a role
 * reaching back into Construct — over MCP, which commitment 1 makes the
 * tool-independence layer — presents a token, and the token cannot express the
 * authority to record a verdict at all.
 *
 * The grant set is a constant, not a parameter. `issueRoleToken` is the only
 * mint and it always writes ROLE_GRANTS; there is no argument that widens it,
 * because an argument that widens it is the exact surface this module exists to
 * close. Adding a third grant is a code change with a reviewer attached, which
 * is the point.
 *
 * A bearer string rather than an object, because the holder runs inside a host
 * process and reaches back across a process boundary: whatever crosses that is
 * text, and text a role can retype is text a role can forge. The payload is
 * signed with a kernel-held secret, so a role may present a token but cannot
 * mint one — it cannot widen its own scope, extend its own expiry, or add to its
 * own grants without invalidating a signature it cannot recompute.
 *
 * Same disciplines as the rest of the kernel: no clock, no environment. Expiry
 * is judged against a caller-supplied `now`, and the secret is injected.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Everything a role may do, in full. Submit drafts, append to the work log in
 * its own name, and record what it read outside the run's declared ground.
 * Not: record a verdict, settle a task, resolve a decision, write in another
 * role's name, or touch a task that is not its own.
 *
 * The third grant records provenance the run would otherwise have none of: a
 * role whose host can reach the web reads standards and documentation no
 * declared source holds, and before this the reading left no trace at all. It
 * widens what a role may write about, not what it may decide.
 */
export const ROLE_GRANTS = ['submit-draft', 'append-work-log', 'record-external-read'] as const;

export type Grant = (typeof ROLE_GRANTS)[number];

/** Format marker. A token from a future format is rejected, never guessed at. */
export const TOKEN_FORMAT = 'cx1';

export interface TokenScope {
  readonly run: string;
  readonly task: string;
  /** The role this token speaks for. Writes are attributed to it, not to a caller. */
  readonly role: string;
  /** Injected; the kernel never reads the clock. */
  readonly expiresAt: string;
  /** Distinguishes two tokens minted for the same task — e.g. a second attempt. */
  readonly nonce: string;
  readonly grants: readonly Grant[];
}

export interface IssueRoleToken {
  readonly run: string;
  readonly task: string;
  readonly role: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export const DENIALS = [
  'malformed',
  'bad-signature',
  'unreadable-deadline',
  'expired',
  'wrong-run',
  'wrong-task',
  'ungranted',
  // Not reachable from this module, which is pure and holds no store. A
  // revocation is a fact somebody recorded, and the denial name lives with its
  // siblings so every refusal a role can meet is one list.
  'revoked',
] as const;

export type Denial = (typeof DENIALS)[number];

export type Authorization =
  | { readonly ok: true; readonly scope: TokenScope }
  | { readonly ok: false; readonly denial: Denial; readonly reason: string };

export interface AuthorizeRequest {
  /**
   * Typed as a plain string, not as `Grant`. A request for something the token
   * does not grant has to be expressible — if the type made `record-verdict`
   * unsayable, the check that refuses it could not be written down or tested,
   * and the only thing standing between a role and a verdict would be the
   * compiler of the process asking.
   */
  readonly grant: string;
  readonly run: string;
  readonly task: string;
  /** Injected; the kernel never reads the clock. */
  readonly now: string;
}

interface Payload {
  readonly run: unknown;
  readonly task: unknown;
  readonly role: unknown;
  readonly expiresAt: unknown;
  readonly nonce: unknown;
  readonly grants: unknown;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * Mint a token for one role's work on one task. The expiry is the caller's to
 * choose and should be the task's own lease deadline: a token that outlives the
 * lease is a write surface still open on work another worker has taken over.
 */
export function issueRoleToken(input: IssueRoleToken, secret: string): string {
  const scope: TokenScope = {
    run: input.run,
    task: input.task,
    role: input.role,
    expiresAt: input.expiresAt,
    nonce: input.nonce,
    grants: ROLE_GRANTS,
  };
  const payload = Buffer.from(JSON.stringify(scope), 'utf8').toString('base64url');
  const body = `${TOKEN_FORMAT}.${payload}`;
  return `${body}.${sign(body, secret)}`;
}

function deny(denial: Denial, reason: string): Authorization {
  return { ok: false, denial, reason };
}

function readScope(payload: string): TokenScope | null {
  let parsed: Payload;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Payload;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  for (const field of ['run', 'task', 'role', 'expiresAt', 'nonce'] as const) {
    if (typeof parsed[field] !== 'string') return null;
  }
  if (!Array.isArray(parsed.grants) || parsed.grants.some((g) => typeof g !== 'string')) return null;
  return {
    run: parsed.run as string,
    task: parsed.task as string,
    role: parsed.role as string,
    expiresAt: parsed.expiresAt as string,
    nonce: parsed.nonce as string,
    grants: parsed.grants as readonly Grant[],
  };
}

/**
 * Decide whether this token authorizes this write, right now.
 *
 * The order of the checks is load-bearing. The signature is verified before a
 * single field of the payload is believed, because an unverified payload is
 * attacker-supplied text; every later check reads values only after the
 * signature says they are the kernel's own. Expiry and scope come next, and the
 * grant last, so the reason a caller gets back names the first thing actually
 * wrong rather than the last thing checked.
 *
 * Every failure path denies. There is no branch that returns ok on an error,
 * including a timestamp this function cannot parse — a deadline that cannot be
 * read has not been shown to be in the future, and treating "cannot tell" as
 * "still valid" is how an expiry stops being one.
 */
export function authorizeRoleToken(
  token: unknown,
  secret: string,
  request: AuthorizeRequest,
): Authorization {
  if (typeof token !== 'string' || token.length === 0) {
    return deny('malformed', 'no capability token was presented');
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_FORMAT) {
    return deny('malformed', `token is not a ${TOKEN_FORMAT} capability token`);
  }

  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret), 'utf8');
  const presented = Buffer.from(parts[2], 'utf8');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return deny('bad-signature', 'token signature does not verify — it was not minted by this kernel');
  }

  const scope = readScope(parts[1]);
  if (!scope) return deny('malformed', 'token payload is not a readable scope');

  const now = Date.parse(request.now);
  const until = Date.parse(scope.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(until)) {
    return deny('unreadable-deadline', 'token deadline or current time could not be read as a date');
  }
  if (now > until) {
    return deny('expired', `token expired at ${scope.expiresAt}`);
  }

  if (scope.run !== request.run) {
    return deny('wrong-run', `token is scoped to run ${scope.run}, not ${request.run}`);
  }
  if (scope.task !== request.task) {
    return deny('wrong-task', `token is scoped to task ${scope.task}, not ${request.task}`);
  }
  if (!scope.grants.includes(request.grant as Grant)) {
    return deny(
      'ungranted',
      `a role token grants ${scope.grants.join(' and ')} — never ${request.grant}`,
    );
  }

  return { ok: true, scope };
}
