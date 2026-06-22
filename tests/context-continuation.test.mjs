/**
 * tests/context-continuation.test.mjs — unit coverage for the context-continuation
 * contract (construct-6zga.1.9).
 *
 * Proves the inventory classifies each layer's compaction eligibility, that
 * compaction retains required state verbatim while referencing reconstructible
 * layers and eliding compactible ones with a truthful marker, that required state
 * over budget yields a blocker instead of a silent drop, and that the packet
 * validator enforces the no-silent-loss invariant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyContextLayers, compactContext, rehydrateContinuation,
  continuationBudgetFromPolicy, validateContinuationPacket,
} from '../lib/chat/context-continuation.mjs';

const LAYERS = [
  { id: 'sys', kind: 'static-instructions', sourceId: 'src:sys', tokens: 100, content: 'SYS' },
  { id: 'role', kind: 'role-guidance', sourceId: 'src:role', tokens: 50, content: 'ROLE' },
  { id: 'task', kind: 'task-packet', tokens: 80, content: 'TASK' },
  { id: 'ev', kind: 'validated-evidence', sourceId: 'src:ev', tokens: 40, content: 'EVID' },
  { id: 'cons', kind: 'user-constraints', tokens: 30, content: 'CONSTRAINT' },
  { id: 'tools', kind: 'tool-results', tokens: 200, content: 'TOOLS' },
  { id: 'summ', kind: 'conversation-summary', tokens: 120, content: 'SUMMARY' },
  { id: 'learn', kind: 'learned-patterns', sourceId: 'src:learn', tokens: 60, content: 'LEARNED' },
];

function byId(packet, id) {
  return packet.layers.find((l) => l.id === id);
}

test('classifyContextLayers assigns kind-defaulted eligibility and token counts', () => {
  const inv = classifyContextLayers(LAYERS);
  assert.equal(inv.find((l) => l.id === 'task').eligibility, 'required');
  assert.equal(inv.find((l) => l.id === 'ev').eligibility, 'required');
  assert.equal(inv.find((l) => l.id === 'cons').eligibility, 'required');
  assert.equal(inv.find((l) => l.id === 'sys').eligibility, 'reconstructible');
  assert.equal(inv.find((l) => l.id === 'tools').eligibility, 'compactible');
  assert.equal(inv.find((l) => l.id === 'summ').eligibility, 'compactible');
});

test('with no pressure, required is retained, reconstructible is referenced, compactible is retained', () => {
  const packet = compactContext(LAYERS, { triggerTokens: null });
  assert.equal(packet.blocker, null);
  assert.equal(byId(packet, 'task').disposition, 'retained');
  assert.equal(byId(packet, 'sys').disposition, 'referenced');
  assert.equal(byId(packet, 'sys').content, null);
  assert.equal(byId(packet, 'tools').disposition, 'retained');
  assert.equal(packet.budget.referencedCount, 3);
  assert.ok(validateContinuationPacket(packet).valid);
});

test('under pressure, compactible is elided with a marker while required stays verbatim', () => {
  const packet = compactContext(LAYERS, { triggerTokens: 300 });
  assert.equal(packet.blocker, null);
  assert.equal(byId(packet, 'task').disposition, 'retained');
  assert.equal(byId(packet, 'ev').disposition, 'retained');
  assert.equal(byId(packet, 'summ').disposition, 'retained');
  assert.equal(byId(packet, 'tools').disposition, 'elided');
  assert.equal(byId(packet, 'tools').content, null);
  assert.equal(packet.budget.requiredTokens, 150);
  assert.equal(packet.budget.elidedTokens, 200);
  assert.ok(validateContinuationPacket(packet).valid);
});

test('required state over budget yields a truthful blocker, never a silent drop', () => {
  const packet = compactContext(LAYERS, { triggerTokens: 100 });
  assert.ok(packet.blocker, 'expected a blocker');
  assert.equal(packet.blocker.reason, 'required-state-exceeds-budget');
  assert.equal(packet.blocker.requiredTokens, 150);
  assert.equal(packet.blocker.overflowTokens, 50);
  for (const id of ['task', 'ev', 'cons']) {
    assert.equal(byId(packet, id).disposition, 'retained', `${id} must stay retained under a blocker`);
  }
  assert.ok(validateContinuationPacket(packet).valid);
});

test('a reconstructible layer with no source id falls back to the pressure pool, never lost', () => {
  const layers = [
    { id: 'task', kind: 'task-packet', tokens: 20, content: 'T' },
    { id: 'role2', kind: 'role-guidance', tokens: 20, content: 'R2' },
  ];
  const packet = compactContext(layers, { triggerTokens: 1000 });
  assert.equal(byId(packet, 'role2').disposition, 'retained');
  assert.equal(byId(packet, 'role2').content, 'R2');
});

test('rehydration re-derives referenced layers and preserves required content', () => {
  const packet = compactContext(LAYERS, { triggerTokens: 300 });
  const rehydrated = rehydrateContinuation(packet, { resolveSource: (id) => `RESOLVED:${id}` });
  const find = (id) => rehydrated.find((l) => l.id === id);
  assert.equal(find('task').content, 'TASK');
  assert.equal(find('sys').content, 'RESOLVED:src:sys');
  assert.equal(find('sys').resolved, true);
  assert.equal(find('tools').elided, true);
});

test('the validator rejects a required layer dropped without a blocker', () => {
  const bad = {
    schemaVersion: 1,
    budget: { triggerTokens: 10, requiredTokens: 20, retainedTokens: 0, elidedTokens: 20, referencedCount: 0 },
    layers: [{ id: 'task', kind: 'task-packet', eligibility: 'required', disposition: 'elided', tokens: 20, sourceId: null, content: null }],
    requiredState: [{ id: 'task', kind: 'task-packet', sourceId: null, tokens: 20 }],
    blocker: null,
  };
  const result = validateContinuationPacket(bad);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('required layer not retained')));
});

test('continuationBudgetFromPolicy reads the policy continuation block', () => {
  const budget = continuationBudgetFromPolicy({ continuation: { compactionTriggerTokens: 1234, compactionTriggerRatio: 0.75 } });
  assert.deepEqual(budget, { triggerTokens: 1234, triggerRatio: 0.75 });
  assert.deepEqual(continuationBudgetFromPolicy(null), { triggerTokens: null, triggerRatio: null });
});
