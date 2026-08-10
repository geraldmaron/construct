/**
 * tests/orchestration-chain-of-thought.test.mjs — chain-of-thought disclosure.
 *
 * Pins the orchestration.chainOfThought capability end to end. At the worker
 * layer: reasoning is requested only when the mode is not `hidden` (Anthropic
 * extended-thinking budget / OpenRouter `reasoning`), and captured from the
 * response. At the runtime layer the mode routes it — `surface` attaches
 * reasoning to each task (so the CLI, MCP, and dashboard render it),
 * `telemetry_only` writes it to the run trace and never to a task, and `hidden`
 * captures nothing.
 *
 * Trace reads resolve through the machine-scoped state root, so
 * CONSTRUCT_HOME_OVERRIDE is pinned for the whole file to keep them off the real
 * developer machine's $HOME.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTaskViaProvider } from '../lib/orchestration/worker.mjs';
import { runOrchestration, hostAdapterMetadata } from '../lib/orchestration/runtime.mjs';
import { traceDir } from '../lib/worker/trace.mjs';

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };
const REQUEST = { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 };

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cot-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

const dirs = [];
function project(orchestration) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cot-'));
  dirs.push(cwd);
  if (orchestration) fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ version: 1, orchestration }));
  return cwd;
}
test.after(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function anthropicReply(withThinking) {
  const content = [];
  if (withThinking) content.push({ type: 'thinking', thinking: 'I should check the token validation path first.' });
  content.push({ type: 'text', text: 'specialist did the work' });
  return { ok: true, json: async () => ({ content }) };
}

function readTraceEvents(cwd) {
  const dir = traceDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

test('hidden (default) requests no reasoning and captures none', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return anthropicReply(false); };
  const result = await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'x' } }, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl });
  assert.equal(body.thinking, undefined, 'no thinking param in hidden mode');
  assert.equal(result.reasoning, '');
});

test('surface uses adaptive thinking on current models (Opus 4.6+/Sonnet 4.6) and captures the block', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return anthropicReply(true); };
  const result = await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'x' } }, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl, chainOfThought: 'surface' });
  assert.equal(body.thinking?.type, 'adaptive', 'current models require adaptive thinking (enabled+budget_tokens 400s on Opus 4.8/4.7)');
  assert.equal(body.thinking.display, 'summarized', 'display:summarized or the thinking block returns empty');
  assert.equal(body.thinking.budget_tokens, undefined, 'no budget_tokens on adaptive');
  assert.match(result.reasoning, /token validation/);
  assert.equal(result.output, 'specialist did the work');
});

test('surface uses the legacy enabled+budget shape only on older models (Sonnet 4.5)', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return anthropicReply(true); };
  await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'x' } }, model: 'anthropic/claude-sonnet-4-5', provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl, chainOfThought: 'surface' });
  assert.equal(body.thinking?.type, 'enabled');
  assert.ok(body.thinking.budget_tokens > 0);
  assert.ok(body.max_tokens > body.thinking.budget_tokens, 'budget_tokens must be < max_tokens (Anthropic constraint)');
});

test('OpenRouter surface enables reasoning and reads message.reasoning', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'done', reasoning: 'weighed the options' } }] }) }; };
  const result = await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'x' } }, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl, chainOfThought: 'telemetry_only' });
  assert.deepEqual(body.reasoning, { enabled: true }, 'reasoning enabled on the OpenRouter request ({} is a no-op)');
  assert.equal(result.reasoning, 'weighed the options');
});

test('OpenRouter hidden excludes reasoning so default-reasoning models do not leak', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: 'done', reasoning: 'should not surface' } }] }) }; };
  const result = await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'x' } }, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl });
  assert.deepEqual(body.reasoning, { exclude: true }, 'hidden mode excludes reasoning from the response');
  assert.equal(result.reasoning, '', 'no reasoning captured in hidden mode');
});

test('OpenRouter reads structured reasoning_details when no plaintext reasoning', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'done', reasoning_details: [{ type: 'reasoning.text', text: 'step one' }, { type: 'reasoning.summary', summary: 'step two' }] } }] }) });
  const result = await runTaskViaProvider({ task: { role: 'engineer' }, run: { request: { summary: 'x' } }, model: 'openai/gpt-4o-mini', provider: 'openrouter', env: { OPENROUTER_API_KEY: 'k' }, fetchImpl, chainOfThought: 'surface' });
  assert.match(result.reasoning, /step one/);
  assert.match(result.reasoning, /step two/);
});

test('surface mode attaches reasoning to each task and exposes it in host metadata', async () => {
  const cwd = project({ chainOfThought: 'surface' });
  const fetchImpl = async () => anthropicReply(true);
  const run = await runOrchestration(REQUEST, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl });
  assert.equal(run.chainOfThought, 'surface');
  const done = run.tasks.filter((t) => t.status === 'done');
  assert.ok(done.length > 0, 'at least one provider task ran');
  assert.ok(done.every((t) => t.reasoning && /token validation/.test(t.reasoning)), 'every done task carries reasoning');
  const meta = hostAdapterMetadata(run);
  assert.equal(meta.chainOfThought, 'surface');
  assert.ok(meta.tasks.every((t) => t.status !== 'done' || t.reasoning), 'host metadata surfaces reasoning on done tasks');
});

test('telemetry_only records reasoning to the trace but never on the task', async () => {
  const cwd = project({ chainOfThought: 'telemetry_only' });
  const fetchImpl = async () => anthropicReply(true);
  const run = await runOrchestration(REQUEST, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl });
  assert.equal(run.chainOfThought, 'telemetry_only');
  assert.ok(run.tasks.every((t) => t.reasoning == null), 'reasoning is NOT attached to any task in telemetry_only');
  const withReasoning = readTraceEvents(cwd).filter((e) => e.eventType === 'worker.completed' && e.metadata?.reasoning);
  assert.ok(withReasoning.length > 0, 'worker.completed trace carries reasoning in telemetry_only');
  assert.match(withReasoning[0].metadata.reasoning, /token validation/);
});

test('hidden mode (no config) attaches no reasoning and writes none to the trace', async () => {
  const cwd = project();
  const fetchImpl = async () => anthropicReply(true);
  const run = await runOrchestration(REQUEST, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl });
  assert.equal(run.chainOfThought, 'hidden');
  assert.ok(run.tasks.every((t) => t.reasoning == null));
  assert.ok(readTraceEvents(cwd).every((e) => !e.metadata?.reasoning), 'no reasoning written to trace in hidden mode');
});
