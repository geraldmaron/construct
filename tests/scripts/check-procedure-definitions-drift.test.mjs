/**
 * Verifies Procedure-definition drift-check exit-code semantics.
 *
 * Clean state exits 0, catalog drift exits 1, and checker crashes exit 2 so
 * automation never misreports an infrastructure failure as catalog drift.
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
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-procedure-definitions-drift.mjs');

test('exits 0 when embedded definitions match canonical Procedures', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(result.status, 0, result.stderr);
});

test('exits 2 when the checker cannot load its dependencies', () => {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'procedure-drift-check-crash-')));
  try {
    const scriptsDir = join(sandbox, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const scriptCopy = join(scriptsDir, 'check-procedure-definitions-drift.mjs');
    writeFileSync(scriptCopy, readFileSync(SCRIPT, 'utf8'));

    const result = spawnSync(process.execPath, [scriptCopy, '--check'], { encoding: 'utf8', cwd: REPO_ROOT });
    assert.equal(result.status, 2, `expected exit 2 for a crash, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /Procedure definition drift check failed/);
  } finally {
    rmTmpDir(sandbox);
  }
});
