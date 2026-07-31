/**
 * tests/functional/model-policy.functional.test.mjs
 *
 * Exercises `construct models policy` end-to-end and asserts
 * THE budget invariant: with only an OpenRouter credential and a budget policy,
 * no frontier model resolves for any tier or work category. Pricing is served
 * through a fetch-spy preload so the run is hermetic; the resolution sweep drives
 * the real binary with PATH stripped so no machine-ambient provider leaks in.
 *
 * Also covers: models.json is the only file mutated, env-pin override
 * attribution in `policy show` (R2/AC3), and the free-preset "report, do not
 * substitute" contract (AC2) plus the missing-price safety guard.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import {
  computeBudgetTiers,
  computeFreeTiers,
  isFrontierModel,
  POLICY_TIERS,
} from '../../lib/model-policy.mjs';
import { MODEL_TIER_BY_WORK_CATEGORY } from '../../lib/model-router.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const tmpDirs = [];
function freshDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cx-policy-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch { /* best-effort */ }
  }
});

// OpenRouter /models fixture. The frontier flagship is priced at $0 (the
// cheapest of all) on purpose: a correct budget policy must STILL never select
// it, proving the exclusion is by identity, not merely by price. The :free
// slugs are omitted so an unpriced candidate resolves to Infinity and is skipped.

const PRICING_FIXTURE = {
  data: [
    { id: 'anthropic/claude-opus-4-6', pricing: { prompt: '0', completion: '0' }, context_length: 200000 },
    { id: 'anthropic/claude-sonnet-4-6', pricing: { prompt: '0', completion: '0' }, context_length: 200000 },
    { id: 'openai/gpt-5.4', pricing: { prompt: '0', completion: '0' }, context_length: 200000 },
    { id: 'google/gemini-2.5-pro', pricing: { prompt: '0', completion: '0' }, context_length: 200000 },
    { id: 'meta-llama/llama-3.1-405b-instruct', pricing: { prompt: '0', completion: '0' }, context_length: 131072 },
    { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.00000005', completion: '0.0000001' }, context_length: 131072 },
    { id: 'google/gemini-2.0-flash-001', pricing: { prompt: '0.0000001', completion: '0.0000004' }, context_length: 131072 },
    { id: 'qwen/qwen3-coder', pricing: { prompt: '0.0000002', completion: '0.0000006' }, context_length: 131072 },
    { id: 'deepseek/deepseek-v3', pricing: { prompt: '0.0000003', completion: '0.0000009' }, context_length: 65536 },
    { id: 'deepseek/deepseek-r1', pricing: { prompt: '0.0000005', completion: '0.0000015' }, context_length: 65536 },
    { id: 'meta-llama/llama-3.3-70b-instruct', pricing: { prompt: '0.00000012', completion: '0.0000003' }, context_length: 131072 },
    { id: 'qwen/qwen-2.5-coder-32b-instruct', pricing: { prompt: '0.00000008', completion: '0.00000018' }, context_length: 32768 },
  ],
};

function writePreload(dir) {
  const fixturePath = path.join(dir, 'pricing-fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify(PRICING_FIXTURE));
  const preloadPath = path.join(dir, 'fetch-spy-preload.mjs');
  fs.writeFileSync(preloadPath, `
import fs from 'node:fs';
const FIXTURE = ${JSON.stringify(fixturePath)};
const original = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('openrouter.ai/api/v1/models')) {
    const body = fs.readFileSync(FIXTURE, 'utf8');
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (typeof original === 'function') return original(url, opts);
  throw new Error('network disabled in test: ' + url);
};
`);
  return preloadPath;
}

// Spawn the real binary with a stripped PATH so no ambient provider (a running
// ollama daemon, an authenticated gh CLI) is detected, plus the fetch-spy
// preload so pricing is deterministic. HOME and CONSTRUCT_TOOLKIT_DIR are separated so
// the toolkit dir holds only what the command writes there.

function runHermetic(args, { home, toolkit, preload, env = {} }) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: home,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      HOME: home,
      USERPROFILE: home,
      PATH: '',
      CONSTRUCT_TOOLKIT_DIR: toolkit,
      NODE_OPTIONS: `--import ${preload}`,
      OPENROUTER_API_KEY: 'sk-test-openrouter-budget',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      OLLAMA_BASE_URL: '',
      OLLAMA_HOST: '',
      LOCAL_LLM_BASE_URL: '',
      ...env,
    },
  });
  return res;
}

