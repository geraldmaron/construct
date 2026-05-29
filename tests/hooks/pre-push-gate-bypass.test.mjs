/**
 * tests/hooks/pre-push-gate-bypass.test.mjs — bypass audit log + protected
 * branch refusal.
 *
 * The pre-push gate accepts three documented bypass env vars
 * (CONSTRUCT_SKIP_PREPUSH, CONSTRUCT_ALLOW_CLAUDE_PUSH, CONSTRUCT_SKIP_PR_LINT)
 * as either parent-process env or inline command prefix. Every honored
 * bypass is appended to ~/.construct/audit/prepush-bypass.log so
 * `construct doctor` can flag frequent usage as a signal that the gate
 * itself is wrong-sized. On protected branches (main / staging / master)
 * bypasses are refused unconditionally — those branches go through PR + CI.
 *
 * Tests stub `git` and `gh` via a PATH shim, and isolate HOME so the
 * audit log lands in a tmpdir per test.
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
let homeDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-prepush-bypass-'));
  shimDir = path.join(tmpDir, 'shims');
  repoDir = path.join(tmpDir, 'repo');
  homeDir = path.join(tmpDir, 'home');
  fs.mkdirSync(shimDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const f of fs.readdirSync(shimDir)) fs.unlinkSync(path.join(shimDir, f));
  const auditPath = path.join(homeDir, '.construct', 'audit', 'prepush-bypass.log');
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
});

function writeShim(name, body) {
  const p = path.join(shimDir, name);
  fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function stubGitBranch(branch) {
  // Stub the only git subcommand the hook calls in the bypass path:
  // `git branch --show-current` and `git rev-parse HEAD`. Anything else
  // exits 0 silently so the hook proceeds.

  writeShim('git', `
case "$*" in
  "branch --show-current") echo "${branch}" ;;
  "rev-parse HEAD")        echo "abc1234abc1234abc1234abc1234abc1234abc12" ;;
  *) exit 0 ;;
esac
`);
  // gh exits clean: no prior runs => prior-CI block does nothing.

  writeShim('gh', 'exit 0');
}

function runHook({ command, branch = 'fix/example' }) {
  stubGitBranch(branch);
  const input = { tool_name: 'Bash', tool_input: { command } };
  return spawnSync(process.execPath, [HOOK], {
    cwd: repoDir,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH}`,
      HOME: homeDir,
      CONSTRUCT_SKIP_PREPUSH: '',
      CONSTRUCT_ALLOW_CLAUDE_PUSH: '',
      CONSTRUCT_SKIP_PR_LINT: '',
    },
    timeout: 10_000,
  });
}

function readAuditEntries() {
  const auditPath = path.join(homeDir, '.construct', 'audit', 'prepush-bypass.log');
  if (!fs.existsSync(auditPath)) return [];
  return fs.readFileSync(auditPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('pre-push-gate bypass audit log', () => {
  it('writes a JSONL entry when CONSTRUCT_SKIP_PREPUSH=1 is honored inline', () => {
    const r = runHook({ command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD' });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}. stderr:\n${r.stderr}`);
    const entries = readAuditEntries();
    assert.equal(entries.length, 1, 'one entry should land in the audit log');
    assert.equal(entries[0].var, 'CONSTRUCT_SKIP_PREPUSH');
    assert.equal(entries[0].source, 'inline');
    assert.equal(entries[0].branch, 'fix/example');
    assert.ok(entries[0].head?.length > 0, 'head sha should be recorded');
    assert.ok(entries[0].ts, 'timestamp should be recorded');
  });

  it('writes a JSONL entry when CONSTRUCT_ALLOW_CLAUDE_PUSH=1 is honored inline', () => {
    const r = runHook({ command: 'CONSTRUCT_ALLOW_CLAUDE_PUSH=1 git push origin claude/foo' });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}. stderr:\n${r.stderr}`);
    const entries = readAuditEntries();
    assert.equal(entries.length, 1, 'one entry should land in the audit log');
    assert.equal(entries[0].var, 'CONSTRUCT_ALLOW_CLAUDE_PUSH');
    assert.equal(entries[0].source, 'inline');
  });

  it('appends additional entries on subsequent bypasses', () => {
    runHook({ command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD' });
    runHook({ command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD' });
    runHook({ command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD' });
    const entries = readAuditEntries();
    assert.equal(entries.length, 3, 'three bypasses should append three entries');
  });

  it('truncates very long commands in the log entry', () => {
    const longSuffix = '#' + 'x'.repeat(500);
    runHook({ command: `CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD ${longSuffix}` });
    const [entry] = readAuditEntries();
    assert.ok(entry.cmd.length <= 201, `cmd should be truncated to ~200 chars; got ${entry.cmd.length}`);
    assert.ok(entry.cmd.endsWith('…'), 'truncated cmd should end with ellipsis');
  });

  it('writes nothing when no bypass fires', () => {
    const r = runHook({ command: 'git push origin HEAD' });
    assert.equal(r.status, 0);
    assert.equal(readAuditEntries().length, 0, 'no audit entries when no bypass was used');
  });
});

describe('pre-push-gate protected-branch refusal', () => {
  for (const branch of ['main', 'staging', 'master']) {
    it(`refuses CONSTRUCT_SKIP_PREPUSH=1 on protected branch '${branch}'`, () => {
      const r = runHook({ command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD', branch });
      assert.equal(r.status, 2, `expected exit 2 (refused); got ${r.status}. stderr:\n${r.stderr}`);
      assert.match(r.stderr, /refused on protected branch/);
      assert.match(r.stderr, new RegExp(`'${branch}'`));
      // Refused bypasses must NOT be logged — the log captures honored
      // bypasses (which we should worry about), not refused ones.

      assert.equal(readAuditEntries().length, 0, 'refused bypasses must not appear in the audit log');
    });
  }

  it('still honors CONSTRUCT_SKIP_PREPUSH on a feature branch', () => {
    const r = runHook({ command: 'CONSTRUCT_SKIP_PREPUSH=1 git push origin HEAD', branch: 'fix/something' });
    assert.equal(r.status, 0, `expected exit 0; got ${r.status}. stderr:\n${r.stderr}`);
    assert.equal(readAuditEntries().length, 1, 'feature-branch bypass should be honored and logged');
  });
});
