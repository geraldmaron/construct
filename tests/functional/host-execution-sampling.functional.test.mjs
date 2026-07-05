/**
 * tests/functional/host-execution-sampling.functional.test.mjs
 *
 * End-to-end proof of the sampling worker backend (Phase 2 of LMCP
 * host-execution): when the connected MCP client declares the `sampling`
 * capability at initialize time, construct-mcp drives the awaiting-host loop
 * itself via server.createMessage (lib/orchestration/host-sampling.mjs)
 * instead of leaving each materialized prompt for the calling agent to
 * execute and submit back through orchestration_task_result. Driven against
 * the real construct MCP server over stdio with a real MCP SDK Client that
 * registers a `sampling/createMessage` handler — same spawn/connect pattern as
 * tests/functional/host-mcp-emulation.functional.test.mjs and
 * host-execution-pickup.functional.test.mjs.
 *
 * Verified feasible against the installed SDK
 * (@modelcontextprotocol/sdk@1.29.0): Server#createMessage and
 * Server#getClientCapabilities both exist (see
 * lib/orchestration/host-sampling.mjs's header for the exact file:line this
 * was checked against).
 *
 * @capability orchestration.routing
 * @capability mcp.broker.connection
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { getRun } from '../../lib/orchestration/runtime.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO_ROOT, 'lib', 'mcp', 'server.mjs');
const MODEL = 'anthropic/claude-sonnet-4-6';

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'host-sampling-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(join(HOME, '.cx'), { recursive: true });
  mkdirSync(join(project, '.cx'), { recursive: true });
  return { root, HOME, project, cleanup() { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

function baseSpawnEnv(env) {
  return sterileSpawnEnv({
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
  });
}

function payload(result) {
  const text = result?.content?.find((c) => c.type === 'text')?.text;
  if (text == null) return result;
  try { return JSON.parse(text); } catch { return text; }
}

test('a client declaring the sampling capability drives the awaiting-host loop itself; the run completes in one call', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: env.project, env: baseSpawnEnv(env) });
  const client = new Client({ name: 'VS Code', version: '1.0.0' }, { capabilities: { sampling: {} } });

  let samplingCalls = 0;
  const samplingRequests = [];
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    samplingCalls += 1;
    samplingRequests.push(request.params);
    return {
      model: 'client-simulated-model-v1',
      stopReason: 'endTurn',
      role: 'assistant',
      content: { type: 'text', text: `sampled specialist output #${samplingCalls}` },
    };
  });
  await client.connect(transport);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'refactor the auth module and review for security', file_count: 4, module_count: 2, wait: true },
  }));

  assert.equal(run.status, 'completed', 'a sampling-capable client must drive the run to completion in the same call, no manual pickup needed');
  assert.ok(!('hostInstructions' in run), 'a run the server already drove to completion carries no pending pickup instructions');
  assert.ok(Array.isArray(run.tasks) && run.tasks.length >= 2);
  assert.equal(samplingCalls, run.tasks.length, 'exactly one sampling call per specialist task');
  assert.ok(run.tasks.every((t2) => t2.status === 'done'));
  assert.ok(run.tasks.every((t2) => /^sampled specialist output #\d+$/.test(t2.output)));

  // Every sampling request carried the task's real materialized persona prompt
  // as systemPrompt, and the run's user turn as the message content — the
  // server relayed the same prompt a pickup-loop host would have received.
  for (const req of samplingRequests) {
    assert.equal(typeof req.systemPrompt, 'string');
    assert.ok(req.systemPrompt.length > 0);
    assert.ok(Array.isArray(req.messages) && req.messages.length === 1);
    assert.equal(req.messages[0].role, 'user');
  }

  const persisted = await getRun(env.project, run.runId, { env: {} });
  assert.equal(persisted.status, 'completed');
  assert.ok(persisted.tasks.every((t2) => t2.status === 'done'));
  assert.ok(persisted.tasks.every((t2) => t2.executor.startsWith('host:')));
  assert.ok(persisted.tasks.every((t2) => t2.provenanceSource === 'host-reported'), 'client-sampled output is still host-reported, never presented as a construct-verified provider execution');
  assert.ok(persisted.tasks.every((t2) => t2.provider === 'mcp-sampling'));
  assert.ok(persisted.tasks.every((t2) => t2.model === 'client-simulated-model-v1'));
});

test('a client with no sampling capability falls back to the pickup loop (awaiting-host), never a forced sampling call', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: env.project, env: baseSpawnEnv(env) });
  const client = new Client({ name: 'OpenCode', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'compare oidc vs saml', file_count: 1, module_count: 1, wait: true },
  }));

  assert.equal(run.status, 'awaiting-host', 'no sampling capability declared must fall back to the Phase 1 pickup loop');
  assert.equal(typeof run.hostInstructions, 'string');
});

test('CONSTRUCT config orchestration.hostExecution=pickup forces the pickup loop even when the client declares sampling', async (t) => {
  const env = sandbox();
  t.after(() => env.cleanup());
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(env.project, 'construct.config.json'), JSON.stringify({ version: 1, orchestration: { hostExecution: 'pickup' } }));

  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: env.project, env: baseSpawnEnv(env) });
  const client = new Client({ name: 'VS Code', version: '1.0.0' }, { capabilities: { sampling: {} } });
  let samplingCalls = 0;
  client.setRequestHandler(CreateMessageRequestSchema, async () => {
    samplingCalls += 1;
    return { model: 'm', stopReason: 'endTurn', role: 'assistant', content: { type: 'text', text: 'x' } };
  });
  await client.connect(transport);
  t.after(() => client.close());

  const run = payload(await client.callTool({
    name: 'orchestration_run',
    arguments: { request: 'compare oidc vs saml', file_count: 1, module_count: 1, wait: true },
  }));

  assert.equal(run.status, 'awaiting-host', 'orchestration.hostExecution=pickup must force the pickup loop regardless of client capability');
  assert.equal(samplingCalls, 0, 'a forced-pickup config must never issue a sampling request');
});
