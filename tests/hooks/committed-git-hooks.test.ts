/**
 * tests/hooks/committed-git-hooks.test.ts — the repository's git hooks live in
 * the tracked .githooks, and none of them runs the retired Beads tracker.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

test('committed git hooks never invoke the Beads tracker', () => {
  const listed = spawnSync('git', ['ls-files', '--', '.githooks'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const files = listed.stdout.split('\n').filter(Boolean);
  assert.ok(files.length > 0, 'expected at least one committed git hook');
  const offenders = files.filter((file) => /\bbd\s+hooks\b|BEGIN BEADS INTEGRATION/.test(readFileSync(join(REPO, file), 'utf8')));
  assert.deepEqual(offenders, []);
});
