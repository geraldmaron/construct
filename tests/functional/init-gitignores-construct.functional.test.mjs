/**
 * tests/functional/init-gitignores-construct.functional.test.mjs
 *
 * End-to-end coverage for bead construct-1vv5: `construct init` must add
 * `.construct/` to the project .gitignore so the runtime state tree (observations,
 * sessions, vectors, traces) never lands in a commit. Idempotent — running
 * init twice (or running it on a repo that already ignores `.construct/`) must not
 * double-append.
 *
 * Three cases:
 *   1. no .gitignore exists → file created with `.construct/` entry
 *   2. .gitignore exists without `.construct/` → entry appended once
 *   3. .gitignore already lists `.construct/` → file unchanged (no double-add)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

// lib/paths.mjs resolves the machine-scoped state root (ADR-0066) from
// process.env directly, so every spawned `construct` needs its own sandboxed
// HOME to avoid leaking test projects into the real developer machine's
// ~/.construct/projects/.

const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'init-construct-ignore-home-'));
process.on('exit', () => rmTmpDir(SANDBOX_HOME));

function makeProject(seedGitignore = null) {
  const dir = mkdtempSync(join(tmpdir(), 'init-construct-ignore-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  if (seedGitignore != null) writeFileSync(join(dir, '.gitignore'), seedGitignore);
  return { dir, cleanup: () => rmTmpDir(dir) };
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
      HOME: SANDBOX_HOME,
      CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
    },
  });
}

test('init creates .gitignore with .construct/ when no .gitignore exists', () => {
  const p = makeProject(null);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    assert.match(gi, /^\.construct\/?\s*$/m, `.gitignore must contain .construct/ entry; got:\n${gi}`);
    assert.match(gi, /Construct.*generated.*runtime state|recreated by `construct sync`/i, '.gitignore should explain why generated Construct artifacts are ignored');
  } finally { p.cleanup(); }
});

test('init appends .construct/ to an existing .gitignore that lacks it', () => {
  const seed = 'node_modules/\n.env\n';
  const p = makeProject(seed);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    assert.ok(gi.startsWith(seed), 'pre-existing content must be preserved');
    assert.match(gi, /\.construct\/\s*$/m, `.construct/ must be appended; got:\n${gi}`);
  } finally { p.cleanup(); }
});

test('init does not duplicate .construct/ when the entry already exists', () => {
  const seed = 'node_modules/\n.construct/\n.env\n';
  const p = makeProject(seed);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    const occurrences = (gi.match(/^\.construct\/?$/gm) || []).length;
    assert.equal(occurrences, 1, `.construct/ should appear exactly once; got ${occurrences}:\n${gi}`);
  } finally { p.cleanup(); }
});

test('init recognizes a broader pattern and does not add a redundant .construct/', () => {
  const seed = '**\n!docs/\n!src/\n';
  const p = makeProject(seed);
  try {
    const result = runInit(p.dir);
    assert.equal(result.status, 0, `init failed:\n${result.stderr}`);
    const gi = readFileSync(join(p.dir, '.gitignore'), 'utf8');
    // The original seeded content must still be at the top; bd init may
    // append its own Beads-specific entries below, which is independent of
    // construct init's project-state contract.

    assert.ok(gi.startsWith(seed), `seeded content must be preserved; got:\n${gi}`);
    const constructOccurrences = (gi.match(/^\.construct\/?$/gm) || []).length;
    assert.equal(constructOccurrences, 0, `.construct/ must not be added when ** is present; got ${constructOccurrences} occurrence(s):\n${gi}`);
  } finally { p.cleanup(); }
});
