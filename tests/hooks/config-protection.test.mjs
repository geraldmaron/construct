/**
 * tests/hooks/config-protection.test.mjs — the hook blocks edits to an
 * established (git-tracked) code-quality config, but allows introducing a new
 * one. Without the tracked-check, first-time config setup (e.g. adding ESLint)
 * was blocked the same as weakening an existing contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'config-protection.mjs');

function runHook(filePath) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, TOOL_INPUT_FILE_PATH: filePath },
  });
}

test('blocks edits to a tracked code-quality config (the contract)', () => {
  const tracked = join(REPO_ROOT, 'eslint.config.mjs');
  const r = runHook(tracked);
  assert.equal(r.status, 2, 'a committed lint-rule config must be protected');
  assert.match(r.stderr, /code quality rules are protected/);
});

test('allows introducing a NEW config that is not yet tracked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-protect-'));
  try {
    const fresh = join(dir, 'eslint.config.mjs');
    writeFileSync(fresh, 'export default [];\n');
    const r = runHook(fresh);
    assert.equal(r.status, 0, 'an untracked new eslint config must be allowed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a path that does not exist yet is allowed (creation)', () => {
  const r = runHook(join(tmpdir(), 'nonexistent-eslint.config.mjs'));
  assert.equal(r.status, 0);
});

test('ignores non-config source files', () => {
  const r = runHook(join(REPO_ROOT, 'lib', 'setup.mjs'));
  assert.equal(r.status, 0);
});
