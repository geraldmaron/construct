/**
 * tests/functional/spawn-env-hermeticity.functional.test.mjs
 *
 * Proves sterileSpawnEnv() (tests/helpers/sterile-env.mjs)
 * builds spawn/process envs from an explicit allowlist, not `{ ...process.env }`,
 * so a poisoned parent shell (CONSTRUCT_MODEL_STANDARD, OPENROUTER_API_KEY, WEB_SEARCH_URL,
 * CONSTRUCT_USER_ENV_PATH) can never reach a hermetic child, HOME is pinned away from the
 * real developer home, and a hermetic secret-resolver call never shells out to a
 * real `op` even when a logging `op` stub sits first on PATH.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sterileSpawnEnv, createOpStub } from '../helpers/sterile-env.mjs';
import { resolveSecret, __clearSecretCache } from '../../lib/providers/secret-resolver.mjs';
import { __resetOpLocateCache } from '../../lib/providers/op-locate.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const POISON = {
  CONSTRUCT_MODEL_STANDARD: 'poison',
  CONSTRUCT_MODEL_REASONING: 'poison',
  CONSTRUCT_MODEL_FAST: 'poison',
  OPENROUTER_API_KEY: 'sk-poison',
  ANTHROPIC_API_KEY: 'sk-ant-poison',
  WEB_SEARCH_URL: 'http://poison.invalid',
  CONSTRUCT_USER_ENV_PATH: '/poison/path',
  CONSTRUCT_PROVIDER_TIMEOUT_MS: '999999',
};

function withPoisonedParentEnv(t) {
  const saved = {};
  for (const key of Object.keys(POISON)) {
    saved[key] = process.env[key];
    process.env[key] = POISON[key];
  }
  t.after(() => {
    for (const key of Object.keys(POISON)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('sterileSpawnEnv builds a spawn env from an allowlist: a poisoned parent shell never leaks in', async (t) => {
  withPoisonedParentEnv(t);

  const dump = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-hermeticity-'));
  const script = path.join(dump, 'dump-env.mjs');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.env));');
  t.after(() => rmTmpDir(dump));

  const env = sterileSpawnEnv();
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, `child failed: ${result.stderr}`);
  const childEnv = JSON.parse(result.stdout);

  for (const key of Object.keys(POISON)) {
    assert.equal(childEnv[key], undefined, `${key} leaked into a sterileSpawnEnv() child`);
  }
  assert.ok(childEnv.PATH, 'PATH must still pass through so subprocess binaries resolve');
  assert.notEqual(childEnv.HOME, process.env.HOME, 'HOME must be pinned to a fresh mkdtemp root, not the real developer HOME');
  assert.ok(childEnv.CONSTRUCT_HOME_OVERRIDE, 'CONSTRUCT_HOME_OVERRIDE must be set alongside HOME');
});

test('sterileSpawnEnv overrides win over the allowlist defaults without reopening it', async (t) => {
  withPoisonedParentEnv(t);

  const env = sterileSpawnEnv({ CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6' });
  assert.equal(env.CONSTRUCT_MODEL_STANDARD, 'anthropic/claude-sonnet-4-6', 'an explicit override is honored');
  assert.equal(env.OPENROUTER_API_KEY, undefined, 'a var not named in overrides stays excluded even when the parent is poisoned');
});

test('a hermetic secret-resolver call never shells out to a real op, even with a logging op stub first on PATH', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-hermeticity-op-'));
  t.after(() => rmTmpDir(root));

  const { binDir, logPath } = createOpStub(root);
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${savedPath}`;
  process.env.OP_READ_LOG = logPath;
  __resetOpLocateCache();
  __clearSecretCache();
  t.after(() => {
    process.env.PATH = savedPath;
    delete process.env.OP_READ_LOG;
    __resetOpLocateCache();
    __clearSecretCache();
  });

  const env = sterileSpawnEnv({ ANTHROPIC_API_KEY: '' });
  const value = resolveSecret('ANTHROPIC_API_KEY', { env, allowAmbient: false });

  assert.equal(value, null, 'a blank direct value with ambient discovery off resolves to nothing');
  const log = fs.readFileSync(logPath, 'utf8');
  assert.equal(log, '', 'a hermetic (allowAmbient:false) resolution must never invoke op read');
});
