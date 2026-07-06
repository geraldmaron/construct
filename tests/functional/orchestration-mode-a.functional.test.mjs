/**
 * tests/functional/orchestration-mode-a.functional.test.mjs — end-to-end Mode-A runtime.
 *
 * Spawns the real `bin/construct orchestrate` binary in an isolated tmpdir and
 * asserts the durable, host-adapter-facing behavior: an orchestrated run plans a
 * specialist chain and writes a run under the machine-scoped state root's
 * `runtime/orchestration/` (ADR-0066), `status` reads it back across process
 * boundaries (resumability without a daemon), and a prompt-only run honestly
 * owns no specialist sequence. HOME is pinned to the tmpdir and provider keys
 * are blanked so the run is hermetic — since HOME == cwd here, the
 * machine-scoped state root also resolves inside the disposable tmpdir.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { deriveProjectKey } from '../../lib/state-root.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'bin', 'construct');
const MODEL = 'anthropic/claude-sonnet-4-6';

function makeProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-fn-'));
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  return cwd;
}

function run(cwd, args, env = {}) {
  return spawnSync('node', [BIN, 'orchestrate', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '', CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL, ...env },
  });
}

test('orchestrate run --json plans a specialist chain and persists a durable run', () => {
  const cwd = makeProject();
  const res = run(cwd, ['run', 'Refactor the auth module and review for security', '--strategy', 'orchestrated', '--host-model', MODEL, '--host', 'VS Code', '--file-count', '4', '--module-count', '2', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const meta = JSON.parse(res.stdout);
  assert.equal(meta.executionMode, 'construct-orchestrated');
  assert.equal(meta.workerBackend, 'inline');
  assert.equal(meta.hostRole, 'copilot-mcp');
  assert.ok(meta.tasks.length >= 2, 'multiple specialists sequenced');
  assert.ok(meta.tasks.every((t) => t.status === 'prepared'));

  const runFile = path.join(cwd, '.construct', 'projects', deriveProjectKey(cwd), 'runtime', 'orchestration', 'runs', `${meta.runId}.json`);
  assert.ok(fs.existsSync(runFile), 'run persisted to the filesystem store');

  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('orchestrate run --worker-backend provider reaches the execution engine, not just the request label', () => {
  const cwd = makeProject();
  const res = run(cwd, ['run', 'Refactor the auth module and add a migration; review for security', '--strategy', 'orchestrated', '--host-model', MODEL, '--file-count', '4', '--module-count', '2', '--worker-backend', 'provider', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const meta = JSON.parse(res.stdout);
  assert.equal(meta.workerBackend, 'provider');
  assert.ok(meta.tasks.length >= 2, 'multiple specialists sequenced');
  // A task executor of `inline:prepared` would mean the CLI flag only ever labeled the
  // run, never actually selected the execution backend (construct-1xlz). Provider
  // execution (attempted here, and failing without a key) proves the opposite.

  assert.ok(meta.tasks.every((t) => t.executor === 'provider:error'), 'provider backend was actually invoked, not inline');
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('orchestrate status reads a run back across a separate process invocation', () => {
  const cwd = makeProject();
  const created = JSON.parse(run(cwd, ['run', 'design a system end to end', '--strategy', 'orchestrated', '--host-model', MODEL, '--file-count', '3', '--json']).stdout);
  const res = run(cwd, ['status', created.runId, '--json']);
  assert.equal(res.status, 0, res.stderr);
  const meta = JSON.parse(res.stdout);
  assert.equal(meta.runId, created.runId);
  assert.equal(meta.status, 'completed-prepare-only');
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('prompt-only run honestly owns no specialist sequence', () => {
  const cwd = makeProject();
  const meta = JSON.parse(run(cwd, ['run', 'summarize this', '--strategy', 'prompt-only', '--host-model', MODEL, '--json']).stdout);
  assert.equal(meta.executionMode, 'construct-prompt-only');
  assert.deepEqual(meta.tasks, []);
  assert.deepEqual(meta.constructCapabilitiesActive, ['prompt-envelope']);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('status with no run id lists recent runs', () => {
  const cwd = makeProject();
  run(cwd, ['run', 'refactor x', '--strategy', 'orchestrated', '--host-model', MODEL, '--file-count', '3', '--json']);
  const res = run(cwd, ['status', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const list = JSON.parse(res.stdout);
  assert.ok(Array.isArray(list) && list.length >= 1);
  assert.ok(list[0].runId && list[0].status);
  fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