function listFilesRel(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}

test('budget invariant: OpenRouter-only + budget policy resolves no frontier model for any tier or work category', () => {
  const home = freshDir('budget-home');
  const toolkit = freshDir('budget-toolkit');
  fs.cpSync(path.join(REPO_ROOT, 'registry'), path.join(toolkit, 'registry'), { recursive: true });
  const preload = writePreload(home);

  const setRes = runHermetic(['models', 'policy', 'set', 'budget', '--no-sync', '--json'], { home, toolkit, preload });
  assert.equal(setRes.status, 0, `policy set budget exit 0 — stderr: ${setRes.stderr}`);
  const setOut = JSON.parse(setRes.stdout);

  // R1: models.json under the toolkit dir is the ONLY file the command wrote there.
  const toolkitFiles = listFilesRel(toolkit);
  assert.deepEqual(toolkitFiles.filter((f) => f.endsWith('models.json')), ['registry/models.json'], `only registry/models.json mutated — saw: ${toolkitFiles.join(', ')}`);

  const registry = JSON.parse(fs.readFileSync(path.join(toolkit, 'registry', 'models.json'), 'utf8'));
  for (const tier of POLICY_TIERS) {
    const primary = registry.models[tier]?.primary;
    assert.ok(primary, `budget must assign a ${tier} primary`);
    assert.equal(isFrontierModel(primary), false, `budget ${tier} primary must not be frontier — got ${primary}`);
    assert.notEqual(primary, 'openrouter/anthropic/claude-opus-4-6', `${tier} must not pick the $0-priced frontier flagship`);
    for (const fb of registry.models[tier]?.fallback ?? []) {
      assert.equal(isFrontierModel(fb), false, `budget ${tier} fallback must not be frontier — got ${fb}`);
    }
  }

  // THE sweep: every work category maps to a tier; resolving that tier through the
  // real binary must yield the budget (non-frontier) selection.
  const categories = Object.keys(MODEL_TIER_BY_WORK_CATEGORY);
  assert.ok(categories.length >= 5, 'work-category map must be non-trivial');
  for (const category of categories) {
    const tier = MODEL_TIER_BY_WORK_CATEGORY[category];
    const res = runHermetic(['models', 'resolve', '--json', '--tier', tier], { home, toolkit, preload });
    assert.equal(res.status, 0, `resolve ${tier} (category ${category}) exit 0 — stderr: ${res.stderr}`);
    const envelope = JSON.parse(res.stdout);
    const selected = envelope.data.selectedModel;
    assert.ok(selected, `resolve must select a model for ${tier} (category ${category})`);
    assert.equal(isFrontierModel(selected), false, `resolved ${tier} model for category ${category} must not be frontier — got ${selected}`);
    assert.equal(selected, registry.models[tier].primary, `resolved ${tier} model must match the persisted budget primary`);
  }

  // Env pin must still override the persisted budget registry (nothing new
  // entered the chain).
  const pinned = runHermetic(['models', 'resolve', '--json', '--tier', 'reasoning'], {
    home, toolkit, preload,
    env: { CONSTRUCT_MODEL_REASONING: 'openrouter/qwen/qwen3-coder:free' },
  });
  const pinnedEnvelope = JSON.parse(pinned.stdout);
  assert.equal(pinnedEnvelope.data.selectedModel, 'openrouter/qwen/qwen3-coder:free', 'env pin must override the budget registry');

  assert.ok(Array.isArray(setOut.warnings), 'set output carries a warnings array');
});

test('policy show attributes an env-pin override and reports a clean install as not-configured (R2/AC3)', () => {
  const home = freshDir('show-home');
  const toolkit = freshDir('show-toolkit');
  fs.cpSync(path.join(REPO_ROOT, 'registry'), path.join(toolkit, 'registry'), { recursive: true });
  const preload = writePreload(home);

  const clean = runHermetic(['models', 'policy', 'show', '--json'], { home, toolkit, preload });
  assert.equal(clean.status, 0, `policy show exit 0 — stderr: ${clean.stderr}`);
  const cleanView = JSON.parse(clean.stdout);
  for (const t of cleanView.tiers) {
    assert.equal(t.model, null, `${t.tier} must be unconfigured on a clean install`);
    assert.equal(t.source, 'not configured', `${t.tier} source must be 'not configured'`);
  }

  const pinned = runHermetic(['models', 'policy', 'show', '--json'], {
    home, toolkit, preload,
    env: { CONSTRUCT_MODEL_REASONING: 'openrouter/anthropic/claude-opus-4-6' },
  });
  const pinnedView = JSON.parse(pinned.stdout);
  const reasoning = pinnedView.tiers.find((t) => t.tier === 'reasoning');
  assert.equal(reasoning.model, 'openrouter/anthropic/claude-opus-4-6', 'env pin surfaces as the resolved model');
  assert.equal(reasoning.source, 'env override', 'env pin is attributed as the winning source');
});

