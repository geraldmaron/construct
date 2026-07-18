/**
 * tests/profile-rebrand.test.mjs — exercises the `getRebrand` lookup helper
 * and verifies `construct intake list` honors the active scope's rebrand
 * labels end-to-end.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { getRebrand, DEFAULT_REBRAND } from '../lib/scopes/rebrand.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CLI_BIN = path.join(REPO_ROOT, 'bin', 'construct');

const tmpDirs = [];
function mkTmp(prefix = 'cx-rebrand-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

after(() => {
  for (const d of tmpDirs) {
    rmTmpDir(d);
  }
});

// The spawned `construct intake list` below resolves the machine-scoped state
// root (ADR-0066) from process.env.CX_HOME_OVERRIDE / HOME in its own process,
// so it must be pinned to a throwaway home or it leaks a project-key directory
// into the real developer machine's ~/.construct/projects/.
const HOME_DIR = mkTmp('cx-rebrand-home-');

describe('getRebrand', () => {
  it('returns defaults when rootDir is missing or unreadable', () => {
    assert.deepEqual(getRebrand(null), { ...DEFAULT_REBRAND });
    assert.deepEqual(getRebrand(''), { ...DEFAULT_REBRAND });
    assert.deepEqual(getRebrand(undefined), { ...DEFAULT_REBRAND });
  });

  it('honors operations profile rebrand labels', () => {
    const root = mkTmp();
    // Selecting the curated operations scope via construct.config.json
    // means resolveActiveScope reads specialists/org/worker-profiles/operations.json from the repo.
    fs.writeFileSync(
      path.join(root, 'construct.config.json'),
      JSON.stringify({ scope: 'operations' }, null, 2),
    );
    const rb = getRebrand(root);
    assert.equal(rb.intakeQueueLabel, 'Request queue');
    assert.equal(rb.signalNoun, 'request');
  });

  it('returns rnd profile rebrand when no override is configured', () => {
    const root = mkTmp();
    const rb = getRebrand(root);
    // Default rnd scope carries "R&D intake queue" / "signal"
    assert.match(rb.intakeQueueLabel, /intake|Intake/);
    assert.equal(rb.signalNoun, 'signal');
  });

  it('falls back to defaults when scope.json is malformed', () => {
    const root = mkTmp();
    fs.mkdirSync(path.join(root, '.construct'), { recursive: true });
    fs.writeFileSync(path.join(root, '.construct', 'scope.json'), '{ this is not json');
    const rb = getRebrand(root);
    // Malformed custom scope is ignored; we land on the rnd fallback,
    // which still produces non-empty strings.
    assert.ok(typeof rb.intakeQueueLabel === 'string' && rb.intakeQueueLabel.length > 0);
    assert.ok(typeof rb.signalNoun === 'string' && rb.signalNoun.length > 0);
  });
});

describe('construct intake list (rebrand integration)', () => {
  it('uses operations scope labels in stdout', () => {
    const root = mkTmp();
    fs.writeFileSync(
      path.join(root, 'construct.config.json'),
      JSON.stringify({ scope: 'operations' }, null, 2),
    );

    const result = spawnSync(process.execPath, [CLI_BIN, 'intake', 'list'], {
      cwd: root,
      env: { ...process.env, CX_DATA_DIR: root, HOME: HOME_DIR, CX_HOME_OVERRIDE: HOME_DIR },
      encoding: 'utf8',
      timeout: 15_000,
    });

    // Assert only on the rebrand-labelled stdout; subcommand exit code is
    // not load-bearing for the label check.
    const out = `${result.stdout || ''}${result.stderr || ''}`;
    assert.ok(
      out.includes('Request queue') || out.includes('No pending requests'),
      `expected operations rebrand label in output, got: ${out.slice(0, 400)}`,
    );
  });
});
