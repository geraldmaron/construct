/**
 * tests/functional/honest-terminal-states.functional.test.mjs — Honest terminal states for degraded zero-task runs
 *
 * ADR-0020: A run that resolves no model, prepares zero tasks, and sets degraded:true
 * must persist and report an explicit 'degraded' terminal status — never bare 'completed'.
 *
 * Acceptance criteria (construct-fbxv.1):
 * - run.degraded === true, run.tasks.length === 0
 * - shaped.status !== 'completed' (never bare success)
 * - run.status !== 'completed' (stored value is honest too)
 * - shaped.status === 'degraded' (explicit terminal state)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runOrchestration, getRun, submitHostTaskResult } from '../../lib/orchestration/runtime.mjs';
import { shapeRun } from '../../lib/mcp/tools/orchestration-run.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tmpProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-honest-term-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  return cwd;
}

function degradedEnv() {
  // No model keys configured; orchestration should resolve no model and degrade
  return {
    ...process.env,
    CX_TOOLKIT_DIR: REPO_ROOT,
    HOME: REPO_ROOT,
    USERPROFILE: REPO_ROOT,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CX_MODEL_REASONING: '',
    CX_MODEL_STANDARD: '',
    CX_MODEL_FAST: '',
  };
}

test('degraded zero-task run stores honest terminal status "degraded" (not "completed")', async () => {
  const cwd = tmpProject();
  try {
    // Request with no model keys and simple task count -> should resolve no model, degrade, prepare zero tasks
    const run = await runOrchestration(
      { request: 'do something simple', file_count: 1, module_count: 1, wait: true, worker_backend: 'inline' },
      { cwd, env: degradedEnv() },
    );

    // Stored run status is honest
    assert.equal(run.status, 'degraded', `stored run.status must be 'degraded', got '${run.status}'`);
    assert.equal(run.degraded, true, 'run.degraded must be true');
    assert.equal(run.tasks.length, 0, 'run.tasks.length must be 0');

    // Reload from store to confirm persistence
    const reloaded = await getRun(cwd, run.runId);
    assert.ok(reloaded, 'run must be loadable from store');
    assert.equal(reloaded.status, 'degraded', `reloaded run.status must be 'degraded', got '${reloaded.status}'`);
    assert.equal(reloaded.degraded, true, 'reloaded run.degraded must be true');
    assert.equal(reloaded.tasks.length, 0, 'reloaded run.tasks.length must be 0');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('degraded zero-task run shaped status is "degraded" (never bare "completed")', async () => {
  const cwd = tmpProject();
  try {
    const run = await runOrchestration(
      { request: 'do something simple', file_count: 1, module_count: 1, wait: true, worker_backend: 'inline' },
      { cwd, env: degradedEnv() },
    );

    const shaped = shapeRun(run);

    // MCP surface must never report bare 'completed'
    assert.notEqual(shaped.status, 'completed', 'shaped.status must never be bare "completed" for degraded zero-task run');
    assert.equal(shaped.status, 'degraded', `shaped.status must be 'degraded', got '${shaped.status}'`);
    assert.equal(shaped.degraded, true, 'shaped.degraded must be true');
    assert.equal(shaped.tasks.length, 0, 'shaped.tasks.length must be 0');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('normal in-process run with tasks gets "completed-prepare-only"', async () => {
  const cwd = tmpProject();
  const env = {
    ...process.env,
    CX_TOOLKIT_DIR: REPO_ROOT,
    HOME: REPO_ROOT,
    USERPROFILE: REPO_ROOT,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
  };
  try {
    const run = await runOrchestration(
      { request: 'design and implement a new authentication architecture', file_count: 20, module_count: 6, wait: true, worker_backend: 'inline' },
      { cwd, env },
    );

    // Normal orchestrated run with tasks prepared -> completed-prepare-only
    assert.equal(run.status, 'completed-prepare-only', `stored run.status must be 'completed-prepare-only', got '${run.status}'`);
    assert.ok(run.tasks.length > 0, 'run.tasks.length must be > 0');
    assert.ok(run.tasks.every(t => t.status === 'prepared'), 'all tasks must be prepared');

    const shaped = shapeRun(run);
    assert.equal(shaped.status, 'completed-prepare-only', `shaped.status must be 'completed-prepare-only', got '${shaped.status}'`);
    assert.equal(shaped.prepareOnly, true, 'shaped.prepareOnly must be true');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('orchestrationRun MCP tool returns shaped status for degraded zero-task run', async () => {
  const cwd = tmpProject();
  try {
    const { orchestrationRun } = await import('../../lib/mcp/tools/orchestration-run.mjs');
    const result = await orchestrationRun(
      { request: 'do something simple', file_count: 1, module_count: 1, wait: true, worker_backend: 'inline' },
      { cwd, env: degradedEnv() },
    );

    assert.ok(!result.error, `expected a run, got error: ${result.error}`);
    assert.equal(result.status, 'degraded', `MCP orchestrationRun must return shaped status 'degraded', got '${result.status}'`);
    assert.equal(result.degraded, true, 'MCP result.degraded must be true');
    assert.equal(result.tasks.length, 0, 'MCP result.tasks.length must be 0');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

// ── awaiting-host: the host worker backend's non-terminal standing state
// (LMCP host-execution) must never render as completed, degraded, or any
// other terminal taxonomy value — it is its own real, honest status.

test('a host-backend run materializing tasks reports shaped status "awaiting-host", never "completed"', async () => {
  const cwd = tmpProject();
  try {
    const env = {
      ...process.env,
      CX_TOOLKIT_DIR: REPO_ROOT,
      HOME: REPO_ROOT,
      USERPROFILE: REPO_ROOT,
      OPENROUTER_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
      CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
      CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
    };
    const run = await runOrchestration(
      { request: 'design and implement a new authentication architecture', fileCount: 20, moduleCount: 6 },
      { cwd, env, workerBackend: 'host' },
    );

    assert.equal(run.status, 'awaiting-host', `stored run.status must be 'awaiting-host', got '${run.status}'`);
    assert.notEqual(run.status, 'completed');
    assert.notEqual(run.status, 'degraded');

    const shaped = shapeRun(run);
    assert.equal(shaped.status, 'awaiting-host', `shaped.status must be 'awaiting-host', got '${shaped.status}'`);
    assert.notEqual(shaped.status, 'completed', 'awaiting-host must never render as completed');
    assert.notEqual(shaped.status, 'degraded', 'awaiting-host must never render as degraded');
    assert.equal(shaped.prepareOnly, false, 'awaiting-host tasks are not the inline prepare-only state either');

    const reloaded = await getRun(cwd, run.runId);
    assert.equal(reloaded.status, 'awaiting-host', 'the persisted record round-trips the same standing state');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('submitting every task result flips shaped status from awaiting-host to a real completed terminal state', async () => {
  const cwd = tmpProject();
  try {
    const env = {
      ...process.env,
      CX_TOOLKIT_DIR: REPO_ROOT,
      HOME: REPO_ROOT,
      USERPROFILE: REPO_ROOT,
      OPENROUTER_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
      CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
      CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
    };
    const run = await runOrchestration(
      { request: 'design and implement a new authentication architecture', fileCount: 20, moduleCount: 6 },
      { cwd, env, workerBackend: 'host' },
    );
    assert.equal(shapeRun(run).status, 'awaiting-host');

    let last;
    for (const task of run.tasks) {
      last = await submitHostTaskResult(cwd, run.runId, task.id, { output: 'result' }, { env });
    }
    const shapedFinal = shapeRun(last.run);
    assert.equal(shapedFinal.status, 'completed');
    assert.notEqual(shapedFinal.status, 'awaiting-host');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});