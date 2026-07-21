/**
 * tests/functional/operating-profile-capability-class.functional.test.mjs
 *
 * Multi-component gate for construct-72gqn.35: capability-class operating profile
 * selection in lib/model-router.mjs flows through ExecutionCapabilityProfile into
 * prompt-composer fragment budgets. Uses real modules and an isolated probe store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MODEL_OPERATING_PROFILES,
  resolveModelOperatingProfile,
} from '../../lib/model-router.mjs';
import {
  resolveExecutionCapabilityProfile,
  operatingProfileIdFromProfile,
} from '../../lib/models/execution-capability-profile.mjs';
import { composePrompt } from '../../lib/prompt-composer.mjs';

const root = join(process.cwd());

async function withProbeStore(fn) {
  const home = mkdtempSync(join(tmpdir(), 'cx-op-profile-'));
  const prev = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = home;
  mkdirSync(join(home, '.construct'), { recursive: true });
  try {
    const mod = await import(`../../lib/ollama/capability-store.mjs?case=${encodeURIComponent(home)}`);
    await fn(mod, home);
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prev;
    rmSync(home, { recursive: true, force: true });
  }
}

const TIER_CASES = [
  { label: 'hosted-direct', model: 'anthropic/claude-opus-4-6', capabilityClass: 'hosted-direct', expected: 'balanced' },
  { label: 'hosted-routed', model: 'openrouter/qwen/qwen3-coder:free', capabilityClass: 'hosted-routed', expected: 'balanced' },
  { label: 'local-constrained', model: 'ollama/qwen2.5-coder:7b-cx32k', capabilityClass: 'local-constrained', expected: 'small' },
  { label: 'local-capable', model: 'ollama/devstral:24b-cx32k', capabilityClass: 'local-capable', expected: 'balanced' },
];

test('resolveModelOperatingProfile returns tier-appropriate profile ids', () => {
  for (const tier of TIER_CASES) {
    const profile = resolveModelOperatingProfile({
      selectedModel: tier.model,
      capabilityClass: tier.capabilityClass,
    });
    assert.equal(profile.id, tier.expected, `${tier.label} profile id`);
    assert.equal(profile, MODEL_OPERATING_PROFILES[tier.expected], `${tier.label} profile record`);
  }
});

test('ExecutionCapabilityProfile and prompt-composer agree on hosted-direct budgets', () => {
  const model = 'anthropic/claude-opus-4-6';
  const executionProfile = resolveExecutionCapabilityProfile({ model, overrides: {}, now: () => '2026-07-20T00:00:00.000Z' });
  assert.equal(operatingProfileIdFromProfile(executionProfile), 'balanced');
  assert.equal(executionProfile.capabilities.operatingProfileId.source, 'provider_metadata');

  const composed = composePrompt('engineer', {
    rootDir: root,
    modelId: model,
    executionContractModel: { selectedModel: model },
  });
  assert.ok(composed.totalTokens > 0);
  assert.equal(
    composed.fragments.some((f) => f.type === 'model-profile' && /small-model operating mode/i.test(f.content)),
    false,
  );
});

test('live_probe local-capable upgrades 24b local from regex small to balanced profile', () => withProbeStore(async (store) => {
  store.recordProbeResult('devstral:24b-cx32k', {
    ok: true,
    coherent: true,
    calledTool: true,
    repeatRatio: 0.05,
    uniqueRatio: 0.9,
  }, 'dig-cap');

  const model = 'ollama/devstral:24b-cx32k';
  const executionProfile = resolveExecutionCapabilityProfile({ model, overrides: {}, now: () => '2026-07-20T00:00:00.000Z' });
  assert.equal(executionProfile.capabilityClass, 'local-capable');
  assert.equal(operatingProfileIdFromProfile(executionProfile), 'balanced');
  assert.equal(executionProfile.capabilities.operatingProfileId.source, 'live_probe');

  const routerProfile = resolveModelOperatingProfile({ selectedModel: model });
  assert.equal(routerProfile.id, 'balanced');

  const composed = composePrompt('engineer', {
    rootDir: root,
    modelId: model,
    executionContractModel: { selectedModel: model },
  });
  assert.ok(composed.totalTokens > 0);
  assert.equal(
    composed.fragments.some((f) => f.type === 'model-profile' && /small-model operating mode/i.test(f.content)),
    false,
  );
}));

test('unmeasured local still uses compatibility_fallback regex for operating profile', () => {
  const model = 'ollama/qwen2.5-coder:7b-cx32k';
  const executionProfile = resolveExecutionCapabilityProfile({ model, overrides: {}, now: () => '2026-07-20T00:00:00.000Z' });
  assert.equal(executionProfile.capabilityClass, 'unknown');
  assert.equal(operatingProfileIdFromProfile(executionProfile), 'small');
  assert.equal(executionProfile.capabilities.operatingProfileId.source, 'compatibility_fallback');

  const composed = composePrompt('engineer', {
    rootDir: root,
    modelId: model,
    executionContractModel: { selectedModel: model },
  });
  const profileFragment = composed.fragments.find((f) => f.type === 'model-profile');
  assert.ok(profileFragment);
  assert.match(profileFragment.content, /small-model operating mode/i);
});
