/**
 * tests/cli/live-namer.test.ts — a missing host login is null, not a guess.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveHostNamer, resolveLiveNamer } from '../../src/cli/live-namer.ts';
import { DOMAINS } from '../../src/kernel/implication/domains.ts';

test('resolveLiveNamer is null when no host CLI is on PATH', async () => {
  const resolved = await resolveLiveNamer({ ...process.env, PATH: '/nonexistent' });
  assert.equal(resolved, null);
});

test('liveHostNamer throws when no host is logged in rather than naming from keywords', async () => {
  const namer = liveHostNamer({ ...process.env, PATH: '/nonexistent' });
  await assert.rejects(() => namer('any outcome', DOMAINS), /no logged-in host namer/);
});
