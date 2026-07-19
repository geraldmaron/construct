/**
 * tests/init-intake-defaults.test.mjs — non-interactive `construct init`
 * MUST NOT auto-include project artifact directories as inbox watch paths.
 *
 * Regression coverage for the bug where init scanned the project for known
 * preset directories (src, lib, packages, apps, services, docs, tests,
 * spec, infra, config, scripts, tools) and silently registered every one
 * that existed as a parentDir for the inbox watcher. This turned every code
 * commit, doc edit, and test file into a synthetic "intake signal" — the
 * R&D queue filled with false positives that drowned out real signals.
 *
 * Correct behavior: additionalDirs is empty by default. The single canonical
 * `inbox/` zone is always watched (ADR-0045 §C) and the project-root `inbox/`
 * is scaffolded; there is no zones object. Extra dirs are opt-in only via
 * `construct intake config set --add-dir=<path>`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from './helpers/cleanup.mjs';
import { parseJsonc } from '../lib/jsonc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binPath = path.join(root, 'bin', 'construct');

let tmpDir;
let homeDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-init-defaults-'));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-init-defaults-home-'));
});

afterEach(() => {
  rmTmpDir(tmpDir);
  rmTmpDir(homeDir);
});

function seedProjectDirs(...names) {
  // init refuses to run outside a git repo; treat the tmp project as one.
  spawnSync('git', ['init', '-q'], { cwd: tmpDir });
  for (const name of names) {
    fs.mkdirSync(path.join(tmpDir, name), { recursive: true });
  }
}

function runInit(extraEnv = {}) {
  return spawnSync(process.execPath, [binPath, 'init', '--yes'], {
    cwd: tmpDir,
    env: {
      ...process.env,
      HOME: homeDir,
      CONSTRUCT_HOME_OVERRIDE: homeDir,
      ...extraEnv,
      CONSTRUCT_AUTO_EMBED: '0',
      CONSTRUCT_DATA_DIR: tmpDir,
    },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function readIntakePolicy() {
  const cfgPath = path.join(tmpDir, 'construct.config.json');
  if (!fs.existsSync(cfgPath)) return null;
  const raw = parseJsonc(fs.readFileSync(cfgPath, 'utf8'));
  return raw.intakePolicy ?? null;
}

describe('construct init --yes intake defaults', () => {
  it('writes additionalDirs as an empty list when the project contains src/ docs/ tests/', () => {
    seedProjectDirs('src', 'docs', 'tests');
    const result = runInit();
    assert.equal(result.status, 0, `init failed: ${result.stderr}`);
    const cfg = readIntakePolicy();
    assert.ok(cfg, 'intakePolicy was not written to construct.config.json');
    assert.deepEqual(
      cfg.additionalDirs,
      [],
      `additionalDirs MUST be empty by default. Saw: ${JSON.stringify(cfg.additionalDirs)}`,
    );
  });

  it('writes the single-zone policy (no zones object) and scaffolds inbox/', () => {
    seedProjectDirs('src');
    const result = runInit();
    assert.equal(result.status, 0, `init failed: ${result.stderr}`);
    const cfg = readIntakePolicy();
    assert.equal('zones' in cfg, false, 'no zones object — inbox/ is unconditional');
    assert.ok(fs.existsSync(path.join(tmpDir, 'inbox')), 'inbox/ is scaffolded at the project root');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.construct', 'inbox')), '.construct/inbox/ is never scaffolded');
  });

  it('writes no additionalDirs even when many preset directories exist', () => {
    seedProjectDirs('src', 'lib', 'packages', 'apps', 'services', 'docs', 'tests', 'spec', 'infra', 'config', 'scripts', 'tools');
    const result = runInit();
    assert.equal(result.status, 0, `init failed: ${result.stderr}`);
    const cfg = readIntakePolicy();
    assert.deepEqual(
      cfg.additionalDirs,
      [],
      'No preset directory should be auto-enabled. additionalDirs is for explicit user opt-in only.',
    );
  });
});
