/**
 * tests/pricing-priority.test.mjs — pricing catalog resolution + divergence.
 *
 * Pins the priority order — LiteLLM (live) wins over OpenRouter (live
 * with markup) wins over the static fallback — and the 25% divergence
 * guard that surfaces when a LiteLLM entry disagrees meaningfully with
 * the static table on the same model. Both invariants are critical for
 * Phase 7b: ceilings ride on live pricing being authoritative, and the
 * divergence guard ensures a bad upstream entry can't silently
 * misbill.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPricingCatalog,
  resolveModelPricing,
  checkPricingDivergence,
  resetPricingCatalog,
} from '../lib/telemetry/model-pricing-catalog.mjs';

after(() => {
  resetPricingCatalog();
});

describe('pricing catalog priority', () => {
  it('LiteLLM wins over the static fallback when both have the same model', () => {
    const catalog = buildPricingCatalog(
      [],
      [{ modelName: 'claude-sonnet-4-6', inputPrice: 1 / 1_000_000, outputPrice: 5 / 1_000_000, source: 'litellm' }],
    );
    const resolved = resolveModelPricing('claude-sonnet-4-6', catalog);
    assert.equal(resolved.source, 'litellm');
    assert.equal(resolved.inputPrice, 1 / 1_000_000);
    assert.equal(resolved.outputPrice, 5 / 1_000_000);
  });

  it('OpenRouter wins over the static fallback when LiteLLM has no entry', () => {
    const catalog = buildPricingCatalog(
      [{ modelName: 'openrouter/some/new-model', inputPrice: 2 / 1_000_000, outputPrice: 10 / 1_000_000 }],
      [],
    );
    const resolved = resolveModelPricing('openrouter/some/new-model', catalog);
    assert.equal(resolved.source, 'openrouter');
  });

  it('LiteLLM wins over OpenRouter when both name the same model', () => {
    const catalog = buildPricingCatalog(
      [{ modelName: 'claude-sonnet-4-6', inputPrice: 99 / 1_000_000, outputPrice: 99 / 1_000_000 }],
      [{ modelName: 'claude-sonnet-4-6', inputPrice: 3 / 1_000_000, outputPrice: 15 / 1_000_000, source: 'litellm' }],
    );
    const resolved = resolveModelPricing('claude-sonnet-4-6', catalog);
    assert.equal(resolved.source, 'litellm');
    assert.equal(resolved.inputPrice, 3 / 1_000_000);
  });

  it('static fallback is used when neither LiteLLM nor OpenRouter has the model', () => {
    const catalog = buildPricingCatalog([], []);
    const resolved = resolveModelPricing('claude-sonnet-4-6', catalog);
    assert.ok(resolved, 'static must catch known Anthropic models');
    assert.equal(resolved.source, 'static-fallback');
  });

  it('GitHub Copilot stays at $0 even when LiteLLM has no entry (per-request billing)', () => {
    const catalog = buildPricingCatalog([], []);
    const resolved = resolveModelPricing('github-copilot/gpt-4.1', catalog);
    assert.ok(resolved);
    assert.equal(resolved.inputPrice, 0);
    assert.equal(resolved.outputPrice, 0);
  });
});

describe('checkPricingDivergence', () => {
  it('returns no warnings when LiteLLM matches the static fallback within 25%', () => {
    const warnings = checkPricingDivergence([
      { modelName: 'claude-sonnet-4-6', inputPrice: 3 / 1_000_000, outputPrice: 15 / 1_000_000 },
    ]);
    assert.equal(warnings.length, 0);
  });

  it('returns a warning when LiteLLM input price diverges by more than 25%', () => {
    const warnings = checkPricingDivergence([
      { modelName: 'claude-sonnet-4-6', inputPrice: 1 / 1_000_000, outputPrice: 15 / 1_000_000 },
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /claude-sonnet-4-6/);
    assert.ok(warnings[0].inputDelta > 0.25);
  });

  it('returns a warning when LiteLLM output price diverges by more than 25%', () => {
    const warnings = checkPricingDivergence([
      { modelName: 'claude-sonnet-4-6', inputPrice: 3 / 1_000_000, outputPrice: 1 / 1_000_000 },
    ]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].outputDelta > 0.25);
  });

  it('does not warn on small (≤25%) deltas that fall within normal price drift', () => {
    const warnings = checkPricingDivergence([
      { modelName: 'claude-sonnet-4-6', inputPrice: 3.5 / 1_000_000, outputPrice: 17 / 1_000_000 },
    ]);
    assert.equal(warnings.length, 0);
  });

  it('ignores LiteLLM entries that have no matching static fallback entry', () => {
    const warnings = checkPricingDivergence([
      { modelName: 'openai/gpt-99-future', inputPrice: 1000 / 1_000_000, outputPrice: 1000 / 1_000_000 },
    ]);
    assert.equal(warnings.length, 0);
  });
});
