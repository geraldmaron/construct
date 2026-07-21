/**
 * tests/providers/vhs-provider.test.mjs — VHS Provider discovery and spawn routing (construct-tsyfe.5.3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveVhsProvider,
  locateTerminalRecorder,
  spawnVhsTape,
  queryVhsProviderCard,
} from '../../lib/providers/vhs.mjs';

test('resolveVhsProvider degrades without throwing when vhs is absent', () => {
  const provider = resolveVhsProvider({ PATH: '/usr/bin:/bin' });
  assert.equal(typeof provider.degraded, 'boolean');
  assert.equal(provider.id, 'vhs');
});

test('locateTerminalRecorder returns null when no recorder binaries exist', () => {
  const located = locateTerminalRecorder({ PATH: '/usr/bin:/bin' });
  assert.equal(located, null);
});

test('spawnVhsTape returns provider card payload fields', () => {
  const fakeBinary = process.execPath;
  const spawned = spawnVhsTape(fakeBinary, '/tmp/example.tape', {
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'not vhs' }),
  });
  assert.equal(spawned.providerId, 'vhs');
  assert.equal(spawned.tapeSource, '/tmp/example.tape');
  assert.ok(spawned.result);
});

test('queryVhsProviderCard exposes install hint text', () => {
  const card = queryVhsProviderCard();
  assert.match(card.installHint, /VHS|vhs/);
});
