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
  hostAdapterMetadata,
  getRun,
  getRuns,
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
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed-with-failures');
  assert.ok(run.tasks.every((t) => t.status === 'failed'));
  assert.ok(run.tasks.every((t) => t.error?.code === 'PROVIDER_EXECUTION_FAILED'));
});
