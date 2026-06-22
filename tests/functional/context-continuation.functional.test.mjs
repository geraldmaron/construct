/**
 * tests/functional/context-continuation.functional.test.mjs — the live
 * context-continuation seam (construct-6zga.1.9).
 *
 * Proves the contract across the real modules (capability profile -> execution
 * policy -> continuation budget -> compaction -> packet -> rehydration), and that
 * the owned-loop control resolver surfaces the same budget:
 *   - the compaction budget is capability-profile driven, not a model-name fixed
 *     limit, and resolveTurnControls exposes it (AC4).
 *   - a fitting context compacts to a valid, round-trippable packet that preserves
 *     required state and source ids (AC1, AC2, AC3).
 *   - required state over the profile budget yields a visible blocker, never a
 *     silent required-state drop (AC5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExecutionCapabilityProfile } from '../../lib/models/execution-capability-profile.mjs';
import { compileExecutionPolicy } from '../../lib/models/execution-policy.mjs';
import { resolveTurnControls } from '../../apps/chat/engine/turn-controls.mjs';
import {
  compactContext, rehydrateContinuation, validateContinuationPacket, continuationBudgetFromPolicy,
} from '../../lib/chat/context-continuation.mjs';

function budgetFor(model) {
  const profile = resolveExecutionCapabilityProfile({ model });
  const policy = compileExecutionPolicy({ profile });
  return continuationBudgetFromPolicy(policy);
}

const FIXTURE = [
  { id: 'sys', kind: 'static-instructions', sourceId: 'prompt:system', tokens: 120, content: 'system rules' },
  { id: 'role', kind: 'role-guidance', sourceId: 'role:engineer', tokens: 80, content: 'role guidance' },
  { id: 'task', kind: 'task-packet', tokens: 60, content: 'implement X with AC1..AC3' },
  { id: 'ev', kind: 'validated-evidence', sourceId: 'evidence:run-42', tokens: 50, content: 'verdict: pass' },
  { id: 'cons', kind: 'user-constraints', tokens: 40, content: 'never touch staging' },
  { id: 'tools', kind: 'tool-results', tokens: 90, content: 'grep output' },
];

test('the compaction budget is capability-profile driven and surfaced by the control resolver (AC4)', () => {
  const hosted = budgetFor('anthropic/claude-opus-4-6');
  const degraded = budgetFor('ollama/llama3.1:8b');
  assert.ok(Number.isFinite(hosted.triggerTokens) && hosted.triggerTokens > 0);
  assert.ok(Number.isFinite(degraded.triggerTokens) && degraded.triggerTokens > 0);
  assert.ok(hosted.triggerTokens > degraded.triggerTokens, 'a capable profile must allow more context than a degraded one');

  const controls = resolveTurnControls({ model: 'anthropic/claude-opus-4-6' });
  assert.deepEqual(controls.continuation, hosted, 'the owned loop must read the policy-derived budget');
});

test('a fitting context compacts to a valid, round-trippable packet (AC1, AC2, AC3)', () => {
  const { triggerTokens } = budgetFor('anthropic/claude-opus-4-6');
  const packet = compactContext(FIXTURE, { triggerTokens });

  assert.equal(packet.blocker, null);
  assert.ok(validateContinuationPacket(packet).valid, 'packet must be schema-valid');
  assert.equal(packet.requiredState.length, 3, 'task, evidence, and constraints are required state');
  assert.ok(packet.requiredState.every((l) => typeof l.id === 'string'), 'required state carries source ids');

  const rehydrated = rehydrateContinuation(packet, { resolveSource: (id) => `derived:${id}` });
  const find = (id) => rehydrated.find((l) => l.id === id);
  assert.equal(find('task').content, 'implement X with AC1..AC3', 'required content survives the round trip');
  assert.equal(find('cons').content, 'never touch staging');
  assert.equal(find('ev').content, 'verdict: pass');
  assert.equal(find('sys').content, 'derived:prompt:system', 'reconstructible layers re-derive from source');
  assert.equal(find('role').content, 'derived:role:engineer');
});

test('required state over the profile budget yields a visible blocker, not silent loss (AC5)', () => {
  const { triggerTokens } = budgetFor('anthropic/claude-opus-4-6');
  const oversized = [
    { id: 'task', kind: 'task-packet', tokens: triggerTokens + 1000, content: 'a very large required task packet' },
    { id: 'tools', kind: 'tool-results', tokens: 500, content: 'tool output' },
  ];
  const packet = compactContext(oversized, { triggerTokens });

  assert.ok(packet.blocker, 'an over-budget required state must surface a blocker');
  assert.equal(packet.blocker.reason, 'required-state-exceeds-budget');
  assert.equal(packet.blocker.overflowTokens, 1000);
  assert.equal(packet.layers.find((l) => l.id === 'task').disposition, 'retained', 'required state is never dropped to fit the budget');
  assert.ok(validateContinuationPacket(packet).valid);
});
