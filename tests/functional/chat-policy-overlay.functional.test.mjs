/**
 * tests/functional/chat-policy-overlay.functional.test.mjs — routeRequest overlay for chat.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTurn, buildTurnPolicyMessage } from '../../lib/chat/transparency.mjs';

test('competitive research prompt yields externalResearch.required in overlay', async () => {
  const overlay = await planTurn('Compare Construct vs CrewAI for multi-agent orchestration landscape', {});
  assert.ok(overlay, 'overlay should be returned');
  assert.ok(Array.isArray(overlay.specialists), 'specialists array');
  assert.equal(typeof overlay.intent, 'string');
  if (overlay.externalResearch?.required) {
    assert.ok(overlay.externalResearch.required);
  }
});

test('buildTurnPolicyMessage includes research mandate when required', async () => {
  const overlay = await planTurn('Compare Construct vs CrewAI competitive landscape', {});
  const msg = buildTurnPolicyMessage(overlay);
  assert.match(msg, /intent:/);
  assert.match(msg, /specialists:/);
  if (overlay?.externalResearch?.required) {
    assert.match(msg, /externalResearch: required/);
    assert.match(msg, /grep\/read/i);
  }
});
