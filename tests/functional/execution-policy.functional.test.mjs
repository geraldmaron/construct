/**
 * tests/functional/execution-policy.functional.test.mjs — the live policy wiring
 * seam (construct-6zga.1.2).
 *
 * Chat (lib/chat/web-session.mjs, lib/chat/cli.mjs) now derives the system-prompt
 * tier from a compiled execution policy instead of calling capabilityTierFromProfile
 * directly. This proves the seam across the real modules: resolving a capability
 * profile, compiling its policy, and building the prompt from policy.prompt
 * .systemPromptTier yields the byte-identical prompt the legacy path produced, for
 * every representative model — behavior preserved while the policy becomes the
 * single record the owned loop reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExecutionCapabilityProfile, capabilityTierFromProfile } from '../../lib/models/execution-capability-profile.mjs';
import { compileExecutionPolicy, validateExecutionPolicy } from '../../lib/models/execution-policy.mjs';
import { buildSystemPrompt } from '../../lib/chat/system-prompt.mjs';

const NOW = () => '2026-06-21T00:00:00.000Z';
const MODELS = [
  'anthropic/claude-opus-4-6',
  'openai/gpt-5.1',
  'openrouter/qwen/qwen3-coder:free',
  'ollama/llama3.1:8b',
  'ollama/devstral:24b',
  'local/custom-large',
  'github-copilot/gpt-5.5',
  'mystery/x',
];

test('policy-driven system prompt is byte-identical to the legacy capability-tier path', () => {
  for (const model of MODELS) {
    const profile = resolveExecutionCapabilityProfile({ model, now: NOW });
    const policy = compileExecutionPolicy({ profile });
    assert.ok(validateExecutionPolicy(policy).valid, `${model}: policy invalid`);

    const legacy = buildSystemPrompt({ capabilityTier: capabilityTierFromProfile(profile) });
    const viaPolicy = buildSystemPrompt({ capabilityTier: policy.prompt.systemPromptTier });
    assert.equal(viaPolicy, legacy, `system prompt diverged for ${model}`);
  }
});

test('every representative model compiles to a schema-valid, frozen policy', () => {
  for (const model of MODELS) {
    const profile = resolveExecutionCapabilityProfile({ model, now: NOW });
    const policy = compileExecutionPolicy({ profile, intent: 'code-change' });
    assert.ok(Object.isFrozen(policy), `${model}: policy not frozen`);
    assert.ok(validateExecutionPolicy(policy).valid, `${model}: policy invalid`);
    assert.equal(policy.source.profileKey.requestedModel, model);
  }
});
