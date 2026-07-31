/**
 * tests/hooks/comment-lint-root.test.mjs — the hook lints a file against the
 * project that file belongs to, not against the Construct install.
 *
 * Every path-scoped check in the comment lint resolves its glob against the
 * root it is handed, so a root the file does not live under turns the relative
 * path into a `../../..` escape and silently disables all of them. These pin
 * the resolution and the authorship claim the hook makes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'comment-lint.mjs');

function runHook(filePath) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, TOOL_INPUT_FILE_PATH: filePath },
  });
}

function consumerProject(files) {
  const dir = mkdtempSync(join(tmpdir(), 'comment-lint-root-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'acme-app' }));
  mkdirSync(join(dir, '.beads'), { recursive: true });
  writeFileSync(join(dir, '.beads', 'config.yaml'), 'issue-prefix: "acme"\n');
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const CLEAN = '/**\n * src/thing.mjs — a thing.\n *\n * Does the thing.\n */\n\nexport const x = 1;\n';
const CITES_TRACKER = '/**\n * src/thing.mjs — a thing.\n *\n * Does the thing.\n */\n\n// Retry budget capped at 3 per acme-4821.\n\nexport const x = 1;\n';

test('a clean file in a consuming project passes', () => {
  const dir = consumerProject({ 'src/thing.mjs': CLEAN });
  try {
    assert.equal(runHook(join(dir, 'src', 'thing.mjs')).status, 0);
  } finally {
    rmTmpDir(dir);
  }
});

test('the violation is reported at its path within the consuming project', () => {
  const dir = consumerProject({ 'src/thing.mjs': CITES_TRACKER });
  try {
    const r = runHook(join(dir, 'src', 'thing.mjs'));
    assert.equal(r.status, 2, `the edit must be blocked; got ${r.status}\n${r.stderr}`);
    assert.match(r.stderr, /^\s*warn\s+src\/thing\.mjs:7\b/m);
    assert.doesNotMatch(r.stderr, /\.\.\//, 'a path relative to the install root disables every path-scoped check');
  } finally {
    rmTmpDir(dir);
  }
});

test('a path-scoped check fires on a consuming project file', () => {
  const dir = consumerProject({ 'docs/guides/retry.md': '# Retry\n\nThe retry path is not yet implemented.\n' });
  try {
    const r = runHook(join(dir, 'docs', 'guides', 'retry.md'));
    assert.match(r.stderr, /future-state doc marker/);
    assert.match(r.stderr, /acme-\* tracker id/, 'the marker asks for the consuming project\'s tracker');
  } finally {
    rmTmpDir(dir);
  }
});

// The fixture id is assembled rather than written out: spelling it in full
// would be this repo citing its own tracker in a comment, which is the thing
// under test, and the lint would reject this file for containing it.

test('a tracker id this repo bans is still blocked here', () => {
  const scratch = join(REPO_ROOT, 'lib', '__comment-lint-root-fixture.mjs');
  const id = `${'construct'}-8iwgr`;
  try {
    writeFileSync(scratch, `/**\n * lib/__comment-lint-root-fixture.mjs — fixture.\n *\n * Removed by the test.\n */\n\n// Capped at 3 per ${id}.\n\nexport const z = 3;\n`);
    const r = runHook(scratch);
    assert.equal(r.status, 2, `the Construct repo must still block its own ids; got ${r.status}\n${r.stderr}`);
  } finally {
    rmSync(scratch, { force: true });
  }
});
