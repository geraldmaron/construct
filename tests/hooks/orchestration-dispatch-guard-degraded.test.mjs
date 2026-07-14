/**
 * tests/hooks/orchestration-dispatch-guard-degraded.test.mjs — degraded dispatch
 * responses must not falsely clear the guard.
 *
 * lib/hooks/orchestration-dispatch-guard.mjs only sets dispatched:true when the
 * dispatch tool's own tool_response does not carry a degraded/empty-tasks/error
 * marker. This suite pins that: a degraded or zero-task orchestration_run
 * response leaves the guard armed (subsequent substantial write still blocks),
 * a real prepared-task response clears it, and Task dispatches (which carry no
 * envelope) still clear it — guarding against the fix over-tightening into a
 * positive allowlist that would require a clean envelope.
 *
 * Also pinned (H9.1, construct-72gqn.8): the awaiting-host case. The MCP
 * default backend returns status:"awaiting-host" with materialized prompts
 * and zero executed work, which must leave the guard armed — not treated as
 * a completed dispatch — until the first orchestration_task_result
 * submission with accepted:true.
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
const HOOK = path.join(ROOT, 'lib', 'hooks', 'orchestration-dispatch-guard.mjs');

let tmpDir;
let repoDir;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dispatch-guard-degraded-'));
  repoDir = path.join(tmpDir, 'repo');
});

after(() => {
  rmTmpDir(tmpDir);
});

beforeEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
  fs.mkdirSync(repoDir, { recursive: true });
});

function withCx() {
  fs.mkdirSync(path.join(repoDir, '.construct'), { recursive: true });
}

function run(payload) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({ cwd: repoDir, ...payload }),
    timeout: 10_000,
  });
}

function bigDoc(lines = 60) {
  return Array.from({ length: lines }, (_, i) => `line ${i} of the strategy deliverable`).join('\n');
}

function classify(track) {
  return run({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__construct__orchestration_policy',
    tool_response: { content: [{ type: 'text', text: JSON.stringify({ track }) }] },
  });
}

function dispatch(toolResponse) {
  return run({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__construct__orchestration_run',
    tool_response: toolResponse,
  });
}

function taskResult(toolResponse) {
  return run({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__construct__orchestration_task_result',
    tool_response: toolResponse,
  });
}

function writeDoc(filePath, content) {
  return run({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoDir, filePath), content },
  });
}

describe('orchestration-dispatch-guard degraded dispatch handling', () => {
  it('leaves the guard armed when the dispatch response is degraded with zero tasks', () => {
    withCx();
    classify('orchestrated');
    const d = dispatch({ degraded: true, tasks: [], status: 'completed' });
    assert.equal(d.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 2, `expected still-blocked; got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /classified this request as ORCHESTRATED/);
  });

  it('clears the guard on a non-degraded dispatch response with prepared tasks', () => {
    withCx();
    classify('orchestrated');
    const d = dispatch({ degraded: false, tasks: [{ id: 't1', role: 'cx-architect', status: 'prepared' }], status: 'completed-prepare-only' });
    assert.equal(d.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected pass after real dispatch; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('clears the guard on a Task dispatch with an empty tool_response', () => {
    withCx();
    classify('orchestrated');
    const d = run({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_response: {} });
    assert.equal(d.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected pass after Task dispatch; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('fails open (clears the guard) on a malformed or absent tool_response', () => {
    withCx();
    classify('orchestrated');
    const d = run({ hook_event_name: 'PostToolUse', tool_name: 'mcp__construct__orchestration_run' });
    assert.equal(d.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected fail-open pass; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('leaves the guard armed on an awaiting-host dispatch response (prompts materialized, nothing executed)', () => {
    withCx();
    classify('orchestrated');
    const d = dispatch({
      status: 'awaiting-host',
      tasks: [{ id: 't1', role: 'cx-architect', status: 'awaiting-host', system: 'persona', user: 'do your part' }],
    });
    assert.equal(d.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 2, `expected still-blocked on awaiting-host; got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /orchestration_task_result/);
  });

  it('does not clear the guard on a rejected orchestration_task_result submission', () => {
    withCx();
    classify('orchestrated');
    dispatch({ status: 'awaiting-host', tasks: [{ id: 't1', role: 'cx-architect', status: 'awaiting-host' }] });
    const t = taskResult({ accepted: false, error: 'unknown task_id', code: 'HOST_RESULT_REJECTED' });
    assert.equal(t.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 2, `expected still-blocked on rejected result; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('clears the guard once an orchestration_task_result submission is accepted', () => {
    withCx();
    classify('orchestrated');
    dispatch({ status: 'awaiting-host', tasks: [{ id: 't1', role: 'cx-architect', status: 'awaiting-host' }] });
    const blocked = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(blocked.status, 2, 'sanity: still armed before the result is submitted');
    const t = taskResult({ accepted: true, run_status: 'awaiting-host', next_task: { task_id: 't2', role: 'cx-engineer' } });
    assert.equal(t.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected pass after accepted task result; got ${r.status}. stderr:\n${r.stderr}`);
  });
});
