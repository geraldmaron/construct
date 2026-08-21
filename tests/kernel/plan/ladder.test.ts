/**
 * tests/kernel/plan/ladder.test.ts — an empty required slot is a
 * machine-checkable gap, the ladder climbs in its stated order, and asking
 * the human batches to the inbox with an assumed default so nothing blocks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import { openDecisions } from '../../../src/kernel/store/decisions.ts';
import { batchAskHuman, nextRung, slotGaps, slotSection } from '../../../src/kernel/plan/ladder.ts';
import { allElicitationTemplates, allPlaybooks, playbookFor } from '../../../src/kernel/plan/playbooks.ts';
import { ACCEPTANCE_CRITERION_CLAUSE } from '../../../src/kernel/run/shapes.ts';
import { ANSWER_TEMPLATE } from '../../../src/kernel/run/ask.ts';
import { CONTENT_FORMS } from '../../../src/kernel/voice/voice.ts';

const AT = '2026-08-05T00:00:00.000Z';

test('an empty or whitespace required slot is a gap; optional slots never are', () => {
  const template = playbookFor('security').template;
  const gaps = slotGaps(template, {
    finding: 'exposed webhook lacks auth',
    evidence: '  ',
    // risks, attack-surface, mitigations missing; open-questions is optional
  });
  const names = gaps.map((g) => g.slot.name);
  assert.deepEqual(names, [
    'evidence',
    'risks',
    'attack-surface',
    'mitigations',
    'threat-paths',
    'security-obligation',
  ]);
  assert.ok(!names.includes('open-questions'));
});

/**
 * A template says two things about the deliverable: what it must carry (its
 * slots) and what shape the carrying takes (its form). The second was missing,
 * and while it was missing one dispatch directive supplied the same answer for
 * every template in the catalog — numbered issues, for a PRD as readily as for
 * a privacy review.
 */
test('every template declares a form, and it is one the voice knows how to speak', () => {
  const known = new Set<string>(CONTENT_FORMS);
  const templates = [
    ...allPlaybooks().map((p) => p.template),
    ...allElicitationTemplates(),
    ANSWER_TEMPLATE,
  ];
  for (const template of templates) {
    assert.ok(known.has(template.form), `${template.deliverable} declares an unknown form`);
  }
  // The forms are not decoration: the deliverables that actually differ in
  // shape declare different ones.
  assert.equal(playbookFor('privacy').template.form, 'issues');
  assert.equal(playbookFor('product-scoping').template.form, 'requirements');
  assert.equal(playbookFor('program-sequencing').template.form, 'sequence');
  assert.equal(playbookFor('strategy-alignment').template.form, 'prose');
  // An unknown domain gets the default memo, which assumes least about content
  // nobody has described.
  assert.equal(playbookFor('no-such-domain').template.form, 'prose');
});

test('a fully filled template has no gaps', () => {
  const template = playbookFor('unknown-domain').template;
  const filled = Object.fromEntries(template.slots.map((s) => [s.name, 'content']));
  assert.deepEqual(slotGaps(template, filled), []);
});

test('the ladder climbs read-sources, research, ask-human, assume-and-label, then ends', () => {
  assert.equal(nextRung([]), 'read-sources');
  assert.equal(nextRung(['read-sources']), 'research');
  assert.equal(nextRung(['read-sources', 'research']), 'ask-human');
  assert.equal(nextRung(['read-sources', 'research', 'ask-human']), 'assume-and-label');
  assert.equal(nextRung(['read-sources', 'research', 'ask-human', 'assume-and-label']), null);
});

test('ask-human batches to the inbox, each question carrying its assumed default', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    const gap = slotGaps(playbookFor('security').template, {})[0]!;
    const ids = batchAskHuman(
      store,
      'run-1',
      'plan-run-1',
      [
        { gap, assumedDefault: 'no finding yet; treat as unassessed', basis: 'plan-run-1' },
        { gap, assumedDefault: 'assume public exposure', basis: 'plan-run-1' },
      ],
      AT,
    );
    assert.equal(ids.length, 2);
    const open = openDecisions(store, 'run-1');
    assert.equal(open.length, 2);
    const positions = open[0]!.positions;
    assert.equal(positions.length, 2);
    assert.equal(positions[1]?.role, 'assumed-default');
    assert.equal(positions[1]?.stance, 'no finding yet; treat as unassessed');
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('a question with no assumed default is refused: that is a stall in disguise', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    const gap = slotGaps(playbookFor('security').template, {})[0]!;
    assert.throws(
      () => batchAskHuman(store, 'run-1', 'plan-run-1', [{ gap, assumedDefault: '  ', basis: 'x' }], AT),
      /ships no assumed default/,
    );
    assert.equal(openDecisions(store, 'run-1').length, 0);
  } finally {
    store.close();
    fixture.cleanup();
  }
});

