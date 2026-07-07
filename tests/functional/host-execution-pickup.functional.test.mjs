/**
 * tests/functional/host-execution-pickup.functional.test.mjs
 *
 * End-to-end proof of the host worker backend's pickup loop (Phase 1 of LMCP
 * host-execution), driven against the real construct MCP server
 * (lib/mcp/server.mjs) over stdio with the real MCP SDK Client — the same
 * spawn/connect pattern tests/functional/host-mcp-emulation.functional.test.mjs
 * already uses. No LLM is invoked: orchestration_run materializes specialist
 * prompts without executing them, and the test submits results itself,
 * standing in for the host that would otherwise execute those prompts in its
 * own model session.
 *
 * Proves: an MCP-originated orchestration_run with no explicit worker_backend
 * defaults to `host`; the durable run file shows `awaiting-host` with every
 * task's materialized prompt; orchestration_task_result (reached via the
 * `call` gateway — it is a self-registered, non-core tool) records each
 * result and drives the run to a real terminal `completed` state with
 * `executor: host:*` and `provenanceSource: 'host-reported'`; the persisted
 * run file never shows the incident shape this session's construct-neq9.7
 * regression test guards (`degraded:true` + `tasks:[]` + `status:'completed'`);
 * and a run abandoned mid-flight (results never submitted) is honestly
 * reported as still `awaiting-host`, never a fabricated terminal status.
 *
 * @capability orchestration.routing
 * @capability mcp.broker.connection
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { getRun } from '../../lib/orchestration/runtime.mjs';
import { resolveStatePath } from '../../lib/state-root.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');
const MODEL = 'anthropic/claude-sonnet-4-6';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'host-pickup-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(HOME, '.cx'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return { root, HOME, project, cleanup() { rmTmpDir(root); } };
}

async function connect(env, clientInfo = { name: 'OpenCode', version: '1.0.0' }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: env.project,
    env: sterileSpawnEnv({
      HOME: env.HOME,
      USERPROFILE: env.HOME,
      CX_HOME_OVERRIDE: env.HOME,
      XDG_CONFIG_HOME: join(env.HOME, '.config'),
      XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
      XDG_RUNTIME_DIR: join(env.HOME, 'run'),
      CONSTRUCT_DEV_PATH: REPO_ROOT,
      CONSTRUCT_ORCHESTRATION_URL: '',
      OPENROUTER_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      CX_MODEL_REASONING: MODEL,
      CX_MODEL_STANDARD: MODEL,
      CX_MODEL_FAST: MODEL,
    }),
  });
  const client = new Client(clientInfo, { capabilities: {} });
  await client.connect(transport);
  return client;
}

function payload(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text == null) return result;
  try { return JSON.parse(text); } catch { return text; }
}

async function submitTaskResult(client, args) {
  return payload(await client.callTool({ name: 'call', arguments: { tool: 'orchestration_task_result', args } }));
}

// getRun resolves the machine-scoped state root (ADR-0066) via CX_HOME_OVERRIDE
// on process.env directly — the { env } option threaded through getRun's own
// signature is not consulted by that resolution. The subprocess sees the
// sandboxed HOME via sterileSpawnEnv; this process must pin the same override
// around the call, or it reads the real developer machine's state root instead.

async function getRunInSandbox(env, runId) {
  const prev = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = env.HOME;
  try {
    return await getRun(env.project, runId, { env: {} });
  } finally {
    if (prev === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prev;
  }
}

function runFilePathInSandbox(env, runId) {
  const prev = process.env.CX_HOME_OVERRIDE;
  process.env.CX_HOME_OVERRIDE = env.HOME;
  try {
    return resolveStatePath(env.project, 'runtime', 'orchestration', 'runs', `${runId}.json`, { ensureDir: false });
  } finally {
    if (prev === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prev;
  }
}

// The hard invariant this session's construct-neq9.7 regression test
// established (tests/functional/regression-run-02158a157d53.functional.test.mjs):
// a persisted run file must never show degraded:true with an empty task list
// reported as completed. A host-backend run always plans real tasks before it
// can ever reach 'awaiting-host', so this asserts the shape can never arise
// from the new code path either.

function assertNeverSilentDegradedCompleted(run) {
  const degraded = run.degraded === true;
  const emptyTasks = !Array.isArray(run.tasks) || run.tasks.length === 0;
  const completed = run.status === 'completed';
  assert.ok(
    !(degraded && emptyTasks && completed),
    `persisted run must never show degraded:true + tasks:[] + status:'completed' (incident run-02158a157d53 shape); got degraded=${run.degraded} tasks=${run.tasks?.length} status=${run.status}`,
  );
}

test('an MCP-originated orchestration_run with no explicit backend defaults to host and materializes every task prompt', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'refactor the auth module and review for security', file_count: 4, module_count: 2, wait: true },
  }));

  assert.equal(run.status, 'awaiting-host', 'no explicit worker_backend on an MCP-originated run must default to host');
  assert.equal(typeof run.hostInstructions, 'string', 'an awaiting-host result must tell the host what to do next');
  assert.match(run.hostInstructions, /orchestration_task_result/);
  assert.ok(Array.isArray(run.tasks) && run.tasks.length >= 2);
  for (const t2 of run.tasks) {
    assert.equal(t2.status, 'awaiting-host');
    assert.equal(typeof t2.system, 'string');
    assert.ok(t2.system.length > 0);
    assert.equal(typeof t2.user, 'string');
    assert.ok(t2.user.length > 0);
    assert.equal(t2.output, null, 'a materialized-only task carries no output yet');
  }

  const persisted = await getRunInSandbox(env, run.runId);
  assert.equal(persisted.status, 'awaiting-host', 'the durable run file shows the standing awaiting-host state');
  assert.equal(persisted.workerBackend, 'host');
  assert.ok(persisted.tasks.every((task) => task.executor === 'host:awaiting'));
  assert.ok(persisted.tasks.every((task) => typeof task.hostPrompt?.system === 'string' && task.hostPrompt.system.length > 0));
  assertNeverSilentDegradedCompleted(persisted);
});

test('submitting a result for every task via orchestration_task_result (the call gateway) drives the run to a real completed terminal state', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'refactor the auth module and review for security', file_count: 4, module_count: 2, wait: true },
  }));
  assert.equal(run.status, 'awaiting-host');

  let last;
  for (const task of run.tasks) {
    last = await submitTaskResult(client, { run_id: run.runId, task_id: task.id, output: `specialist output for ${task.role}`, model: 'claude-opus-4', provider: 'anthropic-subscription' });
    assert.equal(last.accepted, true);
  }
  assert.equal(last.next_task, null, 'the final submission reports no further task');
  assert.equal(last.run_status, 'completed');

  const persisted = await getRunInSandbox(env, run.runId);
  assert.equal(persisted.status, 'completed', 'the durable run record must reach a real, honest terminal status');
  assert.ok(persisted.tasks.every((task) => task.status === 'done'));
  assert.ok(persisted.tasks.every((task) => task.executor.startsWith('host:')), 'every task executor must record the host: prefix, never provider:');
  assert.ok(persisted.tasks.every((task) => !task.executor.startsWith('provider:')));
  assert.ok(persisted.tasks.every((task) => task.provenanceSource === 'host-reported'), 'host-submitted results must be tagged host-reported, distinguishable from a verified provider execution');
  assert.ok(persisted.tasks.every((task) => task.model === 'claude-opus-4' && task.provider === 'anthropic-subscription'));
  assertNeverSilentDegradedCompleted(persisted);
});

test('a run left awaiting-host (results never submitted) is reported as its real standing state, never a fake terminal one', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'refactor the auth module and review for security', file_count: 4, module_count: 2, wait: true },
  }));
  assert.equal(run.status, 'awaiting-host');

  // Abandonment: no orchestration_task_result call follows. orchestration_status
  // (polled the way a resumed session or `construct orchestrate status` would)
  // must report the same honest standing state, not a fabricated completion.
  const status = payload(await client.callTool({ name: 'orchestration_status', arguments: { run_id: run.runId } }));
  assert.equal(status.status, 'awaiting-host', 'an abandoned run must report its real standing state');
  assert.notEqual(status.status, 'completed');
  assert.equal(typeof status.hostInstructions, 'string', 'a polled awaiting-host run still carries the host instructions to resume it');
  assert.ok(status.tasks.every((t2) => t2.status === 'awaiting-host'));

  const persisted = await getRunInSandbox(env, run.runId);
  assert.equal(persisted.status, 'awaiting-host');
  assertNeverSilentDegradedCompleted(persisted);
});

test('the durable run file for a completed host-backend run round-trips readable via getRun (not just the MCP envelope)', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const client = await connect(env);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'compare oidc vs saml', file_count: 1, module_count: 1, wait: true },
  }));
  assert.equal(run.status, 'awaiting-host');
  for (const task of run.tasks) {
    await submitTaskResult(client, { run_id: run.runId, task_id: task.id, output: 'the answer' });
  }

  const persisted = await getRunInSandbox(env, run.runId);
  assert.equal(persisted.status, 'completed');
  assert.ok(existsSync(runFilePathInSandbox(env, run.runId)), 'the run persists as a durable JSON artifact on disk under the machine-scoped state root');
});
