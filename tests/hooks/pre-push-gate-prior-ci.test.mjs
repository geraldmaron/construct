/**
 * tests/hooks/pre-push-gate-prior-ci.test.mjs — SHA-aware prior-CI check.
 *
 * The pre-push gate consults `gh run list` for the current branch. Older
 * logic blocked on any prior failure, which created a doom loop: the very
 * commit that fixes CI couldn't push without an env-var override, training
 * everyone to ignore the gate. The fix compares HEAD to the failed run's
 * headSha and only blocks when they match (i.e. a re-push of the broken
 * SHA). These tests pin both branches of that behavior in place.
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
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const f of fs.readdirSync(shimDir)) fs.unlinkSync(path.join(shimDir, f));
});

function writeShim(name, body) {
  const p = path.join(shimDir, name);
  fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function runHook({ headSha, runSha, conclusion = 'failure', branch = 'fix/example', command = 'git push origin HEAD' }) {
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
      CONSTRUCT_SKIP_PREPUSH: '',
      CONSTRUCT_ALLOW_CLAUDE_PUSH: '',
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

describe('pre-push-gate inline env-var bypass', () => {
  // Inline prefixes on the bash command (CONSTRUCT_SKIP_PREPUSH=1 git push ...)
  // are unreachable via process.env because Claude Code's PreToolUse hook runs
  // before bash parses the command. The hook re-parses the command string so
  // the documented escape hatch actually works inside Claude Code.

  it('CONSTRUCT_SKIP_PREPUSH=1 inline prefix bypasses the same-SHA block', () => {
    const sha = 'd'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD',
    });
    assert.equal(r.status, 0, `expected exit 0 (bypassed); got ${r.status}. stderr:\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /HEAD .* is the commit that failed CI/);
  });

  it('CONSTRUCT_ALLOW_CLAUDE_PUSH=1 inline prefix allows a claude/* push', () => {
    const sha = 'e'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      branch: 'claude/foo',
      conclusion: 'success',
      command: 'CONSTRUCT_ALLOW_CLAUDE_PUSH=1 git push origin claude/foo',
    });
    assert.equal(r.status, 0, `expected exit 0 (allowed); got ${r.status}. stderr:\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Refusing to push a claude/);
  });

  it('non-allowlist env-var prefix is ignored — gate still runs', () => {
    const sha = 'f'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      command: 'RANDOM=1 git push origin HEAD',
    });
    assert.equal(r.status, 2, `expected exit 2 (still blocked); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /HEAD .* is the commit that failed CI/);
  });

  it('env-var appearing AFTER the executable is not treated as a prefix', () => {
    // `git push HEAD CONSTRUCT_SKIP_PREPUSH=1` is just a positional arg to git,
    // not an env-var prefix — the parser must stop at the first non-assignment token.
    const sha = '0'.repeat(40);
    const r = runHook({
      headSha: sha,
      runSha: sha,
      command: 'git push origin HEAD CONSTRUCT_SKIP_PREPUSH=1',
    });
    assert.equal(r.status, 2, `expected exit 2 (still blocked — prefix-only); got ${r.status}. stderr:\n${r.stderr}`);
  });
});
