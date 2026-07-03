/**
 * tests/functional/init-beads-fail-closed.functional.test.mjs
 *
 * Verifies that `construct init` is fail-closed when beads initialization fails:
 *   1. If initializeBeadsTracker throws, init exits non-zero rather than silently continuing.
 *   2. --no-beads skips tracker initialization and exits successfully.
 *
 * Uses a real tmpdir with a poisoned PATH so that the `bd` binary is missing,
 * which causes initializeBeadsTracker to throw during the bd-init subprocess call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeGitRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'beads-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Beads Test'], { cwd: dir });
  return dir;
}

// A PATH that contains only a fake bin directory with no `bd` binary, so any
// call that depends on the bd CLI will fail.
function restrictedPath() {
  const fakebin = mkdtempSync(join(tmpdir(), 'fakebin-'));
  return fakebin;
}

test('construct init fails with non-zero exit when beads initialization throws', (t) => {
  const dir = makeGitRepo('init-beads-fail-');
  const fakeBin = restrictedPath();
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  });

  // Run init with a PATH that has no `bd` binary. initializeBeadsTracker will
  // attempt to spawn bd and throw, which must propagate as a non-zero exit.
  const result = spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start'],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        PATH: `${fakeBin}:/usr/bin:/bin`,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
      },
    },
  );

  assert.notEqual(result.status, 0, `init should exit non-zero when beads fails, got: ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});

test('construct init --no-beads skips beads and exits successfully', (t) => {
  const dir = makeGitRepo('init-no-beads-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start', '--no-beads'],
    {
      cwd: dir,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
      },
    },
  );

  assert.equal(result.status, 0, `init --no-beads should succeed, got: ${result.status}\nstderr: ${result.stderr}`);
  assert.match(result.stdout, /--no-beads/, '--no-beads note should appear in output');
});
