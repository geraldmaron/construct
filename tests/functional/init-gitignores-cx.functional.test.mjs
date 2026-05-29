/**
 * tests/functional/init-gitignores-cx.functional.test.mjs
 *
 * End-to-end coverage for bead construct-1vv5: `construct init` must add
 * `.cx/` to the project .gitignore so the runtime state tree (observations,
 * sessions, vectors, traces) never lands in a commit. Idempotent — running
 * init twice (or running it on a repo that already ignores `.cx/`) must not
 * double-append.
 *
 * Three cases:
 *   1. no .gitignore exists → file created with `.cx/` entry
 *   2. .gitignore exists without `.cx/` → entry appended once
 *   3. .gitignore already lists `.cx/` → file unchanged (no double-add)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeProject(seedGitignore = null) {
  const dir = mkdtempSync(join(tmpdir(), 'init-cxignore-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  if (seedGitignore != null) writeFileSync(join(dir, '.gitignore'), seedGitignore);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runInit(cwd) {
  return spawnSync(process.execPath, [BIN, 'init', '--yes'], {
    cwd,
    encoding: 'utf8',
    timeout: 90_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
    },
  });
}

test('init creates .gitignore with .cx/ when no .gitignore exists', () => {
  const p = makeProject(null);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    assert.match(gi, /\.cx\/\s*$/m, `.gitignore must contain .cx/ entry; got:\n${gi}`);
    assert.match(gi, /Construct runtime state/i, '.gitignore should explain why .cx/ is ignored');
  } finally { p.cleanup(); }
});

test('init appends .cx/ to an existing .gitignore that lacks it', () => {
  const seed = 'node_modules/\n.env\n';
  const p = makeProject(seed);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    assert.ok(gi.startsWith(seed), 'pre-existing content must be preserved');
    assert.match(gi, /\.cx\/\s*$/m, `.cx/ must be appended; got:\n${gi}`);
  } finally { p.cleanup(); }
});

test('init does NOT double-add .cx/ when the entry already exists (idempotent)', () => {
  const seed = 'node_modules/\n.cx/\n.env\n';
  const p = makeProject(seed);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    const occurrences = (gi.match(/^\.cx\/?$/gm) || []).length;
    assert.equal(occurrences, 1, `.cx/ should appear exactly once; got ${occurrences}:\n${gi}`);
  } finally { p.cleanup(); }
});

test('init recognizes a broader pattern (e.g. `**`) and does not add a redundant .cx/', () => {
  const seed = '**\n!docs/\n!src/\n';
  const p = makeProject(seed);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    // The original seeded content must still be at the top; bd init may
    // append its own Beads-specific entries below, which is independent of
    // construct init's .cx/ contract.

    assert.ok(gi.startsWith(seed), `seeded content must be preserved; got:\n${gi}`);
    const cxOccurrences = (gi.match(/^\.cx\/?$/gm) || []).length;
    assert.equal(cxOccurrences, 0, `.cx/ must NOT be added when ** is present; got ${cxOccurrences} occurrence(s):\n${gi}`);
  } finally { p.cleanup(); }
});
