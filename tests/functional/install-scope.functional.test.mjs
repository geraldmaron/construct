/**
 * tests/functional/install-scope.functional.test.mjs
 *
 * ADR-0029: `construct install` is scoped. The default scope is `project`,
 * which writes nothing and prints guidance — `~/.construct/config.env` and
 * `~/.claude/*` must remain untouched. Invalid scopes fail with exit 1 before
 * any machine setup. The `--scope=user` and `--scope=both` paths run the
 * machine-state body (covered by tests/functional/install-parity and the
 * setup-prompts suite — not duplicated here).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { configDir, stateDir } from '../../lib/config/xdg.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-install-scope-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

function runInstall(args, env) {
  return spawnSync('node', [BIN, 'install', ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

test('default scope is project: prints guidance, writes nothing', () => {
  const home = freshHome();
  const res = runInstall([], { HOME: home });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status} — stderr: ${res.stderr}`);
  assert.match(res.stdout, /scope: project/i);
  assert.match(res.stdout, /construct install --scope=user/);
  assert.equal(fs.existsSync(path.join(configDir(home), 'config.env')), false, 'project scope must not write config.env');
  assert.equal(fs.existsSync(path.join(configDir(home), 'lib')), false, 'project scope must not create the lib symlink');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'settings.json')), false, 'project scope must not touch ~/.claude/');
});

test('--scope=project is explicit no-op for user-scope state', () => {
  const home = freshHome();
  const res = runInstall(['--scope=project'], { HOME: home });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /scope: project/i);
  assert.equal(fs.existsSync(path.join(configDir(home), 'config.env')), false, 'must not write user-scope config.env');
  assert.equal(fs.existsSync(path.join(configDir(home), 'lib')), false, 'must not create lib symlink');
  assert.equal(fs.existsSync(path.join(home, '.construct', 'services')), false, 'must not stage Postgres compose');
  assert.equal(fs.existsSync(path.join(home, '.claude')), false, 'must not touch ~/.claude/');
});

test('--scope=bogus fails fast with exit 1 before any setup', () => {
  const home = freshHome();
  const res = runInstall(['--scope=bogus'], { HOME: home });
  assert.equal(res.status, 1, `expected exit 1, got ${res.status} — stderr: ${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /--scope=bogus/);
  assert.equal(fs.existsSync(path.join(configDir(home), 'config.env')), false, 'must not write config before validating scope');
});

test('--scope (no value) fails fast with exit 1', () => {
  const home = freshHome();
  const res = runInstall(['--scope'], { HOME: home });
  assert.equal(res.status, 1, `expected exit 1, got ${res.status} — stderr: ${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /--scope/);
  assert.equal(fs.existsSync(path.join(configDir(home), 'config.env')), false);
});

test('--scope=user --dry-run previews the plan and writes nothing', () => {
  const home = freshHome();
  const res = runInstall(['--scope=user', '--dry-run', '--yes'], { HOME: home });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status} — stderr: ${res.stderr}`);
  assert.match(res.stdout, /dry-run/i);
  assert.match(res.stdout, /No files were written/i);
  assert.equal(fs.existsSync(path.join(configDir(home), 'config.env')), false, 'dry-run must not write config.env');
  assert.equal(fs.existsSync(path.join(configDir(home), 'lib')), false, 'dry-run must not create the lib symlink');
  assert.equal(fs.existsSync(path.join(stateDir(home), 'workspace')), false, 'dry-run must not scaffold the workspace');
  assert.equal(fs.existsSync(path.join(stateDir(home), 'vector')), false, 'dry-run must not create the vector store dir');
  assert.equal(fs.existsSync(path.join(home, '.claude')), false, 'dry-run must not touch ~/.claude/');
  assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'dev.construct.pressure-release.plist')), false, 'dry-run must not register the LaunchAgent');
});

test('--help still works and mentions --scope', () => {
  const home = freshHome();
  const res = runInstall(['--help'], { HOME: home });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--scope=<s>/);
  assert.match(res.stdout, /project\|user\|both/);
});