test('product-scoping ships the document a product manager hands a team', () => {
  const template = playbookFor('product-scoping').template;
  assert.equal(template.deliverable, 'product requirements document');
  const names = template.slots.map((s) => s.name);
  for (const required of ['users-and-problem', 'in-scope', 'out-of-scope', 'success-measures']) {
    const found = template.slots.find((s) => s.name === required);
    assert.ok(found?.required, `${required} is a required slot`);
  }
  assert.ok(names.includes('phasing'), 'phasing is present, optional');
  assert.ok(
    playbookFor('program-sequencing').template.slots.some((s) => s.name === 'milestones'),
    'sequencing carries milestones',
  );
  const inScope = template.slots.find((s) => s.name === 'in-scope');
  assert.ok(
    inScope?.expects.includes(ACCEPTANCE_CRITERION_CLAUSE),
    'the slot that carries a PRD\'s requirements demands the same checkability the spec shape does, not a restated copy',
  );
});

test('each new concern ships a deliverable shaped like the seat it fills', () => {
  const expected: Record<string, readonly string[]> = {
    'strategy-alignment': ['the-bet', 'price', 'decision-owner', 'displaced-work'],
    'system-design': ['boundaries', 'reversibility', 'migration', 'hard-to-undo'],
    operations: ['failure-paths', 'ownership', 'rollback', 'operability-gaps'],
    'user-experience': ['the-path', 'unhandled-states', 'flow-dead-ends'],
  };
  for (const [domain, required] of Object.entries(expected)) {
    const template = playbookFor(domain).template;
    assert.notEqual(template.deliverable, 'review memo', `${domain} still falls back to the memo`);
    for (const name of required) {
      const found = template.slots.find((s) => s.name === name);
      assert.ok(found?.required, `${domain} is missing required slot ${name}`);
    }
  }
});

test('measurement ships the plan an analyst hands back: whether the number can exist', () => {
  const template = playbookFor('measurement').template;
  assert.equal(template.deliverable, 'measurement plan');
  assert.equal(template.form, 'prose');
  for (const required of ['baseline', 'instrumentation', 'measurement-gaps']) {
    const found = template.slots.find((s) => s.name === required);
    assert.ok(found?.required, `${required} is a required slot`);
  }
});

test('issue-spotting templates say so; a PRD is a document', () => {
  assert.equal(playbookFor('privacy').template.form, 'issues');
  assert.equal(playbookFor('compliance').template.form, 'issues');
  assert.equal(playbookFor('compliance').template.deliverable, 'compliance review');
  assert.equal(playbookFor('product-scoping').template.form, 'requirements');
  assert.equal(playbookFor('strategy-alignment').template.form, 'prose');
});

/**
 * Reading what is in a slot, not just that it is headed. A check about one
 * slot's content needs the body, and prose that merely mentions the slot name
 * must not read as the slot — the deliverable that made this necessary
 * discussed its own decision-owner section by name three sections later.
 */
test('a slot section is read from its heading to the next one, in the forms a role writes it', () => {
  const deliverable =
    '## price\n\nUnstated in the material.\n\n' +
    '## decision-owner\n\nD. Okafor, VP Engineering.\nAsked to decide, not informed.\n\n' +
    '## displaced-work\n\nThe wind-down, discussed under decision-owner above.\n';

  assert.equal(
    slotSection(deliverable, 'decision-owner'),
    'D. Okafor, VP Engineering.\nAsked to decide, not informed.',
  );
  assert.equal(slotSection(deliverable, 'price'), 'Unstated in the material.');
  assert.equal(slotSection(deliverable, 'rollback'), null);
});

test('an inline label carries its value, and a bare mention of the slot name is not the slot', () => {
  assert.equal(slotSection('**Decision owner:** D. Okafor\n', 'decision-owner'), 'D. Okafor');
  assert.equal(slotSection('- decision owner — the VP of Engineering\n', 'decision-owner'), 'the VP of Engineering');
  assert.equal(slotSection('A different, narrower decision than decision-owner asks for.\n', 'decision-owner'), null);
});
