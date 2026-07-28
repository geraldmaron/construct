/**
 * tests/orchestration/provider-budget.test.mjs — per-run USD spend ceiling
 * (lib/orchestration/provider-budget.mjs).
 *
 * Pins: CONSTRUCT_PROVIDER_BUDGET_USD_CENTS resolution (default 100, -1
 * disables, garbage falls back to default); the accumulator's conservative
 * flat-rate pricing and ProviderBudgetError shape; and the run loop —
 * inflated usage from an injected fetchImpl makes the first task complete,
 * the second task fail with PROVIDER_BUDGET_EXCEEDED before any transport
 * call, the loop halt (remaining tasks stay queued, no extra fetch calls),
 * and run.providerBudget report the exceeded snapshot honestly. S3/S8
 * certification wiring is pinned by source assertion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createProviderBudget,
  resolveBudgetCapCents,
  ProviderBudgetError,
  PROVIDER_BUDGET_ENV,
  PROVIDER_BUDGET_DEFAULT_CENTS,
} from '../../lib/orchestration/provider-budget.mjs';
import { runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { tempDir } from '../helpers.mjs';

// Every runOrchestration call resolves its run store through the
// machine-scoped state root (ADR-0066), which reads CONSTRUCT_HOME_OVERRIDE
// directly rather than the `env` option bag — pin it so these runs never
// write into the developer machine's real ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provider-budget-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const MODEL = 'anthropic/claude-sonnet-4-6';
const TIER_ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };
const REQUEST = { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 };

// 200,000 completion tokens at the conservative 0.015 USD/1K flat rate is an
// estimated 300 cents — one call blows straight through the 100-cent default.

function inflatedAnthropicFetch(calls) {
  return async () => {
    calls.count += 1;
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Worker Profile output' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 200000 },
      }),
    };
  };
}

// ── cap resolution ──────────────────────────────────────────────────────────

test('cap resolution: unset defaults to 100 cents, -1 disables, garbage falls back', () => {
  assert.equal(resolveBudgetCapCents({}), PROVIDER_BUDGET_DEFAULT_CENTS);
  assert.equal(resolveBudgetCapCents({ [PROVIDER_BUDGET_ENV]: '' }), PROVIDER_BUDGET_DEFAULT_CENTS);
  assert.equal(resolveBudgetCapCents({ [PROVIDER_BUDGET_ENV]: '250' }), 250);
  assert.equal(resolveBudgetCapCents({ [PROVIDER_BUDGET_ENV]: '-1' }), -1);
  assert.equal(resolveBudgetCapCents({ [PROVIDER_BUDGET_ENV]: 'abc' }), PROVIDER_BUDGET_DEFAULT_CENTS);
  assert.equal(resolveBudgetCapCents({ [PROVIDER_BUDGET_ENV]: '-5' }), PROVIDER_BUDGET_DEFAULT_CENTS);
});

test('accumulator prices both usage shapes conservatively and throws typed error past the cap', () => {
  const budget = createProviderBudget({ env: { [PROVIDER_BUDGET_ENV]: '10' } });
  budget.record({ promptTokens: 1000, completionTokens: 1000 });
  assert.equal(budget.totalCents(), 2);
  budget.record({ prompt_tokens: 100000, completion_tokens: 100000 });
  assert.ok(budget.exceeded());
  assert.throws(() => budget.assertWithinCap(), (err) => {
    assert.ok(err instanceof ProviderBudgetError);
    assert.equal(err.code, 'PROVIDER_BUDGET_EXCEEDED');
    assert.match(err.remediation, /worker_backend "host"/);
    assert.match(err.remediation, /no API cost/);
    return true;
  });
  const snap = budget.snapshot();
  assert.equal(snap.exceeded, true);
  assert.equal(snap.calls, 2);
});

test('a -1 cap disables both the check and the exceeded flag', () => {
  const budget = createProviderBudget({ env: { [PROVIDER_BUDGET_ENV]: '-1' } });
  budget.record({ promptTokens: 10_000_000, completionTokens: 10_000_000 });
  assert.equal(budget.disabled, true);
  assert.equal(budget.exceeded(), false);
  budget.assertWithinCap();
});

// ── run loop wiring ─────────────────────────────────────────────────────────

test('inflated usage halts the provider run before the next call and records the outcome honestly', async () => {
  const cwd = tempDir('cx-budget-halt-', test);
  const calls = { count: 0 };
  const run = await runOrchestration(REQUEST, {
    env: TIER_ENV, cwd, workerBackend: 'provider', fetchImpl: inflatedAnthropicFetch(calls),
  });

  assert.ok(run.tasks.length >= 2, 'the plan sequences multiple Worker Profiles');
  assert.equal(calls.count, 1, 'exactly one provider call was dispatched');
  assert.equal(run.tasks[0].status, 'done');
  assert.equal(run.tasks[1].status, 'failed');
  assert.equal(run.tasks[1].error.code, 'PROVIDER_BUDGET_EXCEEDED');
  assert.match(run.tasks[1].error.remediation, /no API cost/);
  assert.ok(run.tasks.slice(2).every((t) => t.status === 'queued'), 'unreached tasks stay queued, not fabricated');
  assert.equal(run.status, 'completed-with-failures');
  assert.equal(run.providerBudget.exceeded, true);
  assert.equal(run.providerBudget.capCents, PROVIDER_BUDGET_DEFAULT_CENTS);
  assert.ok(run.providerBudget.estimatedCents > PROVIDER_BUDGET_DEFAULT_CENTS);
});

test('an explicit -1 cap lets the same inflated run execute every task', async () => {
  const cwd = tempDir('cx-budget-disabled-', test);
  const calls = { count: 0 };
  const run = await runOrchestration(REQUEST, {
    env: { ...TIER_ENV, [PROVIDER_BUDGET_ENV]: '-1' }, cwd, workerBackend: 'provider', fetchImpl: inflatedAnthropicFetch(calls),
  });
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.every((t) => t.status === 'done'));
  assert.equal(calls.count, run.tasks.length);
  assert.equal(run.providerBudget.disabled, true);
});

test('a raised cap is honored: spend under the configured ceiling never halts the run', async () => {
  const cwd = tempDir('cx-budget-raised-', test);
  const calls = { count: 0 };
  const run = await runOrchestration(REQUEST, {
    env: { ...TIER_ENV, [PROVIDER_BUDGET_ENV]: '100000' }, cwd, workerBackend: 'provider', fetchImpl: inflatedAnthropicFetch(calls),
  });
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.every((t) => t.status === 'done'));
  assert.equal(run.providerBudget.exceeded, false);
});

// ── certification wiring (S3/S8) ────────────────────────────────────────────

// S3/S8 orchestration legs run through runOrchestration/executeRun (guarded by
// the run-loop tests above); the S3 polish call is a direct fetch, so its
// budget wiring is pinned at source level: the module must import the shared
// accumulator and hand it to the polish call.

test('real-llm-scenarios wires the shared budget accumulator into the S3 polish path', () => {
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'certification', 'real-llm-scenarios.mjs'),
    'utf8',
  );
  assert.match(src, /from '..\/orchestration\/provider-budget.mjs'/);
  assert.match(src, /budget: createProviderBudget\(\{ env \}\)/);
  assert.match(src, /budget\?\.assertWithinCap\(\)/);
  assert.match(src, /budget\.record\(data\.usage\)/);
});
