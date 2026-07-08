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

import { runTaskViaProvider, materializeTaskPrompt, _resetPackRegistryCache, INLINE, PROVIDER, HOST, WORKER_BACKEND_SET } from '../lib/orchestration/worker.mjs';
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

// runOrchestration (driven via executeRun in several tests below) resolves
// the run store through the machine-scoped state root (ADR-0066), which
// reads CX_HOME_OVERRIDE from real process.env directly — the ENV bag above
// only feeds model-tier lookups. Pin it for the whole file so these runs
// never write into the real developer machine's ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-orch-worker-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

test('backend constants expose inline, provider, and host', () => {
  assert.deepEqual(WORKER_BACKEND_SET, [INLINE, PROVIDER, HOST]);
});

// ── materializeTaskPrompt (LMCP host-execution): the shared prompt+provenance
// resolution the provider executor and the host worker backend both call —
// pinned independently of any provider/model call so a host-backend task's
// materialized prompt is provably the same shape a provider task resolves.

test.beforeEach(() => _resetPackRegistryCache());

test('materializeTaskPrompt resolves persona content and provenance for a role every pack declares', () => {
  const task = { role: 'cx-engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' }, execution: { deploymentMode: 'solo' } };
  const prompt = materializeTaskPrompt({ task, run });
  assert.match(prompt.system, /engineer/i);
  assert.match(prompt.user, /refactor the auth module/);
  assert.match(prompt.user, /implement the change/);
  assert.equal(prompt.specialistId, 'cx-engineer');
  assert.equal(prompt.personaAvailable, true);
  assert.equal('degraded' in prompt, false, 'no degraded flag on a healthy persona resolution');
  assert.equal(typeof prompt.promptVersion, 'string');
  assert.ok(Array.isArray(prompt.toolGrants));
});

test('materializeTaskPrompt degrades visibly in solo mode for an unknown role (personaAvailable:false)', () => {
  const task = { role: 'cx-totally-unknown-specialist' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'solo' } };
  const prompt = materializeTaskPrompt({ task, run });
  assert.equal(prompt.personaAvailable, false);
  assert.equal(prompt.degraded, 'persona-fallback');
  assert.equal(prompt.packId, null);
  assert.match(prompt.system, /totally-unknown-specialist/);
});

test('materializeTaskPrompt refuses outright (PERSONA_UNAVAILABLE) for an unknown role in team/enterprise mode', () => {
  const task = { role: 'cx-totally-unknown-specialist' };
  for (const deploymentMode of ['team', 'enterprise']) {
    const run = { request: { summary: 'x' }, execution: { deploymentMode } };
    assert.throws(
      () => materializeTaskPrompt({ task, run }),
      (err) => err.code === 'PERSONA_UNAVAILABLE',
      `expected PERSONA_UNAVAILABLE under ${deploymentMode} mode`,
    );
  }
});

test('materializeTaskPrompt and the provider executor resolve byte-identical system/user prompts for the same task', async () => {
  const task = { role: 'cx-engineer', reason: 'implement the change', handoffContract: null };
  const run = { request: { summary: 'refactor the auth module' } };
  const prompt = materializeTaskPrompt({ task, run, env: { ANTHROPIC_API_KEY: 'sk-test' } });

  let captured = null;
  const fetchImpl = async (_url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  };
  await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl });

  assert.equal(captured.system, prompt.system, 'the provider path must send exactly the materialized system prompt');
  assert.equal(captured.messages[0].content[0].text, prompt.user, 'the provider path must send exactly the materialized user prompt');
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

test('an openrouter/ slug for a claude model routes to OpenRouter, not direct Anthropic (construct-olpf)', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'do it' } };
  let routedUrl = null;
  await runTaskViaProvider({
    task, run, model: 'openrouter/anthropic/claude-opus-4-6', provider: 'openrouter',
    env: { OPENROUTER_API_KEY: 'k', ANTHROPIC_API_KEY: 'must-not-be-used' },
    fetchImpl: async (url) => { routedUrl = url; return { ok: true, json: async () => ({ choices: [{ message: { content: 'b' } }] }) }; },
  });
  assert.match(routedUrl, /openrouter\.ai/, 'openrouter/-prefixed claude slug must go through OpenRouter');
  assert.doesNotMatch(routedUrl, /anthropic\.com/);
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
    {
      env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test', CONSTRUCT_PROVIDER_MAX_ATTEMPTS: '1' },
      cwd, workerBackend: 'provider', fetchImpl,
    },
  );
  assert.equal(run.status, 'completed-with-failures');
  assert.ok(run.tasks.every((t) => t.status === 'failed'));
  // A 429 classifies as PROVIDER_RATE_LIMITED (construct-5wkl AC#1), a stable
  // code distinct from a 5xx or an auth failure.
  assert.ok(run.tasks.every((t) => t.error?.code === 'PROVIDER_RATE_LIMITED'));
  assert.ok(run.tasks.every((t) => t.executor === 'provider:error'));
});

