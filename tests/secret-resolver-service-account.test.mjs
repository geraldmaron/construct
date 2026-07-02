/**
 * tests/secret-resolver-service-account.test.mjs — opt-in 1Password service-account path.
 *
 * A service account (OP_SERVICE_ACCOUNT_TOKEN) makes `op read` non-interactive. The
 * resolver forwards the token from the caller's env into the `op` subprocess so a
 * runtime can source it from the OS keychain rather than the ambient shell, while the
 * desktop app integration stays the default when no token is set.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  opServiceAccountToken,
  resolveOpRef,
  resolveSecret,
  __clearSecretCache,
} from '../lib/providers/secret-resolver.mjs';

test('opServiceAccountToken returns the trimmed token when set, null otherwise', () => {
  assert.equal(opServiceAccountToken({ OP_SERVICE_ACCOUNT_TOKEN: '  ops_abc  ' }), 'ops_abc');
  assert.equal(opServiceAccountToken({ OP_SERVICE_ACCOUNT_TOKEN: '' }), null);
  assert.equal(opServiceAccountToken({}), null);
  assert.equal(opServiceAccountToken({ OP_SERVICE_ACCOUNT_TOKEN: 42 }), null);
});

test('resolveOpRef forwards the caller env (with the service-account token) to op read', () => {
  __clearSecretCache();
  let seen = null;
  const spy = (ref, opts) => { seen = { ref, opts }; return 'resolved-value'; };
  const value = resolveOpRef('op://vault-a/item-a/credential', {
    opRead: spy,
    env: { OP_SERVICE_ACCOUNT_TOKEN: 'ops_token_1' },
  });
  assert.equal(value, 'resolved-value');
  assert.equal(seen.ref, 'op://vault-a/item-a/credential');
  assert.equal(seen.opts.env.OP_SERVICE_ACCOUNT_TOKEN, 'ops_token_1',
    'the op subprocess must receive the service-account token from the caller env');
});

test('resolveSecret threads the token through to op read for a direct op:// ref (hermetic)', () => {
  __clearSecretCache();
  let seen = null;
  const spy = (ref, opts) => { seen = { ref, opts }; return 'sk-materialized'; };
  const value = resolveSecret('MY_KEY', {
    env: { MY_KEY: 'op://vault-b/item-b/credential', OP_SERVICE_ACCOUNT_TOKEN: 'ops_token_2' },
    allowAmbient: false,
    opRead: spy,
  });
  assert.equal(value, 'sk-materialized');
  assert.equal(seen.opts.env.OP_SERVICE_ACCOUNT_TOKEN, 'ops_token_2');
});

test('resolveOpRef stays non-interactive-agnostic when no token is set (desktop fallback)', () => {
  __clearSecretCache();
  let seen = null;
  const spy = (ref, opts) => { seen = { ref, opts }; return 'v'; };
  resolveOpRef('op://vault-c/item-c/credential', { opRead: spy, env: {} });
  assert.equal(opServiceAccountToken(seen.opts.env), null,
    'with no token the resolver forwards the env unchanged and the desktop flow applies');
});
