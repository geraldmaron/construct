/**
 * tests/kernel/render/redact.test.ts — the credential boundary's own rule.
 *
 * What is held here: a token-shaped value in host- or connector-derived text
 * comes back replaced with the fixed placeholder, every named provider shape is
 * caught by its own signature, and ordinary error prose passes through intact —
 * because a redaction that ate the reason a call failed would cost the reader
 * the one thing the record is for.
 *
 * Every synthetic credential is assembled from fragments at runtime rather than
 * written as one literal, so no source line here carries a contiguous secret
 * shape for the commit-time scanner to flag. The assembled string is what the
 * redactor sees; the file on disk never holds it whole.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, REDACTION_PLACEHOLDER } from '../../../src/kernel/render/redact.ts';

const BODY = 'abcdefghijklmnopqrstuvwxyz0123456789';

test('a stderr string carrying a token-shaped value is redacted', () => {
  const token = 'sk-' + 'ant-' + 'api03-' + BODY;
  const stderr = `auth failed: token ${token} rejected`;
  const out = redact(stderr);
  assert.ok(!out.includes(token));
  assert.ok(out.includes(REDACTION_PLACEHOLDER));
  // The surrounding words survive so the reader still learns what happened.
  assert.ok(out.startsWith('auth failed:'));
  assert.ok(out.endsWith('rejected'));
});

test('each named provider shape is caught', () => {
  const cases: readonly string[] = [
    'sk-' + 'ant-' + 'api03-' + BODY,
    'sk-' + 'proj-' + BODY,
    'AKIA' + 'IOSFODNN7EXAMPLE',
    'ghp_' + BODY + BODY.slice(0, 4),
    'ghs_' + BODY + BODY.slice(0, 4),
    'gho_' + BODY + BODY.slice(0, 4),
    'github_' + 'pat_' + '11ABCDEFG0' + BODY + '_ABCDEFGHIJKLMNOP',
    'xox' + 'b-' + '0000000000-1111111111-abcdEFGHijklMNOPqrst',
    'xox' + 'p-' + '0000000000-1111111111-abcdEFGHijklMNOPqrst',
    'ATATT3' + 'xFfGF0' + BODY + 'ABCDEF' + '=1A2B3C4D',
    'AIza' + BODY.slice(0, 35),
  ];
  for (const value of cases) {
    const out = redact(`prefix ${value} suffix`);
    assert.ok(!out.includes(value), `expected ${value} to be redacted, got: ${out}`);
    assert.equal(out, `prefix ${REDACTION_PLACEHOLDER} suffix`);
  }
});

test('a PEM private-key block is redacted whole, across its lines', () => {
  const pem = [
    '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA' + BODY + BODY,
    'OPqrstuvwxyz' + BODY + '==',
    '-----END RSA ' + 'PRIVATE KEY-----',
  ].join('\n');
  const out = redact(`could not load key:\n${pem}\n(giving up)`);
  assert.ok(!out.includes('BEGIN RSA PRIVATE KEY'));
  assert.ok(!out.includes('MIIEowIBAAKCAQEA'));
  assert.ok(out.includes(REDACTION_PLACEHOLDER));
  assert.ok(out.startsWith('could not load key:'));
  assert.ok(out.endsWith('(giving up)'));
});

test('a plain error message survives intact', () => {
  const messages: readonly string[] = [
    'Model not found: ollama/qwen3.5:4b',
    'Jira answered 401: Basic authentication with passwords is deprecated',
    'connection refused after 3 attempts (internationalization not the problem here)',
    'stdout is not a result envelope — version drift? Run npm run probe:claude.',
  ];
  for (const message of messages) {
    assert.equal(redact(message), message);
  }
});

test('a generic high-entropy token is redacted, a long ordinary word is not', () => {
  // A 40-char hex digest: long, mixed digits and letters, high entropy.
  const digest = 'a3f5c9d1b7e04628f1a9c3d5e7b90246f8a1c3d5';
  const outDigest = redact(`unexpected object hash ${digest} on record`);
  assert.ok(outDigest.includes(REDACTION_PLACEHOLDER));
  assert.ok(!outDigest.includes(digest));

  // A long word with no digit is never taken for a secret.
  const word = 'internationalizationalization';
  assert.equal(redact(word), word);
});
