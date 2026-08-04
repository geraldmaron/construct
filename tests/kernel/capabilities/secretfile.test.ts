/**
 * tests/kernel/capabilities/secretfile.test.ts — the signing secret at rest:
 * established once, private, stable across loads, and never invented by a
 * process that only verifies.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { sterile } from '../../harness/sterile.ts';
import { loadOrCreateSecret, loadSecret } from '../../../src/kernel/capabilities/secretfile.ts';

test('first use establishes a secret; later uses read the same one', () => {
  const fixture = sterile();
  try {
    const file = join(fixture.root, 'data', 'capability-secret');
    const first = loadOrCreateSecret(file);
    assert.match(first, /^[0-9a-f]{64}$/, 'expected 32 random bytes as hex');
    assert.equal(loadOrCreateSecret(file), first);
    assert.equal(loadSecret(file), first);
  } finally {
    fixture.cleanup();
  }
});

test('the secret file is created private to the user', (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root, where mode checks prove nothing');
    return;
  }
  const fixture = sterile();
  try {
    const file = join(fixture.root, 'data', 'capability-secret');
    loadOrCreateSecret(file);
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600, `secret file mode is ${mode.toString(8)}, expected 600`);
  } finally {
    fixture.cleanup();
  }
});

test('a verifier never invents a secret', () => {
  const fixture = sterile();
  try {
    const file = join(fixture.root, 'data', 'capability-secret');
    assert.equal(loadSecret(file), null);
    // And an empty file is "no secret", not a secret of length zero — a blank
    // HMAC key would verify tokens signed with a blank key.
    mkdirSync(join(fixture.root, 'data'), { recursive: true });
    writeFileSync(file, '\n');
    assert.equal(loadSecret(file), null);
  } finally {
    fixture.cleanup();
  }
});
