/**
 * tests/functional/init-respects-existing-structure.functional.test.mjs
 *
 * End-to-end coverage for issue #97 — `construct init` must defer to a
 * project's existing content structure instead of scaffolding parallel
 * docs/inbox/templates trees. Spawns the real bin against three fixtures
 * created in tmpdirs, each one prepared and torn down per test:
 *
 *   1) preexisting layout — init must skip docs/meetings/, docs/memos/, the
 *      project .cx/inbox/, and per-lane templates/ that are already covered
 *      by internal/, data/, and root templates/.
 *   2) preexisting layout + --force — init must scaffold the full default
 *      tree anyway (power-user escape hatch).
 *   3) clean project — init's existing behavior is unchanged.
 *
 * Each case spawns the real CLI, asserts on the filesystem aftermath, and
 * inspects stdout for the "deferred to existing project structure" notices.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeFixture(extraSetup) {
  const dir = mkdtempSync(join(tmpdir(), 'init-existing-'));
  // `construct init` requires the target to be a git repository — the
  // tracker hooks wire into .git/hooks. Initialize one quietly.
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  if (extraSetup) extraSetup(dir);
  return {
    dir,
    write(rel, content) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    cleanup() { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); },
  };
}

function runInit(cwd, extraArgs = []) {
  // `--quiet` is intentionally NOT passed so the end-of-init "Deferred to
  // existing project structure" block surfaces in stdout for the per-test
  // assertions below.
  return spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', ...extraArgs],
    {
      cwd,
      encoding: 'utf8',
      timeout: 90_000,
      env: {
        ...process.env,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
      },
    },
  );
}

function seedPreexistingProject(dir) {
  const w = (rel, content) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  w('internal/meetings/2026-05-01-standup.md', '# Standup\nNotes from the team.\n');
  w('internal/meetings/2026-05-08-retro.md', '# Retro\nWhat we learned.\n');
  w('internal/memos/q2-strategy.md', '# Q2 Strategy\nDirection for the quarter.\n');
  w('data/customers/notes/raw/.gitkeep', '');
  w('ingest', '#!/bin/sh\necho ingesting raw notes\n');
  w('templates/prd.md', '# PRD Template\n\n## Problem\n\n## Solution\n');
  w('templates/rfc.md', '# RFC Template\n\n## Proposal\n\n## Decision\n');
  w('templates/README.md', '# Templates\nProject-wide templates live here.\n');
}

test('issue #97: init defers to existing internal/meetings/, internal/memos/, custom intake, root templates', () => {
  const f = makeFixture(seedPreexistingProject);
  try {
    const result = runInit(f.dir, ['--with-all-docs']);
    assert.equal(result.status, 0, `init exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    assert.equal(
      existsSync(join(f.dir, 'docs', 'meetings')),
      false,
      'docs/meetings/ must NOT be scaffolded — internal/meetings/ already exists',
    );
    assert.equal(
      existsSync(join(f.dir, 'docs', 'memos')),
      false,
      'docs/memos/ must NOT be scaffolded — internal/memos/ already exists',
    );
    assert.equal(
      existsSync(join(f.dir, '.cx', 'inbox')),
      false,
      '.cx/inbox/ must NOT be scaffolded — ./ingest custom script detected',
    );

    const intakeConfigPath = join(f.dir, '.cx', 'intake-config.json');
    assert.equal(existsSync(intakeConfigPath), true, '.cx/intake-config.json must still be written');
    const intakeConfig = JSON.parse(readFileSync(intakeConfigPath, 'utf8'));
    assert.equal(
      intakeConfig.includeProjectInbox,
      false,
      'includeProjectInbox must default to false when custom intake detected',
    );

    const combinedOutput = result.stdout + result.stderr;
    assert.match(
      combinedOutput,
      /skipping docs\/meetings\/ — existing internal\/meetings\//,
      'expected init to log meetings skip pointing at internal/meetings/',
    );
    assert.match(
      combinedOutput,
      /skipping \.cx\/inbox\/ — custom intake script \.\/ingest/,
      'expected init to log inbox skip pointing at ./ingest',
    );
    assert.match(
      combinedOutput,
      /Deferred to existing project structure/,
      'expected end-of-init deferral summary',
    );
  } finally { f.cleanup(); }
});

test('issue #97: --force scaffolds the full default tree even when project layout already exists', () => {
  const f = makeFixture(seedPreexistingProject);
  try {
    const result = runInit(f.dir, ['--with-all-docs', '--force']);
    assert.equal(result.status, 0, `init --force exited ${result.status}\nstderr:\n${result.stderr}`);

    assert.equal(
      existsSync(join(f.dir, 'docs', 'meetings')),
      true,
      '--force must scaffold docs/meetings/ even when internal/meetings/ exists',
    );
    assert.equal(
      existsSync(join(f.dir, '.cx', 'inbox')),
      true,
      '--force must scaffold .cx/inbox/ even when ./ingest exists',
    );

    const intakeConfig = JSON.parse(readFileSync(join(f.dir, '.cx', 'intake-config.json'), 'utf8'));
    assert.notEqual(
      intakeConfig.includeProjectInbox,
      false,
      '--force must not flip includeProjectInbox to false',
    );

    const combinedOutput = result.stdout + result.stderr;
    assert.doesNotMatch(
      combinedOutput,
      /Deferred to existing project structure/,
      '--force must not print the deferral summary',
    );
  } finally { f.cleanup(); }
});

test('issue #97 regression guard: clean project still gets the full default scaffold', () => {
  const f = makeFixture();
  try {
    const result = runInit(f.dir, ['--with-all-docs']);
    assert.equal(result.status, 0, `init on clean project exited ${result.status}\nstderr:\n${result.stderr}`);

    // The lean preset includes meetings, memos, prds; verify at least one
    // scaffolded lane and .cx/inbox/ landed normally.
    assert.equal(existsSync(join(f.dir, 'docs', 'meetings')), true, 'clean project must still get docs/meetings/');
    assert.equal(existsSync(join(f.dir, '.cx', 'inbox')), true, 'clean project must still get .cx/inbox/');
  } finally { f.cleanup(); }
});