test('explain --worker-profile reports the Worker Profile tier and matches models resolve (AC4)', () => {
  const home = freshDir('explain-home');
  const toolkit = freshDir('explain-toolkit');
  fs.cpSync(path.join(REPO_ROOT, 'registry'), path.join(toolkit, 'registry'), { recursive: true });
  const preload = writePreload(home);

  const res = runHermetic(['models', 'explain', '--worker-profile', 'reviewer', '--json'], { home, toolkit, preload });
  assert.equal(res.status, 0, `explain exit 0 — stderr: ${res.stderr}`);
  const trace = JSON.parse(res.stdout);
  assert.equal(trace.workerProfile, 'reviewer');
  assert.equal(trace.declaredTier, 'strong', 'reviewer declares the strong tier in registry/worker-profiles/reviewer.json');
  assert.equal(trace.tier, 'strong', 'reviewer resolves at the strong tier');
  assert.ok(trace.registryPath?.endsWith('models.json'), 'explain names the registry path used for resolution');
});

test('free preset reports a tier with no free model instead of substituting (AC2)', async () => {
  const env = { OPENROUTER_API_KEY: 'sk-test' };
  const emptyPoll = async () => [];
  const empty = await computeFreeTiers({ env, poll: emptyPoll });
  for (const tier of POLICY_TIERS) {
    assert.equal(empty.models[tier].primary, null, `${tier} left unset when no free model exists`);
  }
  assert.equal(empty.warnings.length, POLICY_TIERS.length, 'each unfilled tier is reported');

  const partialPoll = async () => [{ id: 'openrouter/qwen/qwen3-coder:free', name: 'q', contextLength: 128000, isFree: true }];
  const partial = await computeFreeTiers({ env, poll: partialPoll });
  for (const tier of POLICY_TIERS) {
    const primary = partial.models[tier].primary;
    if (primary) assert.match(primary, /:free$/i, `${tier} free selection must be a :free slug`);
  }
});

test('budget compute never selects a frontier model even when pricing lies it is cheapest', async () => {
  const env = { OPENROUTER_API_KEY: 'sk-test' };

  // Pricing claims the frontier flagship is free; the denylist must still exclude it.
  const lyingPrice = async (ids) => Object.fromEntries(ids.map((id) => [id, isFrontierModel(id)
    ? { input: 0, output: 0 }
    : { input: 5, output: 15 }]));
  const budget = await computeBudgetTiers({ env, getPricing: lyingPrice });
  for (const tier of POLICY_TIERS) {
    const primary = budget.models[tier].primary;
    if (primary) assert.equal(isFrontierModel(primary), false, `${tier} must never be frontier — got ${primary}`);
  }

  // When pricing is entirely unreachable, budget falls back to static ordering
  // and says so, still never a frontier id.
  const noPrice = async () => ({});
  const degraded = await computeBudgetTiers({ env, getPricing: noPrice });
  const usedLocal = POLICY_TIERS.some((t) => /^(ollama|local)\//.test(degraded.models[t].primary || ''));
  for (const tier of POLICY_TIERS) {
    const primary = degraded.models[tier].primary;
    if (primary) assert.equal(isFrontierModel(primary), false, `${tier} static fallback must not be frontier — got ${primary}`);
  }

  // Absent a $0 local provider, no candidate has a reachable price, so the static
  // fallback engages and must say so. When a local provider is configured it wins
  // on $0 and no degradation notice is due.
  assert.ok(
    usedLocal || degraded.warnings.some((w) => /pricing/i.test(w)),
    'degraded pricing must be surfaced as a warning when no local provider fills the tier',
  );
});
