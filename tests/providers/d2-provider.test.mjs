/**
 * tests/providers/d2-provider.test.mjs — D2 Provider discovery and spawn routing (construct-tsyfe.4.3).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  D2_PROVIDER_ID,
  buildD2CliArgs,
  buildD2DistributionArgs,
  buildD2ProviderCardPayload,
  queryD2ProviderCard,
  resolveD2Provider,
  spawnD2Render,
} from '../../lib/providers/d2.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('resolveD2Provider degrades without throwing when d2 is absent', () => {
  const provider = resolveD2Provider({ PATH: '/usr/bin:/bin' });
  assert.equal(typeof provider.degraded, 'boolean');
  assert.equal(provider.id, D2_PROVIDER_ID);
});

test('buildD2CliArgs maps neutral theme to theme id 0', () => {
  const args = buildD2CliArgs({ sourcePath: '/tmp/in.d2', outPath: '/tmp/out.svg', theme: 'neutral' });
  assert.deepEqual(args, ['--theme', '0', '/tmp/in.d2', '/tmp/out.svg']);
});

test('buildD2DistributionArgs uses canonical publish flags', () => {
  const args = buildD2DistributionArgs({ sourcePath: '/tmp/in.d2', outPath: '/tmp/out.png' });
  assert.deepEqual(args, ['--sketch', '--pad', '16', '--theme', '0', '/tmp/in.d2', '/tmp/out.png']);
});

test('spawnD2Render returns provider card payload fields', () => {
  const fakeBinary = process.execPath;
  const spawned = spawnD2Render({
    binary: fakeBinary,
    sourcePath: '/tmp/in.d2',
    outPath: '/tmp/out.svg',
    profile: 'cli',
    theme: 'neutral',
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'not d2' }),
  });
  assert.equal(spawned.providerId, D2_PROVIDER_ID);
  assert.equal(spawned.engine, 'd2');
  assert.equal(spawned.profile, 'cli');
  assert.ok(Array.isArray(spawned.flags));
  assert.ok(spawned.result);
});

test('buildD2ProviderCardPayload marks degraded when binary is missing', () => {
  const payload = buildD2ProviderCardPayload({ binary: null, version: null, flags: [], profile: 'cli' });
  assert.equal(payload.degraded, true);
  assert.equal(payload.engine, 'd2');
});

test('no direct spawnSync(\'d2\' calls remain outside lib/providers/d2.mjs', () => {
  const libDir = path.join(REPO_ROOT, 'lib');
  const hits = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.mjs')) continue;
      if (full.endsWith(`${path.sep}providers${path.sep}d2.mjs`)) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (/spawnSync\(\s*['"]d2['"]/.test(source)) hits.push(path.relative(REPO_ROOT, full));
    }
  }
  walk(libDir);
  assert.deepEqual(hits, [], `direct spawnSync('d2') outside provider: ${hits.join(', ')}`);
});

test('queryD2ProviderCard exposes install hint text', () => {
  const card = queryD2ProviderCard();
  assert.match(card.installHint, /d2|D2|brew install/i);
});
