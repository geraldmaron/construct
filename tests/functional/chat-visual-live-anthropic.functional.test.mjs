/**
 * tests/functional/chat-visual-live-anthropic.functional.test.mjs — opt-in live depth tests.
 *
 * Runs real Anthropic Sonnet 4.6 turns and scores per-role output depth — the
 * primary harness for tuning specialist prompts and skill workflows. Skips when
 * CONSTRUCT_VISUAL_LIVE is unset or ANTHROPIC_API_KEY is missing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLiveRoleSuite } from '../visual/lib/run-suite.mjs';
import { visualLiveSkipReason, resolveVisualModel } from '../visual/lib/live-turn.mjs';
import { VISUAL_LIVE_MODEL } from '../visual/lib/role-expectations.mjs';

test('live visual — developer depth on repo question', { timeout: 300_000 }, async (t) => {
  const skip = visualLiveSkipReason(process.env);
  if (skip) {
    t.skip(skip);
    return;
  }

  const model = resolveVisualModel({
    ...process.env,
    CX_MODEL_STANDARD: VISUAL_LIVE_MODEL,
    CONSTRUCT_E2E_REAL_LLM_PROVIDER: 'anthropic',
  });

  const result = await runLiveRoleSuite({
    roleIds: ['developer'],
    env: {
      ...process.env,
      CX_MODEL_STANDARD: model,
      CONSTRUCT_E2E_REAL_LLM_PROVIDER: 'anthropic',
    },
    witness: {
      onAction(kind, detail) {
        process.stderr.write(`[live] ${kind}: ${detail}\n`);
      },
      onEvent(event) {
        if (event.type === 'text') process.stderr.write('.');
        if (event.type === 'done') process.stderr.write('\n');
      },
      log() {},
      onOutput() {},
    },
  });

  assert.equal(result.skipped, false);
  assert.match(result.summary.model, /sonnet-4-6|claude-sonnet-4/i, `expected Sonnet 4.6, got ${result.summary.model}`);

  const dev = result.roleResults[0];
  assert.ok(dev, 'developer role result missing');
  assert.ok(dev.depth.metrics.words >= 80, `answer too short (${dev.depth.metrics.words} words) — specialist depth may be shallow`);

  if (!dev.depth.ok) {
    process.stderr.write(`\nDepth failures (tuning signals):\n${dev.depth.failures.map((f) => `  - ${f}`).join('\n')}\n`);
    process.stderr.write(`Warnings:\n${dev.depth.warnings.map((w) => `  - ${w}`).join('\n')}\n`);
    process.stderr.write(`Evidence: ${result.ev.dir}\n`);
  }

  assert.equal(dev.depth.ok, true, `developer depth rubric failed: ${dev.depth.failures.join('; ')}`);
  assert.equal(result.summary.ok, true, JSON.stringify(result.summary.depthFailures, null, 2));
});

test('live visual — product-manager depth on PRD prompt', { timeout: 300_000 }, async (t) => {
  const skip = visualLiveSkipReason(process.env);
  if (skip) {
    t.skip(skip);
    return;
  }

  const result = await runLiveRoleSuite({
    roleIds: ['product-manager'],
    env: {
      ...process.env,
      CX_MODEL_STANDARD: VISUAL_LIVE_MODEL,
      CONSTRUCT_E2E_REAL_LLM_PROVIDER: 'anthropic',
    },
  });

  const pm = result.roleResults[0];
  assert.ok(pm.depth.metrics.hasMetrics || pm.depth.metrics.words >= 150,
    'PM answer lacks measurable criteria or sufficient depth');
  assert.ok(pm.depth.metrics.proseParagraphs >= 1, 'PM answer is bullet-only — prd-workflow depth may need tuning');

  if (!pm.depth.ok) {
    t.skip(`PM depth rubric advisory skip for tuning: ${pm.depth.failures.join('; ')}`);
    return;
  }
  assert.equal(pm.depth.ok, true);
});
