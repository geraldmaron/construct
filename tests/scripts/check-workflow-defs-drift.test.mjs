/**
 * tests/scripts/check-workflow-defs-drift.test.mjs — exit-code contract for
 * scripts/check-workflow-defs-drift.mjs.
 *
 * Exit 0 = clean, exit 1 = a real drift finding, exit 2 = the check itself
 * failed to run (a crash indistinguishable from drift under Node's default
 * uncaught-exception exit 1, before main() was wrapped in .catch()). The
 * caller in bin/construct only reports "drift detected" on exit 1.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-workflow-defs-drift.mjs');

test('exits 0 on a clean repo with no drift', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(result.status, 0, result.stderr);
});

test('exits 2, not 1, when the check itself cannot run (a missing dependency)', () => {
  // A copy of the script in a bare sandbox (no lib/ at all) reproduces a
  // real crash — main() throws reading SHIM_PATH before it ever reaches the
  // loader import — without touching the repo's actual lib/ files, which
  // other tests import concurrently under node --test.
  //
  // realpathSync: on macOS, mkdtempSync's path (/var/folders/...) and
  // Node's own resolved import.meta.url (/private/var/folders/...) differ
  // by a symlink hop — the script's `import.meta.url === file://argv[1]`
  // entry-point guard would silently never match, so main() never runs.
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'drift-check-crash-')));
  try {
    const scriptsDir = join(sandbox, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const scriptCopy = join(scriptsDir, 'check-workflow-defs-drift.mjs');
    writeFileSync(scriptCopy, readFileSync(SCRIPT, 'utf8'));

    const result = spawnSync(process.execPath, [scriptCopy, '--check'], { encoding: 'utf8', cwd: REPO_ROOT });
    assert.equal(result.status, 2, `expected exit 2 for a crash, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /crashed/);
    assert.doesNotMatch(result.stderr, /drift detected/, 'a crash must never be reported as drift');
  } finally {
    rmTmpDir(sandbox);
  }
});
