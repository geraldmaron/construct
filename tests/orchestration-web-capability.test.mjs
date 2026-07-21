/**
 * tests/orchestration-web-capability.test.mjs — WebGrant resolver priority (ADR-0050).
 *
 * resolveWebCapability returns a typed grant in strict priority: governed (WEB_SEARCH_URL) →
 * provider-native (Anthropic / OpenRouter server tools) → host-delegated (explicit opt-in) →
 * unavailable. roleHoldsWebCapability derives web access from the Worker Profile,
 * never a hardcoded profile id.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebCapability, roleHoldsWebCapability } from '../lib/orchestration/web-capability.mjs';

test('WEB_SEARCH_URL set → governed regardless of provider family', () => {
  for (const family of ['anthropic', 'openrouter', 'openai', 'github-copilot']) {
    assert.equal(resolveWebCapability({ family, env: { WEB_SEARCH_URL: 'https://s.example/api' } }).mode, 'governed');
  }
});

test('no WEB_SEARCH_URL + anthropic → provider-native web_search_20250305', () => {
  const g = resolveWebCapability({ family: 'anthropic', env: {} });
  assert.equal(g.mode, 'provider-native');
  assert.equal(g.providerTool, 'anthropic');
  assert.equal(g.toolType, 'web_search_20250305');
  assert.equal(typeof g.maxUses, 'number');
});

test('no WEB_SEARCH_URL + openrouter → provider-native openrouter:web_search server tool (not the deprecated plugin)', () => {
  const g = resolveWebCapability({ family: 'openrouter', env: {} });
  assert.equal(g.mode, 'provider-native');
  assert.equal(g.providerTool, 'openrouter');
  assert.equal(g.toolSpec.type, 'openrouter:web_search');
  assert.equal(g.toolSpec.parameters.engine, 'auto');
});

test('no WEB_SEARCH_URL + openai/copilot with no delegate → unavailable (capability-unavailable)', () => {
  for (const family of ['openai', 'github-copilot']) {
    const g = resolveWebCapability({ family, env: {} });
    assert.equal(g.mode, 'unavailable');
    assert.equal(g.reason, 'capability-unavailable');
  }
});

test('explicit CONSTRUCT_ORCHESTRATION_WEB_DELEGATE → host-delegated', () => {
  const g = resolveWebCapability({ family: 'openai', env: { CONSTRUCT_ORCHESTRATION_WEB_DELEGATE: '1' } });
  assert.equal(g.mode, 'host-delegated');
});

test('roleHoldsWebCapability derives web access from the Worker Profile', () => {
  assert.equal(roleHoldsWebCapability('researcher'), true, 'researcher enables governed web access');
  assert.equal(roleHoldsWebCapability('engineer'), false, 'engineer does not enable web access');
  assert.equal(roleHoldsWebCapability('does-not-exist'), false, 'unknown profile is not web-capable');
});
