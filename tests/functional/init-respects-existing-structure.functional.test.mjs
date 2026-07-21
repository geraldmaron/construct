/**
 * tests/functional/init-respects-existing-structure.functional.test.mjs
 *
 * End-to-end coverage for issue #97 — `construct init` must defer to a
 * project's existing content structure instead of scaffolding parallel
 * docs/inbox/templates trees. Spawns the real bin against three fixtures
 * created in tmpdirs, each one prepared and torn down per test:
 *
 *   1) preexisting layout — init must skip docs/meetings/, docs/memos/, the
 *      project-root inbox/ (custom intake detected), and per-lane templates/
 *      that are already covered by internal/, data/, and root templates/.
 *   2) preexisting layout + --force — init must scaffold the full default
 *      tree anyway (power-user escape hatch).
 *   3) clean project — init's existing behavior is unchanged.
 *
 * Each case spawns the real CLI, asserts on the filesystem aftermath, and
 * inspects stdout for the "deferred to existing project structure" notices.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { parseJsonc } from '../../lib/jsonc.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeFixture(extraSetup) {
  const dir = mkdtempSync(join(tmpdir(), 'init-existing-'));
  const home = mkdtempSync(join(tmpdir(), 'init-existing-home-'));
  // Seed a git repo with identity config so beads/init hooks behave; init also
  // auto-runs `git init` in non-interactive mode when `.git/` is absent.
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  if (extraSetup) extraSetup(dir);
  return {
    dir,
    home,
    write(rel, content) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    cleanup() {
      rmTmpDir(dir);
      rmTmpDir(home);
    },
  };
}

function runInit(cwd, home, extraArgs = []) {
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
        HOME: home,
        CONSTRUCT_HOME_OVERRIDE: home,
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
    const result = runInit(f.dir, f.home, ['--with-all-docs']);
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
      existsSync(join(f.dir, 'inbox')),
      false,
      'inbox/ must NOT be scaffolded — ./ingest custom script detected',
    );
    assert.equal(
      existsSync(join(f.dir, '.construct', 'inbox')),
      false,
      '.construct/inbox/ is never scaffolded under the single-zone model',
    );

    const projectConfigPath = join(f.dir, 'construct.config.json');
    assert.equal(existsSync(projectConfigPath), true, 'construct.config.json must be written');
    const projectConfig = parseJsonc(readFileSync(projectConfigPath, 'utf8'));
    assert.equal(
      'zones' in (projectConfig.intakePolicy ?? {}),
      false,
      'single-zone model writes no zones object — inbox/ is just not scaffolded when custom intake is detected',
    );

    const combinedOutput = result.stdout + result.stderr;
    assert.match(
      combinedOutput,
      /skipping docs\/meetings\/ — existing internal\/meetings\//,
      'expected init to log meetings skip pointing at internal/meetings/',
    );
    assert.match(
      combinedOutput,
      /skipping inbox\/ — custom intake script \.\/ingest/,
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
    const result = runInit(f.dir, f.home, ['--with-all-docs', '--force']);
    assert.equal(result.status, 0, `init --force exited ${result.status}\nstderr:\n${result.stderr}`);

    assert.equal(
      existsSync(join(f.dir, 'docs', 'meetings')),
      true,
      '--force must scaffold docs/meetings/ even when internal/meetings/ exists',
    );
    assert.equal(
      existsSync(join(f.dir, 'inbox')),
      true,
      '--force must scaffold inbox/ even when ./ingest exists',
    );

    const projectConfig = parseJsonc(readFileSync(join(f.dir, 'construct.config.json'), 'utf8'));
    assert.equal(
      'zones' in (projectConfig.intakePolicy ?? {}),
      false,
      'single-zone model writes no zones object; --force scaffolds inbox/ unconditionally',
    );

    const combinedOutput = result.stdout + result.stderr;
    assert.doesNotMatch(
      combinedOutput,
      /Deferred to existing project structure/,
      '--force must not print the deferral summary',
    );
  } finally { f.cleanup(); }
});

test('issue #97 regression guard: clean project with --with-all-docs still scaffolds lane dirs', () => {
  const f = makeFixture();
  try {
    const result = runInit(f.dir, f.home, ['--with-all-docs']);
    assert.equal(result.status, 0, `init on clean project exited ${result.status}\nstderr:\n${result.stderr}`);

    // --with-all-docs must materialize docs/meetings on a clean project.
    assert.equal(existsSync(join(f.dir, 'docs', 'meetings')), true, 'clean project with --with-all-docs must get docs/meetings/');
    assert.equal(existsSync(join(f.dir, 'inbox')), true, 'clean project must still get inbox/');
  } finally { f.cleanup(); }
});
