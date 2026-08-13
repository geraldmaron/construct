/**
 * tests/kernel/capabilities/tokens.test.ts — what a role's token can and cannot
 * be made to say.
 *
 * The properties pinned here are the ones a later "simplification" would remove
 * without noticing: the grant set has no widening argument, a token is scoped to
 * exactly one task, and every failure path denies — including the ones where the
 * function cannot tell.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_GRANTS,
  TOKEN_FORMAT,
  authorizeRoleToken,
  issueRoleToken,
} from '../../../src/kernel/capabilities/tokens.ts';

const SECRET = 'kernel-secret-for-tests';
const NOW = '2026-08-04T00:00:00.000Z';
const EXPIRES = '2026-08-04T00:15:00.000Z';

function token(over: Partial<Parameters<typeof issueRoleToken>[0]> = {}): string {
  return issueRoleToken(
    { run: 'run-1', task: 't-privacy', role: 'privacy', expiresAt: EXPIRES, nonce: '1', ...over },
    SECRET,
  );
}

function ask(over: Partial<Parameters<typeof authorizeRoleToken>[2]> = {}) {
  return { grant: 'append-work-log', run: 'run-1', task: 't-privacy', now: NOW, ...over };
}

test('a role token grants exactly three writes', () => {
  assert.deepEqual([...ROLE_GRANTS], ['submit-draft', 'append-work-log', 'record-external-read']);

  const held = token();
  for (const grant of ROLE_GRANTS) {
    assert.equal(authorizeRoleToken(held, SECRET, ask({ grant })).ok, true, `${grant} is granted`);
  }
});

test('no token can be minted that records a verdict', () => {
  const denied = authorizeRoleToken(token(), SECRET, ask({ grant: 'record-verdict' }));
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.denial, 'ungranted');

  // The point is not that this particular call is refused — it is that
  // `issueRoleToken` takes no argument that would let it be granted. A mint with
  // a grants parameter is the surface commitment 14 exists to close, so its
  // absence is the property under test.
  const mint = issueRoleToken as unknown as (input: Record<string, unknown>, secret: string) => string;
  const smuggled = mint(
    {
      run: 'run-1',
      task: 't-privacy',
      role: 'privacy',
      expiresAt: EXPIRES,
      nonce: '1',
      grants: ['record-verdict'],
    },
    SECRET,
  );
  const stillDenied = authorizeRoleToken(smuggled, SECRET, ask({ grant: 'record-verdict' }));
  assert.equal(stillDenied.ok, false, 'a grants field on the input is ignored, not honored');
});

test('a token is scoped to one run and one task', () => {
  const held = token();
  const otherTask = authorizeRoleToken(held, SECRET, ask({ task: 't-security' }));
  assert.equal(otherTask.ok === false && otherTask.denial, 'wrong-task');

  const otherRun = authorizeRoleToken(held, SECRET, ask({ run: 'run-2' }));
  assert.equal(otherRun.ok === false && otherRun.denial, 'wrong-run');
});

test('a rewritten payload does not verify', () => {
  const held = token();
  const [format, payload, mac] = held.split('.');
  assert.equal(format, TOKEN_FORMAT);

  const scope = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  scope.task = 't-security';
  scope.grants = ['submit-draft', 'append-work-log', 'record-verdict'];
  const rewritten = `${format}.${Buffer.from(JSON.stringify(scope), 'utf8').toString('base64url')}.${mac}`;

  const denied = authorizeRoleToken(rewritten, SECRET, ask({ task: 't-security' }));
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.denial, 'bad-signature');
});

test('a token minted by someone else does not verify', () => {
  const foreign = issueRoleToken(
    { run: 'run-1', task: 't-privacy', role: 'privacy', expiresAt: EXPIRES, nonce: '1' },
    'a-different-secret',
  );
  const denied = authorizeRoleToken(foreign, SECRET, ask());
  assert.equal(denied.ok === false && denied.denial, 'bad-signature');
});

test('an expired token is refused, and so is one whose deadline cannot be read', () => {
  const expired = authorizeRoleToken(token(), SECRET, ask({ now: '2026-08-04T00:15:00.001Z' }));
  assert.equal(expired.ok === false && expired.denial, 'expired');

  // Exactly at the deadline is still inside it.
  assert.equal(authorizeRoleToken(token(), SECRET, ask({ now: EXPIRES })).ok, true);

  const unreadable = authorizeRoleToken(token({ expiresAt: 'whenever' }), SECRET, ask());
  assert.equal(
    unreadable.ok === false && unreadable.denial,
    'unreadable-deadline',
    'a deadline that cannot be read has not been shown to be in the future',
  );
});

test('garbage is denied rather than parsed', () => {
  for (const bad of ['', 'not-a-token', 'cx1.only-two-parts', 'cx2.a.b', null, undefined, 42, {}]) {
    const denied = authorizeRoleToken(bad, SECRET, ask());
    assert.equal(denied.ok, false, `${JSON.stringify(bad)} must not authorize anything`);
  }

  // Signed, but not a scope this kernel would ever have minted.
  const denied = authorizeRoleToken(token(), SECRET, ask({ grant: '' }));
  assert.equal(denied.ok, false);
});
