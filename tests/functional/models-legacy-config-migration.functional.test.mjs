/**
 * tests/functional/models-legacy-config-migration.functional.test.mjs
 *
 * An install upgraded across the XDG config move must not lose its model tier
 * selection. When CX_MODEL_* values are stranded in the legacy
 * ~/.construct/config.env, `construct doctor` mirrors them into the active XDG
 * config and reports the tiers as configured — no manual copy required. Spawns
 * the real binary in an isolated HOME/XDG and asserts on the durable artifact.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-legacy-mig-fn-'));
  tmpDirs.push(root);
  const home = path.join(root, 'home');
  const xdgConfig = path.join(root, 'xdg');
  const xdgState = path.join(root, 'state');
  fs.mkdirSync(path.join(home, '.construct'), { recursive: true });
  fs.mkdirSync(path.join(xdgConfig, 'construct'), { recursive: true });
  fs.mkdirSync(xdgState, { recursive: true });
  return {
    home,
    legacyPath: path.join(home, '.construct', 'config.env'),
    configPath: path.join(xdgConfig, 'construct', 'config.env'),
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_STATE_HOME: xdgState,
      CONSTRUCT_DOCTOR_ROOT: path.join(xdgState, 'construct'),
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      CI: 'true',
    },
  };
}

function runDoctor(sandbox) {
  return spawnSync('node', [BIN, 'doctor'], {
    cwd: sandbox.home,
    encoding: 'utf8',
    timeout: 120_000,
    env: sandbox.env,
  });
}

after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

test('doctor migrates legacy-only model tiers into the XDG config', () => {
  const sb = freshSandbox();
  fs.writeFileSync(sb.legacyPath,
    'CX_MODEL_REASONING=x/reason\nCX_MODEL_STANDARD=x/std\nCX_MODEL_FAST=x/fast\n');

  const res = runDoctor(sb);

  assert.match(res.stdout, /migrated CX_MODEL/);
  assert.match(res.stdout, /Models — all tiers configured/);
  const xdg = fs.readFileSync(sb.configPath, 'utf8');
  assert.match(xdg, /CX_MODEL_REASONING=x\/reason/);
  assert.match(xdg, /CX_MODEL_STANDARD=x\/std/);
  assert.match(xdg, /CX_MODEL_FAST=x\/fast/);
});

test('doctor migration does not clobber a tier the XDG config already sets', () => {
  const sb = freshSandbox();
  fs.writeFileSync(sb.legacyPath, 'CX_MODEL_STANDARD=legacy/std\n');
  fs.writeFileSync(sb.configPath, 'CX_MODEL_STANDARD=xdg/keep\n');

  runDoctor(sb);

  assert.match(fs.readFileSync(sb.configPath, 'utf8'), /CX_MODEL_STANDARD=xdg\/keep/);
});
