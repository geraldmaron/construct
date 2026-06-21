/**
 * tests/provider-adapters.test.mjs — centralized provider adapters (construct-6zga.1.3).
 *
 * Proves the adapter contract is serializable (AC1), public model ids and protocol
 * behavior are preserved and conform to the behavior-matrix capability classes
 * (AC2), a provider is added by registry entry not dispatch edit (AC3), and the
 * dispatcher resolves purely by structural provider group with no provider/model
 * prefix behavior branch (AC4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  describeProviderAdapters,
  getProviderAdapter,
  nativeModelId,
  resolveLanguageModel,
} from '../apps/chat/engine/provider-adapters.mjs';
import { transportForProviderGroup } from '../lib/models/behavior-matrix.mjs';
import { providerGroupForModel } from '../lib/models/execution-capability-profile.mjs';

const GROUPS = ['anthropic', 'openai', 'openrouter', 'ollama', 'local', 'github-copilot'];

test('AC1: every adapter exposes a serializable contract', () => {
  const described = describeProviderAdapters();
  assert.deepEqual(described.map((d) => d.id).sort(), [...GROUPS].sort());
  for (const d of described) {
    assert.ok(['api_key', 'oauth', 'none'].includes(d.auth), `${d.id}.auth ${d.auth}`);
    assert.ok(typeof d.protocol === 'string' && d.protocol);
    assert.ok(Array.isArray(d.credentialEnv));
  }
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(described)));
});

test('AC2: public model id is preserved — only the group segment is stripped', () => {
  assert.equal(nativeModelId('anthropic/claude-opus-4-6'), 'claude-opus-4-6');
  assert.equal(nativeModelId('openai/gpt-5.1'), 'gpt-5.1');
  assert.equal(nativeModelId('openrouter/anthropic/claude-opus-4-6'), 'anthropic/claude-opus-4-6');
  assert.equal(nativeModelId('ollama/llama3.1:8b'), 'llama3.1:8b');
  assert.equal(nativeModelId('local/custom-large'), 'custom-large');
  assert.equal(nativeModelId('github-copilot/gpt-5.5'), 'gpt-5.5');
});

test('AC2: adapter protocol conforms to the behavior-matrix transport class', () => {
  const expectedByTransport = {
    direct: new Set(['anthropic-messages', 'openai-chat-completions']),
    routed: new Set(['openai-compatible']),
    local: new Set(['openai-compatible']),
  };
  for (const group of GROUPS) {
    const adapter = getProviderAdapter(group);
    const transport = transportForProviderGroup(group);
    assert.ok(
      expectedByTransport[transport].has(adapter.protocol),
      `${group} (${transport}) protocol ${adapter.protocol} not in matrix class`,
    );
  }
});

test('AC3: a provider is reached by registry lookup, not a hardcoded branch', () => {
  assert.ok(getProviderAdapter('anthropic'));
  assert.equal(getProviderAdapter('not-a-provider'), null);
  for (const group of GROUPS) {
    assert.equal(getProviderAdapter(group).id, group);
    assert.equal(providerGroupForModel(`${group}/whatever`), group);
  }
});

test('AC4: dispatch resolves by group; unknown and empty fail with typed errors, no prefix branch', async () => {
  await assert.rejects(() => resolveLanguageModel(null, {}), (e) => e.code === 'PROVIDER_MODEL_UNRESOLVED');
  await assert.rejects(() => resolveLanguageModel('mystery/model', {}), (e) => e.code === 'PROVIDER_UNSUPPORTED');
});

test('AC4: dispatch reaches the adapter — credential checks fire before any SDK load', async () => {
  await assert.rejects(() => resolveLanguageModel('anthropic/claude-opus-4-6', {}), (e) => e.code === 'PROVIDER_KEY_MISSING');
  await assert.rejects(() => resolveLanguageModel('openai/gpt-5.1', {}), (e) => e.code === 'PROVIDER_KEY_MISSING');
  await assert.rejects(() => resolveLanguageModel('openrouter/x/y', {}), (e) => e.code === 'PROVIDER_KEY_MISSING');
  await assert.rejects(() => resolveLanguageModel('local/custom-large', {}), (e) => e.code === 'PROVIDER_KEY_MISSING');
});
