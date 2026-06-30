/**
 * tests/functional/orchestration-truth-negative.functional.test.mjs
 *
 * Guardrail tests for the orchestration execution-truth boundary (self-audit
 * construct-rr63.7.1, enforcing ADR-0019/0020/0021). The existing suite asserts the
 * positive shape of inline-prepared and provider-executed tasks; these tests pin the
 * inverse and disclosure directions so a regression that lets Construct CLAIM
 * execution it did not perform fails loudly:
 *   - the inline backend never reaches `done`, never sets `inline:executed`, never
 *     records output, and a planned run has not executed at all;
 *   - the mandatory semantics disclaimer rides on every run, inline and provider;
 *   - chain-of-thought disclosure honors the configured mode — `hidden` keeps
 *     specialist reasoning off both task and trace, `surface` puts it on the task
 *     only, `telemetry_only` puts it in the trace only and never on the task;
 *   - the remote (team) HTTP path is opt-in via CONSTRUCT_ORCHESTRATION_URL and
 *     relays the service's run faithfully without fabricating local execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planRun, runOrchestration, hostAdapterMetadata } from '../../lib/orchestration/runtime.mjs';
import { orchestrationRun } from '../../lib/mcp/tools/orchestration-run.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };
const REQUEST = 'refactor the auth module and review for security';

const dirs = [];
function project(config = null) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-truth-'));
  dirs.push(cwd);
  if (config) fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify(config));
  return cwd;
}
function traceMentions(cwd, needle) {
  const td = path.join(cwd, '.cx', 'traces');
  if (!fs.existsSync(td)) return false;
  return fs.readdirSync(td).some((f) => fs.readFileSync(path.join(td, f), 'utf8').includes(needle));
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

// A thinking-block response yields both specialist output and a reasoning trace, so
// the disclosure mode — not the model — decides where the reasoning is allowed to land.

const REASONING = 'THINKING-CANARY-42';
const providerFetch = async () => ({
  ok: true,
  json: async () => ({ content: [{ type: 'thinking', thinking: REASONING }, { type: 'text', text: 'specialist-output' }] }),
});

test('inline backend never claims execution: no done, no inline:executed, no output', async () => {
  const cwd = project();
  const run = await runOrchestration({ request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 }, { env: ENV, cwd });
  assert.equal(run.workerBackend, 'inline');
  assert.ok(run.tasks.length >= 1, 'an orchestrated request plans at least one task');
  assert.ok(run.tasks.every((t) => t.status === 'prepared'), 'inline tasks stay prepared');
  assert.ok(run.tasks.every((t) => t.executor === 'inline:prepared'), 'inline executor never drifts to inline:executed');
  assert.ok(run.tasks.every((t) => t.output === null), 'inline records no model output');
  assert.ok(run.tasks.every((t) => t.reasoning === null), 'inline surfaces no reasoning');
  assert.ok(!run.tasks.some((t) => t.status === 'done'), 'no inline task is ever marked done');
});

test('a planned run has not executed: queued tasks, no executor, no output', async () => {
  const cwd = project();
  const planned = await planRun({ request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: ENV, cwd });
  assert.equal(planned.status, 'planned');
  assert.ok(planned.tasks.length >= 1);
  assert.ok(planned.tasks.every((t) => t.status === 'queued'), 'planned tasks are queued, not run');
  assert.ok(planned.tasks.every((t) => t.executor === null), 'planning assigns no executor');
  assert.ok(planned.tasks.every((t) => t.output === null), 'planning records no output');
});

test('the semantics disclaimer rides on every run, inline and provider', async () => {
  const inlineCwd = project();
  const inline = await runOrchestration({ request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: ENV, cwd: inlineCwd });
  assert.match(hostAdapterMetadata(inline).semantics, /does not perform specialist LLM reasoning/i);

  const providerCwd = project();
  const provider = await runOrchestration(
    { request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd: providerCwd, workerBackend: 'provider', fetchImpl: providerFetch },
  );
  assert.match(hostAdapterMetadata(provider).semantics, /does not perform specialist LLM reasoning/i);
});

test('chain-of-thought hidden keeps reasoning off both task and trace', async () => {
  const cwd = project({ version: 1, orchestration: { chainOfThought: 'hidden' } });
  const run = await runOrchestration({ request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl: providerFetch });
  assert.ok(run.tasks.every((t) => t.status === 'done'));
  assert.ok(run.tasks.every((t) => t.reasoning === null), 'hidden never attaches reasoning to a task');
  assert.equal(traceMentions(cwd, REASONING), false, 'hidden never records reasoning to the trace');
});

test('chain-of-thought surface attaches reasoning to the task only', async () => {
  const cwd = project({ version: 1, orchestration: { chainOfThought: 'surface' } });
  const run = await runOrchestration({ request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl: providerFetch });
  assert.ok(run.tasks.every((t) => t.reasoning === REASONING), 'surface puts reasoning on the task');
  assert.equal(traceMentions(cwd, REASONING), false, 'surface keeps reasoning off the trace');
});

test('chain-of-thought telemetry_only records reasoning to the trace, never the task', async () => {
  const cwd = project({ version: 1, orchestration: { chainOfThought: 'telemetry_only' } });
  const run = await runOrchestration({ request: REQUEST, requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 }, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl: providerFetch });
  assert.ok(run.tasks.every((t) => t.reasoning === null), 'telemetry_only never surfaces reasoning on a task');
  assert.equal(traceMentions(cwd, REASONING), true, 'telemetry_only records reasoning to the trace');
});

test('remote orchestration is opt-in: no URL means in-process, the service is never called', async () => {
  const cwd = project();
  let fetchCalls = 0;
  const spyFetch = async () => { fetchCalls += 1; throw new Error('in-process path must not reach the network'); };
  const res = await orchestrationRun({ request: REQUEST, requested_strategy: 'orchestrated', host_model: MODEL, file_count: 4 }, { env: ENV, cwd, fetchImpl: spyFetch });
  assert.equal(fetchCalls, 0, 'no CONSTRUCT_ORCHESTRATION_URL means no remote call');
  assert.equal(res.service, undefined, 'an in-process run carries no service label');
  assert.ok(res.tasks.every((t) => t.executor === 'inline:prepared'), 'in-process default stays inline-prepared');
});

test('remote path relays the service run faithfully and fabricates no execution', async () => {
  const base = 'https://orch.example.test';
  const remoteRun = {
    runId: 'remote-1', status: 'completed',
    execution: { executionMode: 'construct-orchestrated', degraded: false },
    plan: { intent: 'refactor', specialists: ['cx-architect'] },
    tasks: [{ id: 't1', role: 'cx-architect', status: 'prepared', executor: 'inline:prepared', output: null, reasoning: null, error: null }],
  };
  let posted = null;
  const fetchImpl = async (url, opts) => { posted = { url, opts }; return { ok: true, status: 200, json: async () => ({ data: remoteRun }) }; };
  const res = await orchestrationRun(
    { request: REQUEST, requested_strategy: 'orchestrated', host_model: MODEL, file_count: 4 },
    { env: { ...ENV, CONSTRUCT_ORCHESTRATION_URL: base + '/' }, cwd: project(), fetchImpl },
  );
  assert.match(posted.url, /\/api\/orchestration\/runs$/, 'remote path posts to the service contract');
  assert.equal(res.service, base, 'a remote run is labeled with its service');
  assert.equal(res.tasks[0].executor, 'inline:prepared', 'remote prepared tasks are relayed as prepared');
  assert.equal(res.tasks[0].output, null, 'remote path invents no output for a prepared task');
});

test('remote path relays real provider output without rewriting it', async () => {
  const base = 'https://orch.example.test';
  const remoteRun = {
    runId: 'remote-2', status: 'completed',
    execution: { executionMode: 'construct-orchestrated', degraded: false },
    plan: { intent: 'refactor', specialists: ['cx-architect'] },
    tasks: [{ id: 't1', role: 'cx-architect', status: 'done', executor: 'provider:anthropic:claude-sonnet-4-6', output: 'real-remote-output', reasoning: null, error: null }],
  };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ data: remoteRun }) });
  const res = await orchestrationRun(
    { request: REQUEST, requested_strategy: 'orchestrated', host_model: MODEL, file_count: 4 },
    { env: { ...ENV, CONSTRUCT_ORCHESTRATION_URL: base }, cwd: project(), fetchImpl },
  );
  assert.equal(res.service, base);
  assert.equal(res.tasks[0].status, 'done');
  assert.equal(res.tasks[0].executor, 'provider:anthropic:claude-sonnet-4-6');
  assert.equal(res.tasks[0].output, 'real-remote-output', 'remote provider output is relayed verbatim');
});
