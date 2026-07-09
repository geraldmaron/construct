/**
 * tests/hooks/orchestration-dispatch-guard.test.mjs — backstop hook in isolation.
 *
 * Drives lib/hooks/orchestration-dispatch-guard.mjs with crafted hook payloads
 * in a tmp project and asserts the state machine: an orchestrated verdict arms
 * the guard, a dispatch disarms it, and a substantial deliverable write is
 * blocked (exit 2) only while armed-and-undispatched. Also pins the fail-open
 * behaviors: no .cx, immediate/focused verdict, code paths, small writes, and
 * stale markers all pass.
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-dispatch-guard-'));
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
  fs.mkdirSync(path.join(repoDir, '.cx'), { recursive: true });
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

function writeDoc(filePath, content) {
  return run({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: path.join(repoDir, filePath), content },
  });
}

describe('orchestration-dispatch-guard', () => {
  it('blocks a substantial deliverable when orchestrated verdict is undispatched', () => {
    withCx();
    classify('orchestrated');
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 2, `expected block; got ${r.status}. stderr:\n${r.stderr}`);
    assert.match(r.stderr, /classified this request as ORCHESTRATED/);
    assert.match(r.stderr, /dispatch the chain/);
  });

  it('allows the same write after a dispatch tool runs', () => {
    withCx();
    classify('orchestrated');
    const d = run({ hook_event_name: 'PostToolUse', tool_name: 'mcp__construct__orchestration_run', tool_response: {} });
    assert.equal(d.status, 0);
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected pass after dispatch; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('allows after a Task dispatch', () => {
    withCx();
    classify('orchestrated');
    run({ hook_event_name: 'PostToolUse', tool_name: 'Task', tool_response: {} });
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected pass after Task; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('does not block when the verdict is focused', () => {
    withCx();
    classify('focused');
    const r = writeDoc('docs/terraform-agent-strategy.md', bigDoc());
    assert.equal(r.status, 0, `expected pass on focused; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('does not block when the verdict is immediate', () => {
    withCx();
    classify('immediate');
    const r = writeDoc('docs/note.md', bigDoc());
    assert.equal(r.status, 0);
  });

  it('does not block a small write even when armed', () => {
    withCx();
    classify('orchestrated');
    const r = writeDoc('docs/tiny.md', 'one short line');
    assert.equal(r.status, 0);
  });

  it('does not block code files even when armed', () => {
    withCx();
    classify('orchestrated');
    const r = run({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: path.join(repoDir, 'lib/thing.mjs'), content: bigDoc() },
    });
    assert.equal(r.status, 0, `code must pass; got ${r.status}. stderr:\n${r.stderr}`);
  });

  it('does not block routine planning/tracking docs even when armed', () => {
    withCx();
    classify('orchestrated');
    for (const f of ['plan.md', 'CHANGELOG.md', 'README.md']) {
      const r = writeDoc(f, bigDoc());
      assert.equal(r.status, 0, `${f} must pass; got ${r.status}`);
    }
  });

  it('fails open when the project has no .cx', () => {
    classify('orchestrated');
    const r = writeDoc('docs/strategy.md', bigDoc());
    assert.equal(r.status, 0, 'no .cx → never block');
  });

  it('disarms on a stale marker', () => {
    withCx();
    classify('orchestrated');
    const sp = path.join(repoDir, '.cx', 'runtime', 'orchestration-guard.json');
    const stale = JSON.parse(fs.readFileSync(sp, 'utf8'));
    stale.ts = 1; // far in the past
    fs.writeFileSync(sp, JSON.stringify(stale));
    const r = writeDoc('docs/strategy.md', bigDoc());
    assert.equal(r.status, 0, 'stale marker must not block');
  });

  it('a fresh focused classification clears a prior orchestrated arm', () => {
    withCx();
    classify('orchestrated');
    classify('focused');
    const r = writeDoc('docs/strategy.md', bigDoc());
    assert.equal(r.status, 0, 'reclassification disarms');
  });

  it('fails open on malformed stdin', () => {
    const r = spawnSync(process.execPath, [HOOK], { encoding: 'utf8', input: 'not json{', timeout: 10_000 });
    assert.equal(r.status, 0);
  });
});
