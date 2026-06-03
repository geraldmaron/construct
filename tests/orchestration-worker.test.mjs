/**
 * tests/orchestration-worker.test.mjs — provider worker backend.
 *
 * Pins that the provider backend executes a specialist task by calling the
 * configured provider/model with the persona prompt and the run request, routes
 * Claude-family models to Anthropic and others to OpenRouter, surfaces a
 * structured PROVIDER_KEY_MISSING when no key is present under an explicit
 * (hermetic) env, never leaks a credential canary into the result, and — driven
 * through executeRun — marks tasks `done` with real output and `executor`,
 * records a failing task as `failed` with the run `completed-with-failures`, and
 * never crashes the run.
 *
 * @enforces ADR-0021
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTaskViaProvider, INLINE, PROVIDER, WORKER_BACKEND_SET } from '../lib/orchestration/worker.mjs';
import { runOrchestration } from '../lib/orchestration/runtime.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-worker-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

test('backend constants expose inline and provider', () => {
  assert.deepEqual(WORKER_BACKEND_SET, [INLINE, PROVIDER]);
});

test('provider worker returns specialist output via a mock fetch', async () => {
  const task = { role: 'cx-engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const fetchImpl = async (url, opts) => {
    assert.match(url, /anthropic\.com\/v1\/messages/);
    const body = JSON.parse(opts.body);
    assert.ok(body.system.length > 0, 'persona prompt sent as system');
    assert.match(body.messages[0].content[0].text, /refactor the auth module/);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'engineer result' }] }) };
  };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl });
  assert.equal(result.output, 'engineer result');
  assert.equal(result.provider, 'anthropic');
  assert.equal(result.model, MODEL);
  assert.equal(result.characters, 'engineer result'.length);
});

test('claude-family model routes to Anthropic, others to OpenRouter', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'do it' } };
  let anthropicUrl = null;
  let openrouterUrl = null;
  await runTaskViaProvider({ task, run, model: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: async (url) => { anthropicUrl = url; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'a' }] }) }; } });
  await runTaskViaProvider({ task, run, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl: async (url) => { openrouterUrl = url; return { ok: true, json: async () => ({ choices: [{ message: { content: 'b' } }] }) }; } });
  assert.match(anthropicUrl, /anthropic\.com/);
  assert.match(openrouterUrl, /openrouter\.ai/);
});

test('missing key under explicit env raises PROVIDER_KEY_MISSING', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  await assert.rejects(
    () => runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    (err) => err.code === 'PROVIDER_KEY_MISSING',
  );
});

test('unresolved model raises PROVIDER_MODEL_UNRESOLVED', async () => {
  await assert.rejects(
    () => runTaskViaProvider({ task: { role: 'cx-engineer' }, run: {}, model: null, env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: async () => ({}) }),
    (err) => err.code === 'PROVIDER_MODEL_UNRESOLVED',
  );
});

test('a credential canary never leaks into the worker result', async () => {
  const canary = 'sk-worker-CANARY-9999';
  const result = await runTaskViaProvider({
    task: { role: 'cx-engineer' }, run: { request: { summary: 'x' } }, model: MODEL, provider: 'anthropic',
    env: { ANTHROPIC_API_KEY: canary }, fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'clean' }] }) }),
  });
  assert.ok(!JSON.stringify(result).includes(canary));
});

test('executeRun with provider backend marks tasks done with executor and output', async () => {
  const cwd = project();
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist did the work' }] }) });
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.length >= 1);
  assert.ok(run.tasks.every((t) => t.status === 'done'));
  assert.ok(run.tasks.every((t) => t.executor.startsWith('provider:anthropic:')));
  assert.ok(run.tasks.every((t) => t.output === 'specialist did the work'));
});

test('executeRun with provider backend records a failing task without crashing', async () => {
  const cwd = project();
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  const run = await runOrchestration(
    { request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed-with-failures');
  assert.ok(run.tasks.every((t) => t.status === 'failed'));
  assert.ok(run.tasks.every((t) => t.error?.code === 'PROVIDER_EXECUTION_FAILED'));
  assert.ok(run.tasks.every((t) => t.executor === 'provider:error'));
});
