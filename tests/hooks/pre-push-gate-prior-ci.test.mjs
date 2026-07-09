/**
 * tests/hooks/pre-push-gate-prior-ci.test.mjs — SHA-aware prior-CI check.
 *
 * The pre-push gate consults `gh run list` for the current branch. The
 * gate blocks only when HEAD equals the failed run's headSha (a re-push
 * of the same broken commit) and lets HEAD-past-failure through with a
 * non-blocking notice. A second describe block pins that no bypass
 * mechanism exists: inline env-var prefixes on the bash command are not
 * special-cased, and parent-process env vars named for bypasses are not
 * honored.
 *
 * Stubs `gh` and `git` via a PATH shim so the hook reads scripted output
 * instead of hitting the real CLIs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, before, after, beforeEach } from 'node:test';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const HOOK = path.join(ROOT, 'lib', 'hooks', 'pre-push-gate.mjs');

let tmpDir;
let shimDir;
let repoDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prepush-prior-'));
  shimDir = path.join(tmpDir, 'shims');
  repoDir = path.join(tmpDir, 'repo');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
});

after(() => {
  rmTmpDir(tmpDir);
});

beforeEach(() => {
  for (const f of fs.readdirSync(shimDir)) fs.unlinkSync(path.join(shimDir, f));
});

function writeShim(name, body) {
  const p = path.join(shimDir, name);
  fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function runHook({ headSha, runSha, conclusion = 'failure', branch = 'fix/example', command = 'git push origin HEAD', extraEnv = {} }) {
  // The hook calls: git branch --show-current, git rev-parse HEAD,
  // gh run list. Route each to a deterministic stubbed response.

  writeShim('git', `
case "$*" in
  "branch --show-current") echo "${branch}" ;;
  "rev-parse HEAD")        echo "${headSha}" ;;
  *) exit 0 ;;
esac
`);
  writeShim('gh', `
if [[ "$1" == "run" && "$2" == "list" ]]; then
  cat <<JSON
[{"conclusion":"${conclusion}","databaseId":123,"url":"https://example.test/runs/123","headSha":"${runSha}"}]
JSON
fi
`);
  const input = {
    tool_name: 'Bash',
    tool_input: { command },
  };
  return spawnSync(process.execPath, [HOOK], {
    cwd: repoDir,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      HOME: tmpDir,
      ...extraEnv,
    },
    timeout: 10_000,
  });
}

describe('pre-push-gate prior-CI check', () => {
  it('blocks when HEAD matches the failed run sha', () => {
    const sha = 'a'.repeat(40);
    const r = runHook({ headSha: sha, runSha: sha });
    assert.equal(r.status, 2, `expected exit 2 (blocked); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /HEAD .* is the commit that failed CI/);
    assert.match(r.stderr, /Re-pushing the same SHA/);
  });

  it('allows + notices when HEAD has advanced past the failed sha', () => {
    const failedSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const r = runHook({ headSha, runSha: failedSha });
    assert.equal(r.status, 0, `expected exit 0 (allowed); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /Allowing push — CI will re-evaluate/);
    assert.match(r.stderr, /Prior failure:/);
  });

  it('allows silently when the last run succeeded', () => {
    const sha = 'c'.repeat(40);
    const r = runHook({ headSha: sha, runSha: sha, conclusion: 'success' });
    assert.equal(r.status, 0, `expected exit 0 (allowed); got ${r.status}. stderr:\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /failed CI/);
  });
});

describe('pre-push-gate has no bypass mechanism', () => {
  // Pins the principle: hooks fire unconditionally. If a check is wrong,
  // fix the check — do not re-introduce skip env vars.

  it('CONSTRUCT_SKIP_PREPUSH=1 parent env is ignored — gate still blocks the same SHA', () => {
    const sha = 'd'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      extraEnv: { CONSTRUCT_SKIP_PREPUSH: '1' },
    });
    assert.equal(r.status, 2, `expected exit 2 (skip env ignored); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /HEAD .* is the commit that failed CI/);
  });

  it('CONSTRUCT_SKIP_PREPUSH=1 inline prefix is treated as part of the command, not an override', () => {
    const sha = 'e'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD',
    });
    assert.equal(r.status, 2, `expected exit 2 (inline prefix ignored); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /HEAD .* is the commit that failed CI/);
  });

  it('CONSTRUCT_ALLOW_CLAUDE_PUSH=1 parent env does not unlock a claude/* push', () => {
    const sha = 'f'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      branch: 'claude/foo',
      conclusion: 'success',
      command: 'git push origin claude/foo',
      extraEnv: { CONSTRUCT_ALLOW_CLAUDE_PUSH: '1' },
    });
    assert.equal(r.status, 2, `expected exit 2 (claude/* refused regardless of env); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /Refusing to push an agent-prefixed branch/);
  });

  it('CONSTRUCT_SKIP_PR_LINT=1 parent env does not short-circuit the PR-body path', () => {
    // The hook tries findRepoFile(cwd, 'scripts/lint-commits-pr.mjs') for
    // gh pr create/edit. From an empty tmpdir the script is not present, so
    // the hook writes a deterministic "could not locate" notice to stderr
    // before passing through. The notice's presence proves the hook reached
    // the PR-body path; its absence would prove a short-circuit.
    const r = runHook({
      headSha: 'g'.repeat(40),
      runSha: 'g'.repeat(40),
      conclusion: 'success',
      command: 'gh pr create --title x --body "body text"',
      extraEnv: { CONSTRUCT_SKIP_PR_LINT: '1' },
    });
    assert.match(
      r.stderr,
      /could not locate scripts\/lint-commits-pr\.mjs/,
      `gate must engage the PR-body path; stderr:\n${r.stderr}`,
    );
  });
});
