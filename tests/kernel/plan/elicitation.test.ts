/**
 * tests/kernel/plan/elicitation.test.ts — the documents a run hands the user
 * when the answer is in somebody else's head.
 *
 * Three things have to stay true. The family is the three documents it claims
 * to be, each with exactly the slots that make it that document rather than a
 * memo with a new title. The falsifier slot is the decision shape's own
 * question and not a second copy of it — a copy passes a test that hand-lists
 * the same words, and then drifts, and then two documents ask different things
 * under one name. And the templates are ordinary deliverable templates, so the
 * gap machinery that reads every other template reads these unchanged.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allElicitationTemplates,
  elicitationNames,
  elicitationTemplate,
} from '../../../src/kernel/plan/playbooks.ts';
import { slotGaps, unheadedSlots } from '../../../src/kernel/plan/ladder.ts';
import { COMPOSITION_SHAPES } from '../../../src/kernel/run/shapes.ts';

const slotNames = (name: string): string[] => {
  const template = elicitationTemplate(name);
  assert.ok(template, `no elicitation template named ${name}`);
  return template.slots.map((s) => s.name);
};

test('the interview guide asks what each question establishes and what an answer would move', () => {
  assert.equal(elicitationTemplate('interview-guide')?.deliverable, 'interview guide');
  assert.deepEqual(slotNames('interview-guide'), [
    'audience',
    'what-each-question-establishes',
    'what-answer-would-change-what',
  ]);
});

test('the research plan carries its questions, its method, and the rule that ends it', () => {
  assert.equal(elicitationTemplate('research-plan')?.deliverable, 'research plan');
  assert.deepEqual(slotNames('research-plan'), ['questions', 'method', 'stop-rule']);
});

test('a hypothesis is a statement, a falsifier, and the cheapest way to go and look', () => {
  assert.equal(elicitationTemplate('hypotheses')?.deliverable, 'hypotheses');
  assert.deepEqual(slotNames('hypotheses'), ['statement', 'falsifier', 'cheapest-test']);
});

/**
 * The one assertion that must not be written by hand. A test that lists the
 * falsifier's wording itself only proves two hand-copies agree on the day they
 * were typed; this reads the question out of the shape that owns it, so a
 * reworded section either travels into the slot or fails here.
 */
test('the falsifier slot asks the decision shape its own question, not a copy of it', () => {
  const decision = COMPOSITION_SHAPES.find((shape) => shape.name === 'decision');
  assert.ok(decision, 'the decision shape must exist for the falsifier to borrow from');
  const asked = decision.sections.find((section) => section.name === 'what-would-change-it');
  assert.ok(asked, 'the decision shape must still ask what would change it');

  const falsifier = elicitationTemplate('hypotheses')?.slots.find((s) => s.name === 'falsifier');
  assert.ok(falsifier, 'the hypotheses template must carry a falsifier slot');
  assert.ok(
    falsifier.expects.startsWith(asked.expects),
    'the falsifier must be built from the shape section rather than restated beside it',
  );
  assert.notEqual(
    falsifier.expects,
    asked.expects,
    'a hypothesis owes more than a commitment does: the observation has to be one somebody could go and make',
  );
});

test('an unknown elicitation name is refused rather than silently defaulted', () => {
  assert.equal(elicitationTemplate('survey'), undefined);
  assert.equal(elicitationTemplate('review memo'), undefined);
  assert.equal(elicitationTemplate('  HYPOTHESES '), elicitationTemplate('hypotheses'));
});

test('the family is exactly three documents, uniquely named and uniquely slotted', () => {
  const names = elicitationNames();
  assert.deepEqual(names, ['interview-guide', 'research-plan', 'hypotheses']);
  assert.equal(new Set(names).size, names.length);
  assert.equal(allElicitationTemplates().length, names.length);
  for (const template of allElicitationTemplates()) {
    assert.ok(template.deliverable.length > 0);
    const slots = template.slots.map((s) => s.name);
    assert.equal(new Set(slots).size, slots.length, `${template.deliverable} repeats a slot name`);
  }
});

/**
 * A slot whose `expects` merely restates its own name teaches nothing. These
 * documents are handed to a user who is about to go and use them on other
 * people, so every slot has to say what a good entry looks like.
 */
test('every elicitation slot is required and says what belongs in it', () => {
  for (const template of allElicitationTemplates()) {
    for (const slot of template.slots) {
      assert.equal(slot.required, true, `${template.deliverable}/${slot.name} is optional`);
      assert.ok(
        slot.expects.length > slot.name.length,
        `${template.deliverable}/${slot.name} does not say what it expects`,
      );
    }
  }
});

/**
 * These are written before there is anything to conclude. A finding slot here
 * would invite the writer to answer the question they were about to go ask.
 */
test('no elicitation document asks for a finding it cannot have yet', () => {
  for (const template of allElicitationTemplates()) {
    assert.ok(
      !template.slots.some((s) => s.name === 'finding'),
      `${template.deliverable} asks for a conclusion before the asking has happened`,
    );
  }
});

test('the gap machinery reads an elicitation template like any other deliverable', () => {
  const template = elicitationTemplate('research-plan');
  assert.ok(template);

  const gaps = slotGaps(template, { questions: 'does the export path ever time out', method: '  ' });
  assert.deepEqual(gaps.map((g) => g.slot.name), ['method', 'stop-rule']);
  assert.deepEqual([...new Set(gaps.map((g) => g.deliverable))], ['research plan']);

  const written = [
    '## Questions',
    'Does the export path ever time out for accounts over 10k rows?',
    '## Method',
    'Replay last month of export jobs from the logs.',
  ].join('\n');
  assert.deepEqual(
    unheadedSlots(template, written).map((g) => g.slot.name),
    ['stop-rule'],
  );
});
