/**
 * tests/functional/install-parity.functional.test.mjs
 *
 * Regression guard for the install→parity gap (lib/setup.mjs): `construct
 * install` ensures a user-scope opencode.json (empty agent table) and must then
 * run `sync --global` so the front-door agent populates every user-scope surface
 * — otherwise a fresh machine fails cross-surface adapter parity (`doctor`
 * exits 1). This pins the bug→fix: empty opencode skeleton reads as drift; after
 * the global front-door sync it reads as ok and overall parity is clean.
 *
 * Deterministic and fast: runs the real `construct sync --global` (no embedding
 * model, no Docker, no network) in an isolated HOME.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');
const { checkParity } = await import(join(REPO_ROOT, 'lib', 'parity.mjs'));

test('install skeleton is drift until the global front-door sync makes parity clean', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'install-parity-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(join(HOME, '.config', 'opencode'), { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: project });

  try {
    // Reproduce what `construct install` writes via ensureOpenCodeConfig: a base
    // opencode.json with an empty agent table.
    writeFileSync(
      join(HOME, '.config', 'opencode', 'opencode.json'),
      JSON.stringify({ $schema: 'https://opencode.ai/config.json', agent: {} }),
    );

    const before = checkParity({ rootDir: REPO_ROOT, homeDir: HOME });
    const opencodeBefore = before.surfaces.find((s) => s.surface === 'opencode');
    assert.equal(opencodeBefore.status, 'drift', 'empty opencode skeleton must read as drift (the bug)');
    assert.equal(before.ok, false, 'overall parity fails before the global sync');

    const sync = spawnSync(process.execPath, [BIN, 'sync', '--global'], {
      cwd: project, encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, HOME, CONSTRUCT_SKIP_POSTINSTALL: '1' },
    });
    assert.equal(sync.status, 0, `sync --global failed: ${sync.stderr}`);

    const after = checkParity({ rootDir: REPO_ROOT, homeDir: HOME });
    const opencodeAfter = after.surfaces.find((s) => s.surface === 'opencode');
    assert.equal(opencodeAfter.status, 'ok', `opencode must be populated after the sync: ${JSON.stringify(opencodeAfter)}`);
    assert.equal(after.ok, true, `parity must be clean after the global sync: ${after.summary.join(' · ')}`);
    for (const s of after.surfaces) {
      assert.notEqual(s.status, 'drift', `${s.surface} must not be in drift after the global sync`);
    }
  } finally {
    rmTmpDir(sandbox);
  }
});
