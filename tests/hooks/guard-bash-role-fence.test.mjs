/**
 * tests/hooks/guard-bash-role-fence.test.mjs — role-fence actor-identity gate
 * in isolation (construct-7164), plus a cross-hook check that guard-bash's
 * CONSTRUCT_AGENT_ID lookup agrees with agent-tracker's real per-agent
 * filename convention (construct-diq1).
 *
 * Drives lib/hooks/guard-bash.mjs directly (spawned as a subprocess against
 * synthetic stdin/env, not via live PreToolUse dispatch) with crafted
 * last-agent.json state, proving the fence only ever applies to the actor it
 * was recorded for — not to whoever happens to run a bash command while the
 * dispatch timestamp is still fresh.
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
const HOOK = path.join(ROOT, 'lib', 'hooks', 'guard-bash.mjs');
const TRACKER = path.join(ROOT, 'lib', 'hooks', 'agent-tracker.mjs');

let constructDir;

before(() => {
  constructDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-guard-bash-fence-'));
});

after(() => {
  rmTmpDir(constructDir);
});

beforeEach(() => {
  fs.rmSync(constructDir, { recursive: true, force: true });
  fs.mkdirSync(constructDir, { recursive: true });
});

function run({ command, agentId, env = {} }) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      ...(agentId ? { agent_id: agentId } : {}),
    }),
    env: { ...process.env, CONSTRUCT_DOCTOR_ROOT: constructDir, ...env },
    cwd: ROOT,
    timeout: 10_000,
  });
}

function writeShared(entry) {
  fs.writeFileSync(path.join(constructDir, 'last-agent.json'), JSON.stringify(entry));
}

function writePerAgent(id, entry) {
  fs.writeFileSync(path.join(constructDir, `last-agent-${id}.json`), JSON.stringify(entry));
}

describe('guard-bash role-fence actor identity (construct-7164)', () => {
  it('does NOT fence a different actor riding a fresh shared dispatch record (the reported bug)', () => {
    writeShared({ agent: 'engineer', agentId: 'sub-aaa', ts: new Date().toISOString() });
    const r = run({ command: 'ls' });
    assert.equal(r.status, 0, `expected pass (no actor match); got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('does NOT fence a different, concurrently-running subagent (mismatched agent_id)', () => {
    writeShared({ agent: 'engineer', agentId: 'sub-aaa', ts: new Date().toISOString() });
    const r = run({ command: 'ls', agentId: 'sub-bbb' });
    assert.equal(r.status, 0, `expected pass (mismatched agent_id); got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('fences the SAME subagent call proven by a matching agent_id', () => {
    writeShared({ agent: 'engineer', agentId: 'sub-aaa', ts: new Date().toISOString() });
    const r = run({ command: 'ls', agentId: 'sub-aaa' });
    assert.equal(r.status, 2, `expected block (same actor, matching agent_id); got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /engineer cannot run this command/);
  });

  it('fences an explicit self-declared identity (CONSTRUCT_AGENT_ID) via the per-agent file', () => {
    writePerAgent('engineer', { agent: 'engineer', ts: new Date().toISOString() });
    const r = run({ command: 'ls', env: { CONSTRUCT_AGENT_ID: 'engineer' } });
    assert.equal(r.status, 2, `expected block; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it("allows a command that IS inside the fenced persona's allowed commands", () => {
    writeShared({ agent: 'engineer', agentId: 'sub-aaa', ts: new Date().toISOString() });
    const r = run({ command: 'git status', agentId: 'sub-aaa' });
    assert.equal(r.status, 0, `allowed command must pass; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('does not fence on a stale timestamp even with a matching agent_id (existing behavior preserved)', () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeShared({ agent: 'engineer', agentId: 'sub-aaa', ts: stale });
    const r = run({ command: 'ls', agentId: 'sub-aaa' });
    assert.equal(r.status, 0, `stale dispatch must not block; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('does not fence a stale self-declared identity either', () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writePerAgent('engineer', { agent: 'engineer', ts: stale });
    const r = run({ command: 'ls', env: { CONSTRUCT_AGENT_ID: 'engineer' } });
    assert.equal(r.status, 0, `stale self-declared identity must not block; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('fails open on malformed stdin', () => {
    const r = spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      input: 'not json{',
      env: { ...process.env, CONSTRUCT_DOCTOR_ROOT: constructDir },
      cwd: ROOT,
      timeout: 10_000,
    });
    assert.equal(r.status, 0);
  });

  it('reads the actual per-agent file agent-tracker writes for CONSTRUCT_AGENT_ID (construct-diq1)', () => {
    // Spawn the tracker against an isolated project dir (not ROOT) so this
    // test cannot write into the real repo's .construct/ state.
    const projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-tracker-project-'));
    try {
      const trackerResult = spawnSync(process.execPath, [TRACKER], {
        encoding: 'utf8',
        input: JSON.stringify({
          tool_name: 'Task',
          tool_input: { subagent_type: 'engineer', description: 'fix the widget' },
          tool_result: { result: 'Task completed successfully.' },
          cwd: projectCwd,
        }),
        env: { ...process.env, CONSTRUCT_DOCTOR_ROOT: constructDir },
        cwd: projectCwd,
        timeout: 10_000,
      });
      assert.equal(trackerResult.status, 0, `agent-tracker exited non-zero: ${trackerResult.stderr}`);
      assert.ok(
        fs.existsSync(path.join(constructDir, 'last-agent-engineer.json')),
        'agent-tracker should key the per-agent file by persona id with the cx- prefix stripped'
      );

      const r = run({ command: 'ls', env: { CONSTRUCT_AGENT_ID: 'engineer' } });
      assert.equal(r.status, 2, `expected block via the real tracker-written file; got ${r.status}. stderr:\n${r.stderr}`);
      assert.match(r.stderr, /engineer cannot run this command/);
    } finally {
      rmTmpDir(projectCwd);
    }
  });
});
