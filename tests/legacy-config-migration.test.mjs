/**
 * tests/legacy-config-migration.test.mjs
 *
 * Forward-migration of model tier overrides from the pre-XDG legacy config
 * into the active XDG config. Locks in three invariants: stranded CX_MODEL_
 * and CONSTRUCT_MODEL_ keys are mirrored forward; an existing XDG value is
 * never clobbered; and non-model keys such as API secrets are left behind.
 * The migration is idempotent so repeated install/doctor runs are safe.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { migrateLegacyModelConfig, legacyConfigPath } from '../lib/config/legacy-config-migration.mjs';
import { parseEnvFile } from '../lib/env-config.mjs';

const tmpDirs = [];
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-legacy-mig-'));
  tmpDirs.push(root);
  const home = path.join(root, 'home');
  const xdg = path.join(root, 'xdg');
  fs.mkdirSync(path.join(home, '.construct'), { recursive: true });
  fs.mkdirSync(path.join(xdg, 'construct'), { recursive: true });
  return { home, env: { XDG_CONFIG_HOME: xdg }, xdgConfig: path.join(xdg, 'construct', 'config.env') };
}

after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

test('mirrors stranded model tier keys forward and ignores secrets', () => {
  const sb = sandbox();
  fs.writeFileSync(legacyConfigPath(sb.home),
    'CX_MODEL_REASONING=legacy/reason\nCX_MODEL_FAST=legacy/fast\nOPENROUTER_API_KEY=sk-secret\n');

  const result = migrateLegacyModelConfig({ homeDir: sb.home, env: sb.env });

  assert.equal(result.performed, true);
  assert.deepEqual(result.migrated, { CX_MODEL_REASONING: 'legacy/reason', CX_MODEL_FAST: 'legacy/fast' });
  const xdg = parseEnvFile(sb.xdgConfig);
  assert.equal(xdg.CX_MODEL_REASONING, 'legacy/reason');
  assert.equal(xdg.CX_MODEL_FAST, 'legacy/fast');
  assert.equal(xdg.OPENROUTER_API_KEY, undefined, 'secrets must not migrate');
});

test('never clobbers a value the XDG config already defines', () => {
  const sb = sandbox();
  fs.writeFileSync(legacyConfigPath(sb.home), 'CX_MODEL_STANDARD=legacy/std\n');
  fs.writeFileSync(sb.xdgConfig, 'CX_MODEL_STANDARD=xdg/keep\n');

  const result = migrateLegacyModelConfig({ homeDir: sb.home, env: sb.env });

  assert.equal(result.performed, false);
  assert.equal(parseEnvFile(sb.xdgConfig).CX_MODEL_STANDARD, 'xdg/keep');
});

test('also migrates CONSTRUCT_MODEL_ aliases', () => {
  const sb = sandbox();
  fs.writeFileSync(legacyConfigPath(sb.home), 'CONSTRUCT_MODEL_STANDARD=legacy/alias\n');

  const result = migrateLegacyModelConfig({ homeDir: sb.home, env: sb.env });

  assert.equal(result.performed, true);
  assert.equal(parseEnvFile(sb.xdgConfig).CONSTRUCT_MODEL_STANDARD, 'legacy/alias');
});

test('is idempotent — a second run is a no-op', () => {
  const sb = sandbox();
  fs.writeFileSync(legacyConfigPath(sb.home), 'CX_MODEL_FAST=legacy/fast\n');

  assert.equal(migrateLegacyModelConfig({ homeDir: sb.home, env: sb.env }).performed, true);
  assert.equal(migrateLegacyModelConfig({ homeDir: sb.home, env: sb.env }).performed, false);
});

test('no legacy file is a clean no-op', () => {
  const sb = sandbox();
  const result = migrateLegacyModelConfig({ homeDir: sb.home, env: sb.env });
  assert.equal(result.performed, false);
  assert.deepEqual(result.migrated, {});
});
