/**
 * tests/orchestration-runtime.test.mjs — local orchestration runtime (Mode-A).
 *
 * Pins that the runtime plans a sequenced specialist chain for an orchestrated
 * request, persists a durable run that round-trips through the filesystem store,
 * advances tasks to `prepared` via the inline backend, and reports honest
 * host-adapter metadata. Prompt-only and host-direct requests own no specialist
 * sequence — the runtime records that rather than implying orchestration — and
 * the inline backend marks tasks `prepared` (not executed), the boundary ADR-0020
 * makes explicit.
 *
 * @enforces ADR-0020
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  planRun,
  executeRun,
  runOrchestration,
  startRun,
  hostAdapterMetadata,
  getRun,
  getRuns,
  submitHostTaskResult,
  WORKER_BACKENDS,
} from '../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('orchestrated request plans a specialist chain and prepares every task', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'Refactor the auth module and add a migration; review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  assert.equal(run.status, 'completed-prepare-only');
  assert.equal(run.execution.executionMode, 'construct-orchestrated');
  assert.equal(run.workerBackend, 'inline');
  assert.ok(run.tasks.length >= 2, 'multiple specialists sequenced');
  assert.ok(run.tasks.every((t) => t.status === 'prepared'), 'every task prepared');
  assert.ok(run.tasks.every((t) => t.executor === 'inline:prepared'), 'inline backend prepares, not executes');
  assert.ok(run.tasks.every((t, i) => t.seq === i), 'tasks carry a deterministic sequence');
});

test('a planned run persists durably and round-trips through the store', async () => {
  const cwd = project();
  const planned = await planRun({ request: 'design a system', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }, { env: ENV, cwd });
  assert.equal(planned.status, 'planned');
  const reloaded = await getRun(cwd, planned.runId);
  assert.equal(reloaded.runId, planned.runId);
  assert.equal(reloaded.status, 'planned');
  const completed = await executeRun(cwd, planned.runId, { env: ENV });
  assert.equal(completed.status, 'completed-prepare-only');
  assert.equal((await getRun(cwd, planned.runId)).status, 'completed-prepare-only', 'execution is persisted');
});

test('prompt-only request owns no specialist sequence', async () => {
  const cwd = project();
  const run = await runOrchestration({ request: 'summarize this note', requestedStrategy: 'prompt-only', hostModel: MODEL }, { env: ENV, cwd });
  assert.equal(run.execution.executionMode, 'construct-prompt-only');
  assert.deepEqual(run.tasks, []);
  assert.equal(run.status, 'completed');
});

test('host-direct request owns no specialist sequence and no Construct capabilities', async () => {
  const cwd = project();
  const run = await runOrchestration({ request: 'do it your way', requestedStrategy: 'orchestrated', useConstruct: false, hostModel: MODEL }, { env: ENV, cwd });
  assert.equal(run.execution.executionMode, 'host-direct');
  assert.deepEqual(run.tasks, []);
});

test('hostRole reflects the calling host; cli-direct when none', async () => {
  const cwd = project();
  const viaVscode = await planRun({ request: 'x', requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'VS Code', fileCount: 3 }, { env: ENV, cwd });
  assert.equal(viaVscode.hostRole, 'copilot-mcp');
  const direct = await planRun({ request: 'x', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }, { env: ENV, cwd });
  assert.equal(direct.hostRole, 'cli-direct');
});

test('host-adapter metadata carries the runtime-backed fields and the semantics disclaimer', async () => {
  const cwd = project();
  const run = await runOrchestration({ request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: ENV, cwd });
  const meta = hostAdapterMetadata(run);
  for (const k of ['runId', 'traceId', 'requestedStrategy', 'effectiveStrategy', 'executionMode', 'constructCapabilitiesActive', 'workerBackend', 'hostRole', 'degraded', 'selectedProvider', 'selectedModel', 'tasks', 'warnings', 'semantics']) {
    assert.ok(k in meta, `metadata has ${k}`);
  }
  assert.match(meta.semantics, /does not perform specialist LLM reasoning/i);
  assert.ok(WORKER_BACKENDS.includes(meta.workerBackend));
});

test('a credential value in env never leaks into a run record', async () => {
  const cwd = project();
  const canary = 'sk-orch-CANARY-7777';
  const run = await runOrchestration({ request: 'refactor', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 }, { env: { ...ENV, ANTHROPIC_API_KEY: canary }, cwd });
  assert.ok(!JSON.stringify(run).includes(canary));
  assert.ok(!JSON.stringify(await getRuns(cwd, { env: ENV })).includes(canary));
});

test('inline backend stays the default and prepares, byte-for-byte', async () => {
  const cwd = project();
  const run = await runOrchestration({ request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: ENV, cwd });
  assert.equal(run.workerBackend, 'inline');
  assert.equal(run.status, 'completed-prepare-only');
  assert.ok(run.tasks.every((t) => t.status === 'prepared' && t.executor === 'inline:prepared'));
  assert.ok(run.tasks.every((t) => t.output === null), 'inline records no model output');
});

test('provider backend executes tasks via the model and records real output', async () => {
  const cwd = project();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: `specialist-output-${calls}` }] }) };
  };
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.length >= 2);
  assert.ok(run.tasks.every((t) => t.status === 'done'), 'every provider task done');
  assert.ok(run.tasks.every((t) => /^provider:anthropic:/.test(t.executor)), 'executor records provider+model');
  assert.ok(run.tasks.every((t) => /^specialist-output-/.test(t.output)), 'real model output recorded');
});

test('provider backend records a failed task and completes-with-failures, no crash', async () => {
  const cwd = project();
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const run = await runOrchestration(
    { request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    {
      env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test', CONSTRUCT_PROVIDER_MAX_ATTEMPTS: '1' },
      cwd, workerBackend: 'provider', fetchImpl,
    },
  );
  assert.equal(run.status, 'completed-with-failures');
  assert.ok(run.tasks.every((t) => t.status === 'failed'));
  // A 500 classifies as PROVIDER_SERVER_ERROR (construct-5wkl AC#1), not the
  // prior generic PROVIDER_EXECUTION_FAILED — distinct from a 4xx/auth failure.
  assert.ok(run.tasks.every((t) => t.error?.code === 'PROVIDER_SERVER_ERROR'));
});

test('startRun labels the run record as in-process before returning', async () => {
  const cwd = project();
  const started = await startRun(
    { request: 'design a system', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 3 },
    { env: ENV, cwd },
  );
  assert.equal(started.runMode, 'in-process', 'runMode must be in-process on the returned record');
  const persisted = await getRun(cwd, started.runId, { env: ENV });
  assert.equal(persisted.runMode, 'in-process', 'runMode must be persisted to the store');
});

// ── host worker backend (LMCP host-execution): materialize-only, no model
// call, standing at 'awaiting-host' until every task's result is submitted.

test('host backend materializes every task prompt and stands the run at awaiting-host', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.equal(run.workerBackend, 'host');
  assert.equal(run.status, 'awaiting-host', 'a host-backend run must never report a terminal status while tasks are still pending');
  assert.ok(run.tasks.length >= 2);
  assert.ok(run.tasks.every((t) => t.status === 'awaiting-host'));
  assert.ok(run.tasks.every((t) => t.executor === 'host:awaiting'));
  assert.ok(run.tasks.every((t) => typeof t.hostPrompt?.system === 'string' && t.hostPrompt.system.length > 0));
  assert.ok(run.tasks.every((t) => typeof t.hostPrompt?.user === 'string' && t.hostPrompt.user.length > 0));
  assert.ok(run.tasks.every((t) => t.output === null), 'a materialized-only task carries no output yet');
  assert.equal(run.executionState, 'awaiting-host');

  // The persisted record round-trips the same standing state.
  const reloaded = await getRun(cwd, run.runId, { env: ENV });
  assert.equal(reloaded.status, 'awaiting-host');
});

test('host backend with zero planned tasks (prompt-only) resolves to a real terminal state, not a fake awaiting-host', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'summarize this note', requestedStrategy: 'prompt-only', hostModel: MODEL },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.deepEqual(run.tasks, []);
  assert.notEqual(run.status, 'awaiting-host', 'a run with nothing pending pickup must not stand awaiting-host forever');
});

test('submitHostTaskResult records a host-reported result and drives the awaiting-host chain to completion', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, host: 'OpenCode', fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.ok(run.tasks.length >= 2);

  let last;
  for (const task of run.tasks) {
    last = await submitHostTaskResult(cwd, run.runId, task.id, { output: `result for ${task.role}`, model: 'claude-opus-4', provider: 'anthropic-subscription' }, { env: ENV });
  }
  assert.equal(last.nextTask, null, 'the final submission reports no next task');
  assert.equal(last.run.status, 'completed');
  assert.equal(last.run.executionState, 'executed');
  assert.ok(last.run.tasks.every((t) => t.status === 'done'));
  assert.ok(last.run.tasks.every((t) => t.executor === 'host:primary-plus-subagents'), 'executor records the resolved hostRole (OpenCode), never a bare host: prefix alone');
  // Provenance: host-reported, never presented as a construct-verified provider execution.
  assert.ok(last.run.tasks.every((t) => t.provenanceSource === 'host-reported'));
  assert.ok(last.run.tasks.every((t) => !t.executor.startsWith('provider:')), 'a host-reported task must never carry a provider: executor prefix');
  assert.ok(last.run.tasks.every((t) => t.model === 'claude-opus-4' && t.provider === 'anthropic-subscription'));
  assert.ok(last.run.tasks.every((t) => t.hostPrompt === undefined), 'the materialized prompt is cleared once a real result is recorded');

  const reloaded = await getRun(cwd, run.runId, { env: ENV });
  assert.equal(reloaded.status, 'completed');
});

test('submitHostTaskResult mid-chain returns the next awaiting task\'s materialized prompt', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.ok(run.tasks.length >= 2);
  const { nextTask, run: afterFirst } = await submitHostTaskResult(cwd, run.runId, run.tasks[0].id, { output: 'ok' }, { env: ENV });
  assert.equal(afterFirst.status, 'awaiting-host', 'more tasks remain awaiting host execution');
  assert.equal(nextTask.id, run.tasks[1].id);
  assert.equal(nextTask.status, 'awaiting-host');
  assert.equal(typeof nextTask.hostPrompt.system, 'string');
});

test('submitHostTaskResult with a mix of failed materialization and completed tasks finalizes completed-with-failures', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  assert.ok(run.tasks.length >= 2);

  // Force one already-materialized task into a failed state directly on the
  // persisted record (simulating a task whose materialization failed), then
  // submit real results for the rest — finalization must still resolve to
  // completed-with-failures via the shared finalizeRun logic.
  const { getRun: reload } = await import('../lib/orchestration/runtime.mjs');
  const stored = await reload(cwd, run.runId, { env: ENV });
  stored.tasks[0].status = 'failed';
  stored.tasks[0].executionState = 'failed';
  stored.tasks[0].error = { code: 'HOST_MATERIALIZE_FAILED', message: 'simulated failure' };
  const { resolveRunStore } = await import('../lib/orchestration/store.mjs');
  const { store } = resolveRunStore({ config: {}, env: ENV, cwd });
  await store.saveRun(stored);

  let last;
  for (const task of stored.tasks.slice(1)) {
    last = await submitHostTaskResult(cwd, run.runId, task.id, { output: 'ok' }, { env: ENV });
  }
  assert.equal(last.run.status, 'completed-with-failures');
  assert.equal(last.nextTask, null);
});

test('submitHostTaskResult rejection matrix: unknown run, unknown task, wrong status, empty output, terminal run', async () => {
  const cwd = project();
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd, workerBackend: 'host' },
  );
  const taskId = run.tasks[0].id;

  await assert.rejects(
    () => submitHostTaskResult(cwd, 'run-does-not-exist', taskId, { output: 'x' }, { env: ENV }),
    (err) => err.code === 'RUN_NOT_FOUND',
  );
  await assert.rejects(
    () => submitHostTaskResult(cwd, run.runId, 'no-such-task', { output: 'x' }, { env: ENV }),
    (err) => err.code === 'TASK_NOT_FOUND',
  );
  await assert.rejects(
    () => submitHostTaskResult(cwd, run.runId, taskId, { output: '   ' }, { env: ENV }),
    (err) => err.code === 'HOST_RESULT_EMPTY_OUTPUT',
  );

  await submitHostTaskResult(cwd, run.runId, taskId, { output: 'first submission' }, { env: ENV });
  await assert.rejects(
    () => submitHostTaskResult(cwd, run.runId, taskId, { output: 'resubmission' }, { env: ENV }),
    (err) => err.code === 'TASK_NOT_AWAITING_HOST',
  );

  for (const task of run.tasks.slice(1)) {
    await submitHostTaskResult(cwd, run.runId, task.id, { output: 'ok' }, { env: ENV });
  }
  const final = await getRun(cwd, run.runId, { env: ENV });
  assert.notEqual(final.status, 'awaiting-host');
  await assert.rejects(
    () => submitHostTaskResult(cwd, run.runId, taskId, { output: 'too late' }, { env: ENV }),
    (err) => err.code === 'RUN_ALREADY_TERMINAL',
  );
});
