/**
 * tests/functional/docs-site-check.functional.test.mjs — generated-docs gate shape.
 *
 * The generated reference site (docs:site, registry:generate-docs) is retired:
 * the CLI catalog is the reference surface and docs/README.md carries the only
 * generated region (AUTO:catalog-sync). This pins both halves: the retired
 * commands answer with a retirement hint instead of regenerating a doc tree,
 * and the surviving docs:sync --check gate reports the region current.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

// lib/paths.mjs resolves the machine-scoped state root from process.env, so the
// spawned construct needs a sandboxed HOME to avoid registering this repo under
// the real developer machine's ~/.construct/projects/.

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-check-home-'));
process.on('exit', () => rmTmpDir(SANDBOX_HOME));

function runConstruct(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
  });
}

test('docs:site is retired with a hint, not a generator', () => {
  const result = runConstruct(['docs:site', '--check']);
  assert.match(result.stdout + result.stderr, /retired with the documentation system/);
  assert.ok(!fs.existsSync(join(REPO_ROOT, 'docs', 'guides', 'reference')), 'retired command must not recreate docs/guides/reference/');
});

test('registry:generate-docs is retired with a hint, not a generator', () => {
  const result = runConstruct(['registry:generate-docs', '--check']);
  assert.match(result.stdout + result.stderr, /retired with the documentation system/);
});

test('release gate: docs:sync --check reports the catalog-sync region current', () => {
  const result = spawnSync('node', [join(REPO_ROOT, 'scripts', 'docs-sync.mjs'), '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(result.status, 0, `docs:sync --check exited ${result.status}; stderr: ${result.stderr}`);
});
