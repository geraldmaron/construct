/**
 * tests/functional/post-merge-tracking.functional.test.mjs — end-to-end
 * coverage for the post-merge bead-close hook.
 *
 * Spawns lib/hooks/post-merge-tracking.mjs with a synthetic
 * `gh pr merge` PostToolUse payload. PATH-shimmed `gh` returns a canned
 * PR body with bead refs; PATH-shimmed `bd` records every call.
 *
 * Three contracts:
 *   1. successful `gh pr merge N` closes every open bead referenced in
 *      the PR body (Refs / Closes / Fixes).
 *   2. non-zero exit on `gh pr merge` short-circuits — no `bd close` runs.
 *   3. non-`gh pr merge` Bash commands are ignored — no `bd close` runs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const HOOK = join(REPO_ROOT, 'lib', 'hooks', 'post-merge-tracking.mjs');

function setupShimEnv() {
  const cwd = mkdtempSync(join(tmpdir(), 'post-merge-fn-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'post-merge-shims-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd });
  return {
    cwd,
    shimDir,
    bdLog: join(cwd, 'bd-calls.log'),
    cleanup: () => {
      rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      rmSync(shimDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

function writeShim(shimDir, name, body) {
  writeFileSync(join(shimDir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function runHook({ cwd, shimDir, command, exitCode = 0 }) {
  return spawnSync(process.execPath, [HOOK], {
    cwd,
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
    },
    input: JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { exit_code: exitCode },
      cwd,
    }),
    encoding: 'utf8',
    timeout: 15_000,
  });
}

test('post-merge-tracking closes open beads named in the PR body', () => {
  const env = setupShimEnv();
  writeFileSync(env.bdLog, '');
  try {
    writeShim(env.shimDir, 'gh', `cat <<'JSON'
{"body":"## Beads issue\\n\\nRefs: construct-aaa, construct-bbb\\nCloses: construct-ccc"}
JSON
`);
    writeShim(env.shimDir, 'bd', `
echo "$@" >> "${env.bdLog}"
if [[ "$1" == "show" && "$2" == "construct-aaa" ]]; then echo '{"status":"open"}'; exit 0; fi
if [[ "$1" == "show" && "$2" == "construct-bbb" ]]; then echo '{"status":"in_progress"}'; exit 0; fi
if [[ "$1" == "show" && "$2" == "construct-ccc" ]]; then echo '{"status":"closed"}'; exit 0; fi
if [[ "$1" == "close" ]]; then exit 0; fi
echo "{}"
`);

    const r = runHook({ cwd: env.cwd, shimDir: env.shimDir, command: 'gh pr merge 42 --squash' });
    assert.equal(r.status, 0);
    const calls = readFileSync(env.bdLog, 'utf8');
    assert.match(calls, /close construct-aaa --reason Merged via PR #42/);
    assert.match(calls, /close construct-bbb --reason Merged via PR #42/);
    assert.doesNotMatch(calls, /close construct-ccc/, 'already-closed beads must be skipped');
    assert.match(r.stderr, /closed beads: (construct-aaa|construct-bbb)/);
  } finally {
    env.cleanup();
  }
});

test('post-merge-tracking ignores a failed gh pr merge', () => {
  const env = setupShimEnv();
  writeFileSync(env.bdLog, '');
  try {
    writeShim(env.shimDir, 'gh', `echo '{"body":"Refs: construct-xxx"}'`);
    writeShim(env.shimDir, 'bd', `
echo "$@" >> "${env.bdLog}"
if [[ "$1" == "close" ]]; then exit 0; fi
echo '{"status":"open"}'
`);

    const r = runHook({ cwd: env.cwd, shimDir: env.shimDir, command: 'gh pr merge 9', exitCode: 1 });
    assert.equal(r.status, 0);
    assert.equal(readFileSync(env.bdLog, 'utf8'), '');
  } finally {
    env.cleanup();
  }
});

test('post-merge-tracking is a no-op for non-merge Bash commands', () => {
  const env = setupShimEnv();
  writeFileSync(env.bdLog, '');
  try {
    writeShim(env.shimDir, 'gh', `echo '{"body":"Refs: construct-yyy"}'`);
    writeShim(env.shimDir, 'bd', `echo "$@" >> "${env.bdLog}"`);

    const r = runHook({ cwd: env.cwd, shimDir: env.shimDir, command: 'git push origin staging' });
    assert.equal(r.status, 0);
    assert.equal(readFileSync(env.bdLog, 'utf8'), '');
  } finally {
    env.cleanup();
  }
});

test('post-merge-tracking resolves PR number from the merge commit when --auto is used', () => {
  const env = setupShimEnv();
  writeFileSync(env.bdLog, '');
  try {
    writeFileSync(join(env.cwd, 'README.md'), 'seed\n');
    spawnSync('git', ['add', 'README.md'], { cwd: env.cwd });
    spawnSync('git', ['commit', '--quiet', '-m', 'Merge pull request #87 from foo/bar'], { cwd: env.cwd });

    writeShim(env.shimDir, 'gh', `echo '{"body":"Closes construct-late"}'`);
    writeShim(env.shimDir, 'bd', `
echo "$@" >> "${env.bdLog}"
if [[ "$1" == "show" ]]; then echo '{"status":"open"}'; exit 0; fi
if [[ "$1" == "close" ]]; then exit 0; fi
`);

    const r = runHook({ cwd: env.cwd, shimDir: env.shimDir, command: 'gh pr merge --auto --squash' });
    assert.equal(r.status, 0);
    const calls = readFileSync(env.bdLog, 'utf8');
    assert.match(calls, /close construct-late --reason Merged via PR #87/);
  } finally {
    env.cleanup();
  }
});
