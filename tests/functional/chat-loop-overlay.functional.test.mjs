/**
 * tests/functional/chat-loop-overlay.functional.test.mjs — SSE overlay shape for web cockpit.
 *
 * Asserts planTurn output serializes through overlayToSsePayload with the fields
 * the terminal cockpit route dock requires.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayToSsePayload } from '../../lib/chat/present.mjs';
import { planTurn } from '../../lib/chat/transparency.mjs';

test('overlayToSsePayload includes full route fields', async () => {
  const overlay = await planTurn('add authentication to the payments module with security review', {
    context: { turnIndex: 1, workingBranch: 'feature/payments' },
  });
  assert.ok(overlay, 'planTurn should return overlay for orchestrated request');

  const sse = overlayToSsePayload(overlay);
  assert.equal(sse.type, 'overlay');
  assert.ok(sse.intent, 'intent required');
  assert.ok(sse.track, 'track required');
  assert.ok(Array.isArray(sse.specialists), 'specialists array required');
  assert.ok(sse.specialists.length > 0, 'orchestrated request should have specialists');
  assert.ok(sse.dispatchSummary || sse.dispatchReasons || sse.triggers?.length, 'dispatch detail required');
  assert.ok(Array.isArray(sse.contractChain), 'contractChain array required');
  assert.equal(sse.workingBranch, 'feature/payments');
});

test('overlayToSsePayload handles null overlay', () => {
  assert.equal(overlayToSsePayload(null), null);
});
