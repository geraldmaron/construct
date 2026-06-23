/**
 * tests/functional/chat-present-route.functional.test.mjs — route strip formatters.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRouteStrip, formatRouteLogLine } from '../../lib/chat/present.mjs';
import { overlayToContext } from '../../lib/chat/tui/turn-block.mjs';

const sampleOverlay = {
  intent: 'research',
  track: 'deep',
  specialists: ['cx-researcher', 'cx-product-manager'],
  externalResearch: { required: true, shape: 'landscape' },
  dispatchSummary: 'Research track with PM review.',
  dispatchReasons: { 'cx-researcher': 'competitive signal' },
  triggers: [{ specialist: 'cx-researcher', reason: 'external research' }],
  contractChain: [{ id: 'e1', producer: 'cx-researcher', consumer: 'cx-product-manager', stage: 'handoff' }],
};

test('formatRouteStrip returns chain, intent, track, gates, summary, chainLine', () => {
  const strip = formatRouteStrip(sampleOverlay);
  assert.ok(strip);
  assert.deepEqual(strip.chain, ['cx-researcher', 'cx-product-manager']);
  assert.equal(strip.intent, 'research');
  assert.equal(strip.track, 'deep');
  assert.equal(strip.summary, 'Research track with PM review.');
  assert.equal(strip.chainLine, 'cx-researcher → cx-product-manager');
  assert.ok(strip.gates.some((g) => g.label === 'research'));
});

test('formatRouteStrip omits chain when specialists layer disabled', () => {
  const strip = formatRouteStrip(sampleOverlay, { layers: { specialists: false } });
  assert.deepEqual(strip.chain, []);
  assert.equal(strip.chainLine, null);
  assert.equal(strip.intent, 'research');
});

test('formatRouteLogLine includes specialist chain', () => {
  const line = formatRouteLogLine(sampleOverlay);
  assert.match(line, /intent=research/);
  assert.match(line, /track=deep/);
  assert.match(line, /cx-researcher → cx-product-manager/);
  assert.doesNotMatch(line, /specialists/);
});

test('formatRouteLogLine respects specialists layer toggle', () => {
  const line = formatRouteLogLine(sampleOverlay, { layers: { specialists: false } });
  assert.match(line, /intent=research/);
  assert.doesNotMatch(line, /cx-researcher/);
});

test('overlayToContext persists contractChain, dispatchReasons, triggers, dispatchSummary', () => {
  const ctx = overlayToContext(sampleOverlay);
  assert.equal(ctx.dispatchSummary, sampleOverlay.dispatchSummary);
  assert.deepEqual(ctx.dispatchReasons, sampleOverlay.dispatchReasons);
  assert.deepEqual(ctx.triggers, sampleOverlay.triggers);
  assert.equal(ctx.contractChain.length, 1);
  assert.equal(ctx.contractChain[0].producer, 'cx-researcher');
  ctx.contractChain[0].producer = 'mutated';
  assert.equal(sampleOverlay.contractChain[0].producer, 'cx-researcher');
});
