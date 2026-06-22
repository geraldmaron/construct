/**
 * tests/functional/chat-policy-overlay.functional.test.mjs — routeRequest overlay +
 * system-prompt policy injection for chat.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTurn } from '../../lib/chat/transparency.mjs';
import { buildSystemPrompt, turnPolicyLines, CHAT_SYSTEM_BASE } from '../../lib/chat/system-prompt.mjs';

test('competitive research prompt yields externalResearch.required in overlay', async () => {
  const overlay = await planTurn('Compare Construct vs CrewAI for multi-agent orchestration landscape', {});
  assert.ok(overlay, 'overlay should be returned');
  assert.ok(Array.isArray(overlay.specialists), 'specialists array');
  assert.equal(typeof overlay.intent, 'string');
});

test('turn policy rides in the system prompt, not the user message', async () => {
  const overlay = await planTurn('Compare Construct vs CrewAI competitive landscape', {});
  const system = buildSystemPrompt({ overlay });
  // base identity is preserved and the per-turn policy is appended to system
  assert.ok(system.startsWith(CHAT_SYSTEM_BASE.slice(0, 24)));
  assert.match(system, /Turn policy/);
  assert.match(system, /Classified intent/);
  if (overlay?.externalResearch?.required) {
    assert.match(system, /grep\/read/i);
  }
});

test('buildSystemPrompt with no overlay is exactly the base prompt', () => {
  assert.equal(buildSystemPrompt({ overlay: null }), CHAT_SYSTEM_BASE);
});

test('assumptionsBlocked overlay adds a read-first / unverified directive', () => {
  const lines = turnPolicyLines({ intent: 'implementation', assumptionsBlocked: true });
  const joined = lines.join('\n');
  assert.match(joined, /read the files first/i);
  assert.match(joined, /\[unverified\]/);
});

test('no policy lines for an empty overlay', () => {
  assert.deepEqual(turnPolicyLines(null), []);
});
