/**
 * tests/kernel/workflow/classify-coordination.test.ts — a request about
 * working alongside other agents is served by the work ledger, not a
 * workflow.
 *
 * Handing work to another agent, taking up a handoff, taking over a
 * claim, asking who else is working, and reserving files are marked with the
 * ledger action that serves them, and classify_request suggests no workflow
 * for them. Ordinary work that happens to use the same words (handing a
 * document to a person, reviewing a handoff document) is not.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInteraction } from '../../../src/kernel/workflow/classify.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { brokerFixture } from '../broker/support.ts';

test('coordination wording is marked with the ledger action that serves it', () => {
  const cases: readonly [string, string, string][] = [
    ['Hand this off to the other agent when you are done', 'handoff', 'manage'],
    ['Pass the parser work to another session', 'handoff', 'manage'],
    ['Please hand it off.', 'handoff', 'manage'],
    ['Accept the handoff from the Cursor session', 'accept', 'manage'],
    ['Did anything get handed off to me?', 'accept', 'manage'],
    ['Take over the claim from the agent that stopped', 'takeover', 'manage'],
    ['Who else is working in this project right now?', 'awareness', 'answer'],
    ['What are the other agents doing?', 'awareness', 'answer'],
    ['Reserve the files under src/parser before you start', 'claim', 'manage'],
  ];
  for (const [text, action, cls] of cases) {
    const c = classifyInteraction(text);
    assert.equal(c.coordination?.action, action, text);
    assert.equal(c.class, cls, text);
  }
});

test('the same words in ordinary work are not coordination', () => {
  for (const text of [
    'Hand off the release notes to legal',
    'Review the handoff document for the release',
    'Take over the roadmap presentation next week',
    'Remember that the parser is handed off to the platform team',
    'What does the lock file do?',
    'Write a plan for the migration',
  ]) {
    assert.equal(classifyInteraction(text).coordination, null, text);
  }
});

test('classify_request suggests no workflow for coordination and says which ledger action to use', async () => {
  const fx = brokerFixture();
  try {
    const t = TOOLS.find((x) => x.name === 'classify_request')!;
    const r = (await t.run(fx.broker, t.validate(record({ text: 'Hand this off to the other agent' })))) as { coordination: { action: string }; suggestedWorkflows: unknown[]; next: string };
    assert.equal(r.coordination.action, 'handoff');
    assert.deepEqual(r.suggestedWorkflows, []);
    assert.match(r.next, /work \(action handoff\)/);
  } finally {
    fx.cleanup();
  }
});
