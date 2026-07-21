/**
 * tests/functional/install-first-run-checklist.functional.test.mjs
 *
 * Smoke: install dry-run and postinstall surfaces emit the shared first-run checklist.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import {
  FIRST_TASK_GUIDE_DOC,
  INSTALL_GUIDE_DOC,
} from '../../lib/install/first-run-checklist.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');
const POSTINSTALL = path.resolve(__dirname, '..', '..', 'bin', 'construct-postinstall.mjs');

const tmpDirs = [];
function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-install-checklist-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

test('construct install --footprint=user --dry-run prints the numbered checklist', () => {
  const home = freshHome();
  const res = spawnSync('node', [BIN, 'install', '--footprint=user', '--dry-run', '--yes'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home },
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /Next steps:/);
  assert.match(res.stdout, /construct init/);
  assert.match(res.stdout, /construct doctor/);
  assert.match(res.stdout, /construct sync/);
  assert.match(res.stdout, new RegExp(INSTALL_GUIDE_DOC.replace('.', '\\.')));
  assert.match(res.stdout, new RegExp(FIRST_TASK_GUIDE_DOC.replace('.', '\\.')));
});

test('global postinstall prints the numbered checklist', () => {
  const home = freshHome();
  const res = spawnSync('node', [POSTINSTALL], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: home,
      npm_config_global: 'true',
      INIT_CWD: home,
    },
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /Next steps:/);
  assert.match(res.stdout, /construct install --footprint=user/);
  assert.match(res.stdout, /construct doctor/);
  assert.match(res.stdout, new RegExp(INSTALL_GUIDE_DOC.replace('.', '\\.')));
});
