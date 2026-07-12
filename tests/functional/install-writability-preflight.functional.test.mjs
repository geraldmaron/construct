/**
 * tests/functional/install-writability-preflight.functional.test.mjs
 *
 * A root-owned leftover from an earlier sudo'd install (or any unwritable
 * host directory) must fail `construct install` before any real mutation,
 * with a diagnostic naming the exact path — not an EACCES crash partway
 * through the setup sequence, leaving the machine neither old nor new.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { runInstallPreflight, formatPreflightFailure } from '../../lib/install/preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-install-preflight-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.chmodSync(path.join(dir, '.codex'), 0o700); } catch { /* may not exist */ }
    try { rmTmpDir(dir); } catch { /* best effort */ }
  }
});

function runInstall(args, env) {
  return spawnSync('node', [BIN, 'install', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

test('a successful preflight leaves no new empty host directories behind', () => {
  const home = freshHome();
  const result = runInstallPreflight(home);
  assert.equal(result.ok, true, JSON.stringify(result.results));
  for (const { dir } of result.results) {
    assert.equal(fs.existsSync(dir), false, `preflight must not leave behind ${dir} on success`);
  }
});

test('an unwritable host directory fails the preflight with an actionable EACCES message', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.chmodSync(path.join(home, '.codex'), 0o500);

  const result = runInstallPreflight(home);
  assert.equal(result.ok, false);
  const codex = result.results.find((r) => r.label === 'Codex');
  assert.equal(codex.writable, false);
  assert.equal(codex.reason, 'EACCES');

  const message = formatPreflightFailure(result);
  assert.match(message, /Codex.*\.codex.*EACCES/s);
  assert.match(message, /sudo chown/);
});

test('construct install fails before any mutation when a host directory is unwritable', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.chmodSync(path.join(home, '.codex'), 0o500);

  const res = runInstall(['--yes', '--footprint=user'], { HOME: home });
  assert.notEqual(res.status, 0, `expected a non-zero exit — stdout: ${res.stdout}`);
  const combined = `${res.stdout}${res.stderr}`;
  assert.match(combined, /Codex/);
  assert.match(combined, /EACCES/);
  assert.match(combined, /sudo chown/);

  // No host-managed state was written — the preflight ran before runSetup's
  // first mutation. cmdInstall's own op-log entry (stateDir/*.log) and the
  // unrelated post-command maintenance stamp are expected bookkeeping, not
  // part of what the preflight protects.
  assert.equal(fs.existsSync(path.join(home, '.config', 'construct', 'config.env')), false, 'XDG user config must not be written');
  assert.equal(fs.existsSync(path.join(home, '.config', 'construct', 'lib')), false, 'lib symlink must not be created');
  assert.equal(fs.existsSync(path.join(home, '.claude')), false, 'Claude directory must not be created');
  assert.equal(fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.json')), false, 'OpenCode config must not be written');
});
