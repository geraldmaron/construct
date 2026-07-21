/**
 * tests/doctor/git-hooks-project-scope.test.mjs — git hooks doctor check uses project cwd.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';
import { checkProjectGitHooks } from '../../lib/doctor/git-hooks.mjs';

test('skips when project has no .beads/hooks/pre-commit', () => {
  const dir = tempDir('doctor-git-hooks-');
  try {
    const result = checkProjectGitHooks(dir);
    assert.equal(result.run, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports wired hooks from project git config', () => {
  const dir = tempDir('doctor-git-hooks-');
  try {
    fs.mkdirSync(path.join(dir, '.beads', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.beads', 'hooks', 'pre-commit'), '#!/bin/sh\n');
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'config'), '[core]\n\thooksPath = .beads/hooks\n');

    const result = checkProjectGitHooks(dir, {
      spawnSyncImpl: () => ({ status: 0, stdout: '.beads/hooks\n' }),
    });

    assert.equal(result.run, true);
    assert.equal(result.pass, true);
    assert.match(result.label, /Git hooks wired/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports unwired hooks with git config fix command', () => {
  const dir = tempDir('doctor-git-hooks-');
  try {
    fs.mkdirSync(path.join(dir, '.beads', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.beads', 'hooks', 'pre-commit'), '#!/bin/sh\n');

    const result = checkProjectGitHooks(dir, {
      spawnSyncImpl: () => ({ status: 1, stdout: '' }),
    });

    assert.equal(result.run, true);
    assert.equal(result.pass, false);
    assert.match(result.label, /git config core\.hooksPath/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
