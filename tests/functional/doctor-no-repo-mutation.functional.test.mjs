/**
 * tests/functional/doctor-no-repo-mutation.functional.test.mjs
 *
 * `construct doctor` is a health *check*
 * and must be side-effect-free on tracked repo source: it must never delete or
 * modify committed files (lib/, bin/, tests/, docs/, apps/, scripts/,
 * templates/, skills/, rules/, schemas/, registry/). The ia8b
 * report turned out to be a misattribution of concurrent agent edits in a shared
 * tree, but this test locks the invariant so any future doctor change that
 * mutates source is caught.
 *
 * Spawns the real bin/construct doctor against this checkout in an isolated tmp
 * HOME and asserts: sentinel committed files (including the
 * bin/construct-postinstall.mjs the report alleged was rewritten) are
 * byte-identical afterward, and the run introduces no new tracked-source
 * deletions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

const SOURCE_DIRS = ['lib/', 'bin/', 'tests/', 'docs/', 'apps/', 'scripts/', 'templates/', 'skills/', 'rules/', 'schemas/', 'registry/'];

const SENTINELS = [
  'bin/construct-postinstall.mjs',
  'lib/cli-commands.mjs',
  'scripts/audit/baseline.json',
  'package.json',
];

function hashFile(rel) {
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs)) return null;
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

// git status --porcelain lines for tracked deletions (index or worktree) under
// a source dir — the data-loss the report alleged.
function sourceDeletions() {
  const out = spawnSync('git', ['status', '--porcelain=v1'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout || '';
  return out.split('\n').filter((line) => {
    if (line.length < 4) return false;
    const code = line.slice(0, 2);
    if (!code.includes('D')) return false;
    const path = line.slice(3).replace(/^"|"$/g, '');
    return SOURCE_DIRS.some((d) => path.startsWith(d));
  });
}

test('construct doctor does not delete or modify committed repo source (construct-ia8b guard)', { timeout: 120_000 }, () => {
  const before = Object.fromEntries(SENTINELS.map((rel) => [rel, hashFile(rel)]));
  for (const rel of SENTINELS) {
    assert.notEqual(before[rel], null, `sentinel ${rel} must exist before the doctor run`);
  }
  const deletionsBefore = new Set(sourceDeletions());

  const home = mkdtempSync(join(tmpdir(), 'cx-doctor-noop-HOME-'));
  try {
    spawnSync(process.execPath, [BIN, 'doctor'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 90_000,
      env: { ...process.env, HOME: home, CONSTRUCT_SKIP_POSTINSTALL: '1' },
    });

    for (const rel of SENTINELS) {
      assert.ok(existsSync(join(REPO_ROOT, rel)), `doctor must not delete committed ${rel}`);
      assert.equal(hashFile(rel), before[rel], `doctor must not modify committed ${rel}`);
    }
    const introduced = sourceDeletions().filter((line) => !deletionsBefore.has(line));
    assert.deepEqual(introduced, [], `doctor must not delete tracked source; introduced deletions:\n${introduced.join('\n')}`);
  } finally {
    rmTmpDir(home);
  }
});
