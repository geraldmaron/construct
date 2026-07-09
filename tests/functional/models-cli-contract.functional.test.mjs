/**
 * tests/functional/models-cli-contract.functional.test.mjs
 *
 * The `construct models` help contract must match runtime. Every advertised
 * subcommand executes its real handler instead of collapsing to a plain
 * listing, mutations write to and report the active XDG config path (never the
 * legacy ~/.construct path), and subcommands removed from help error rather
 * than silently list. Spawns the real binary in an isolated HOME/XDG so the
 * assertions cover the published dispatch path, not an in-process import.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-models-contract-'));
  tmpDirs.push(root);
  const home = path.join(root, 'home');
  const xdgConfig = path.join(root, 'xdg');
  const xdgState = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(xdgConfig, 'construct'), { recursive: true });
  fs.mkdirSync(xdgState, { recursive: true });
  return {
    home,
    xdgConfig,
    configPath: path.join(xdgConfig, 'construct', 'config.env'),
    legacyPath: path.join(home, '.construct', 'config.env'),
    env(extra = {}) {
      return {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_STATE_HOME: xdgState,
        CONSTRUCT_DOCTOR_ROOT: path.join(xdgState, 'construct'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
        CI: 'true',
        ...extra,
      };
    },
  };
}

function runModels(sandbox, args) {
  return spawnSync('node', [BIN, 'models', ...args], {
    cwd: sandbox.home,
    encoding: 'utf8',
    timeout: 90_000,
    env: sandbox.env(),
  });
}

after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

test('models --help advertises only backed subcommands, never usage/cost', () => {
  const sb = freshSandbox();
  const res = runModels(sb, ['--help']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /construct models <list\|set\|free\|reset\|resolve\|policy\|explain>/);
  assert.doesNotMatch(res.stdout, /Show token usage per tier/);
  assert.doesNotMatch(res.stdout, /Show cost breakdown/);
});

test('models set --tier --model writes to the XDG config and reports that path', () => {
  const sb = freshSandbox();
  const res = runModels(sb, ['set', '--tier=standard', '--model=foo/bar']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Set standard -> foo\/bar/);
  assert.ok(res.stdout.includes(sb.configPath), 'must report the resolved XDG path');
  assert.doesNotMatch(res.stdout, /\.construct\/config\.env/);
  assert.match(fs.readFileSync(sb.configPath, 'utf8'), /CX_MODEL_STANDARD=foo\/bar/);
  assert.equal(fs.existsSync(sb.legacyPath), false, 'must never write the legacy path');
});

test('models reset clears CX_MODEL_* from the XDG config, preserving other keys', () => {
  const sb = freshSandbox();
  fs.writeFileSync(sb.configPath, 'CX_MODEL_FAST=foo/fast\nOTHER=keep\n');
  const res = runModels(sb, ['reset']);
  assert.equal(res.status, 0, res.stderr);
  const written = fs.readFileSync(sb.configPath, 'utf8');
  assert.doesNotMatch(written, /CX_MODEL_FAST/);
  assert.match(written, /OTHER=keep/);
});

test('models list executes without ERR_MODULE_NOT_FOUND', () => {
  const sb = freshSandbox();
  const res = runModels(sb, ['list']);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.match(res.stdout, /Visible models/);
});

test('subcommands removed from help error instead of silently listing', () => {
  for (const sub of ['usage', 'cost', 'bogus']) {
    const sb = freshSandbox();
    const res = runModels(sb, [sub]);
    assert.equal(res.status, 1, `${sub} should exit 1, got ${res.status}`);
    assert.match(res.stderr, /Unknown models subcommand/);
    assert.doesNotMatch(res.stdout, /Current model assignments/);
  }
});

test('legacy flag form still mutates but warns it is deprecated', () => {
  const sb = freshSandbox();
  const res = runModels(sb, ['--tier=fast', '--set=baz/qux']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Set fast -> baz\/qux/);
  assert.match(res.stderr, /deprecated/i);
  assert.match(fs.readFileSync(sb.configPath, 'utf8'), /CX_MODEL_FAST=baz\/qux/);
});
