/**
 * tests/functional/model-resolver-no-defaults-chain.functional.test.mjs
 *
 * Construct ships with no implicit model defaults (ADR-0027,
 * tests/model-router-no-defaults.test.mjs). When nothing is configured,
 * `readCurrentModels` correctly returns null for every tier. This suite
 * locks in that consumers down the chain handle that null with a clear
 * remediation signal, not a TypeError, a silent zero, or a vendor-specific
 * default that contradicts the no-defaults design.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readCurrentModels, resolveExecutionContractModelMetadata, resolveFallbackAction } from '../../lib/model-router.mjs';
import { resolveModelTiers } from '../../lib/model-registry.mjs';
import { estimateUsageCost } from '../../lib/telemetry/model-pricing-catalog.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function emptyEnvPath() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-resolver-chain-'));
  const envPath = join(dir, '.env');
  writeFileSync(envPath, '');
  return { dir, envPath };
}

test('readCurrentModels still returns null tiers when nothing is configured', () => {
  const { dir, envPath } = emptyEnvPath();
  try {
    const models = readCurrentModels(envPath, {});
    assert.equal(models.reasoning, null);
    assert.equal(models.standard, null);
    assert.equal(models.fast, null);
    for (const tier of ['reasoning', 'standard', 'fast']) {
      assert.equal(models.sources[tier], 'not configured');
    }
  } finally {
    rmTmpDir(dir);
  }
});

test('resolveModelTiers (model-registry) returns null tiers with not-configured source — no BUILTIN_DEFAULTS substitution', () => {
  const resolved = resolveModelTiers({ env: {} });
  for (const tier of ['reasoning', 'standard', 'fast']) {
    assert.equal(resolved.models[tier], null, `${tier} should not be silently defaulted`);
    assert.equal(resolved.sources[tier], 'not configured');
  }
  assert.equal(resolved.complete, false);
  assert.equal(resolved.configured, 0);
});

test('schema-infer throws a clear configuration error when fast tier is null and only Anthropic key is present', async () => {
  const { dir, envPath } = emptyEnvPath();
  const docPath = join(dir, 'sample.txt');
  writeFileSync(docPath, 'This is a short document the schema inferer would parse.\n');
  const prev = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    CX_MODEL_FAST: process.env.CX_MODEL_FAST,
    CX_USER_ENV_PATH: process.env.CX_USER_ENV_PATH,
  };
  process.env.ANTHROPIC_API_KEY = 'sk-test-anthropic';
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.CX_MODEL_FAST;
  process.env.CX_USER_ENV_PATH = envPath;
  const originalHome = process.env.HOME;
  process.env.HOME = dir;

  // secret-resolver walks a project-env tier at process.cwd()/.env before falling
  // back to the (now-isolated) HOME tiers, so the repo's own gitignored .env would
  // supply a real OPENROUTER_API_KEY and defeat the only-Anthropic premise. Run
  // from the empty isolation dir so no ambient .env resolves the OpenRouter path.

  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const mod = await import(`../../lib/schema-infer.mjs?ts=${Date.now()}`);
    let caught;
    try {
      await mod.inferDocumentSchema(docPath);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'schema-infer should throw, not TypeError or silently succeed');
    assert.match(caught.message, /fast-tier|construct models --apply|CX_MODEL_FAST/);
    assert.equal(caught.name, 'Error', 'should be a clear Error, not TypeError');
  } finally {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmTmpDir(dir);
  }
});

test('resolveExecutionContractModelMetadata records selectedModelSource:not-configured when nothing resolves', () => {
  const meta = resolveExecutionContractModelMetadata({
    envValues: {},
    registryModels: {},
    requestedTier: 'reasoning',
  });
  assert.equal(meta.selectedModel, null);
  assert.equal(meta.selectedModelSource, 'not configured');
});

test('estimateUsageCost on a null model returns costSource:unavailable (not a silent zero)', () => {
  const result = estimateUsageCost(null, { inputTokens: 100, outputTokens: 50 });
  assert.equal(result.costUsd, 0);
  assert.equal(result.costSource, 'unavailable');
  assert.equal(result.modelName, null);
});

test('resolveFallbackAction returns null when no fallback exists — callers escalate via construct models --apply', () => {
  const action = resolveFallbackAction({
    failure: { kind: 'rate_limit', provider: 'anthropic', retryable: true },
    requestedTier: 'standard',
    currentModels: { standard: { model: null } },
    registryModels: {},
  });
  assert.equal(action, null, 'null return is the documented signal that callers escalate on');
});