// construct-5wkl: a 2xx transport response is not task success. These pin that
// worker.mjs classifies each unusable-content shape into its own stable code
// (AC#1/#7) so runtime.mjs's existing catch path records the task 'failed'
// with that code rather than 'done' with hollow output (AC#2).

test('empty content on a 2xx response raises PROVIDER_EMPTY_CONTENT, task never marked done', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  await assert.rejects(
    () => runTaskViaProvider({
      task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ stop_reason: 'stop_sequence', content: [] }) }),
    }),
    (err) => err.code === 'PROVIDER_EMPTY_CONTENT',
  );
});

test('a content_filter finish reason raises PROVIDER_CONTENT_FILTERED (non-retryable)', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  const calls = { n: 0 };
  await assert.rejects(
    () => runTaskViaProvider({
      task, run, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' },
      fetchImpl: async () => { calls.n += 1; return { ok: true, json: async () => ({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }) }; },
    }),
    (err) => err.code === 'PROVIDER_CONTENT_FILTERED',
  );
  assert.equal(calls.n, 1, 'a content-policy refusal must never be retried');
});

test('a reasoning-only response (empty visible content, non-empty reasoning) raises PROVIDER_REASONING_ONLY', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  await assert.rejects(
    () => runTaskViaProvider({
      task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k' }, chainOfThought: 'surface',
      fetchImpl: async () => ({ ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: 'a long chain of reasoning that consumed the whole budget' }] }) }),
    }),
    (err) => err.code === 'PROVIDER_REASONING_ONLY',
  );
});

test('OpenRouter reasoning mode reserves extra output budget so a real answer still fits (construct-5wkl AC#6)', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  let sentMaxTokens = null;
  const result = await runTaskViaProvider({
    task, run, model: 'openrouter/qwen/qwen3-coder', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, chainOfThought: 'surface',
    fetchImpl: async (url, opts) => {
      sentMaxTokens = JSON.parse(opts.body).max_tokens;
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'the answer', reasoning: 'brief reasoning' } }] }) };
    },
  });
  assert.equal(result.output, 'the answer');
  assert.ok(sentMaxTokens > 2048, 'reasoning mode must request more than the base output budget');
});

test('a malformed OpenRouter response (no choices) raises PROVIDER_MALFORMED_RESPONSE', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  await assert.rejects(
    () => runTaskViaProvider({
      task, run, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' },
      fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'weird-shape', choices: undefined }) }),
    }),
    (err) => err.code === 'PROVIDER_MALFORMED_RESPONSE',
  );
});

test('a timeout raises PROVIDER_TIMEOUT (retryable) and retries until it succeeds', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  let calls = 0;
  const result = await runTaskViaProvider({
    task, run, model: MODEL, provider: 'anthropic',
    env: { ANTHROPIC_API_KEY: 'k', CONSTRUCT_PROVIDER_RETRY_BASE_MS: '1' },
    fetchImpl: async () => {
      calls += 1;
      if (calls < 2) { const err = new Error('provider timed out after 1ms'); err.name = 'TimeoutError'; throw err; }
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'recovered after retry' }] }) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.output, 'recovered after retry');
  assert.equal(result.providerMeta.retryCount, 1);
});

test('a 500 recovers on the second attempt (successful retry) and the run completes clean', async () => {
  const cwd = project();
  // Multiple specialist tasks share one fetchImpl; key the "fail once" behavior
  // per distinct system prompt (persona) rather than a global call count, so
  // every task independently sees one failure then a recovery.
  const failedOnce = new Set();
  const fetchImpl = async (url, opts) => {
    const system = JSON.parse(opts.body).system;
    if (!failedOnce.has(system)) {
      failedOnce.add(system);
      return { ok: false, status: 500, text: async () => 'boom' };
    }
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'recovered' }] }) };
  };
  const run = await runOrchestration(
    { request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test', CONSTRUCT_PROVIDER_RETRY_BASE_MS: '1' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.every((t) => t.status === 'done'));
  assert.ok(run.tasks.every((t) => t.output === 'recovered'));
  assert.ok(run.tasks.every((t) => t.providerMeta?.retryCount >= 1), 'the recorded metadata shows a retry happened');
});

test('provider metadata (provider/model/finishReason/usage/elapsedMs) rides a successful task', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' } };
  const result = await runTaskViaProvider({
    task, run, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' },
    fetchImpl: async () => ({ ok: true, json: async () => ({
      choices: [{ finish_reason: 'stop', native_finish_reason: 'STOP', message: { content: 'ok' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }) }),
  });
  assert.equal(result.providerMeta.provider, 'openrouter');
  assert.equal(result.providerMeta.model, 'openai/gpt-4o-mini');
  assert.equal(result.providerMeta.finishReason, 'stop');
  assert.equal(result.providerMeta.nativeFinishReason, 'STOP');
  assert.deepEqual(result.providerMeta.usage, { promptTokens: 12, completionTokens: 3, totalTokens: 15 });
  assert.equal(typeof result.providerMeta.elapsedMs, 'number');
  assert.equal(result.providerMeta.retryCount, 0);
});
