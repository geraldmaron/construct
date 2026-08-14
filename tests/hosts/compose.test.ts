/**
 * tests/hosts/compose.test.ts — composition prompts speak as Construct.
 *
 * The composer, the closing round, and the position are the three places a
 * model writes prose a reader sees. Voice used to be bound only into the
 * role assignment, so a composed document was the one deliverable commitment 17
 * did not actually reach. These hold that the prompts name Construct as the
 * speaker, bind the house voice, and treat the role as attribution.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closingPrompt,
  composerPrompt,
  formGuidanceForShape,
  positionPrompt,
} from '../../src/hosts/compose.ts';
import { HOUSE_VOICE, voiceProtocol } from '../../src/kernel/voice/voice.ts';
import { COMPOSITION_SHAPES, DEFAULT_SHAPE, shapeByName } from '../../src/kernel/run/shapes.ts';

const SOURCES = [
  { role: 'privacy', text: '## finding\nThe DPA is missing.' },
  { role: 'product-scoping', text: '## finding\nThe beta has no success measure.' },
];

test('the composer is Construct, bound to the house voice, not a specialist', () => {
  const prompt = composerPrompt({
    outcome: 'Launch a paid beta to EU users',
    sources: SOURCES,
    shape: DEFAULT_SHAPE,
  });
  assert.match(prompt, /You are Construct/);
  assert.match(prompt, /framed through composition/);
  assert.doesNotMatch(prompt, /acting as/);
  assert.doesNotMatch(prompt, /Several specialists/);
  for (const rule of HOUSE_VOICE) {
    assert.ok(prompt.includes(rule.rule), `composer must carry the ${rule.id} rule`);
  }
  assert.ok(prompt.includes(voiceProtocol()));
});

test('the composer prefers prose and names form by document shape', () => {
  const review = composerPrompt({
    outcome: 'Look at the beta plan',
    sources: SOURCES,
    shape: DEFAULT_SHAPE,
  });
  assert.match(review, /"paragraph" is the default/);
  assert.doesNotMatch(review, /Most claims are "bullet"/);
  assert.match(review, /Form for this review/);
  assert.ok(review.includes(formGuidanceForShape(DEFAULT_SHAPE)));

  const rfc = composerPrompt({
    outcome: 'Write an RFC for shape governance',
    sources: SOURCES,
    shape: shapeByName('rfc')!,
  });
  assert.match(rfc, /Form for this RFC/);
  assert.match(rfc, /multi-column table/);
  assert.match(rfc, /never a centered list/);

  const spec = composerPrompt({
    outcome: 'Write a PRD for held lessons',
    sources: SOURCES,
    shape: shapeByName('spec')!,
  });
  assert.match(spec, /Form for this spec/);
  assert.match(spec, /one-column table/);
});

test('every shipped shape has named form guidance of its own', () => {
  for (const shape of COMPOSITION_SHAPES) {
    const guidance = formGuidanceForShape(shape);
    assert.match(guidance, /Form for this /);
    if (shape.name !== 'review') {
      assert.doesNotMatch(
        guidance,
        /Form for this review/,
        `${shape.name} must not inherit review form by falling through`,
      );
    }
  }
});

test('a closing answer is Construct speaking in that concern\'s name', () => {
  const prompt = closingPrompt({
    outcome: 'Launch a paid beta to EU users',
    source: SOURCES[0]!,
    gaps: ['who owns the DPA'],
    groundRoots: [],
  });
  assert.match(prompt, /You are Construct/);
  assert.match(prompt, /framed through privacy/);
  assert.doesNotMatch(prompt, /You are the privacy role/);
  assert.ok(prompt.includes(voiceProtocol()));
});

test('Construct\'s call is bound to the same voice as every other deliverable', () => {
  const prompt = positionPrompt({ outcome: 'Decide whether the pilot ships', sources: SOURCES });
  assert.match(prompt, /You are Construct/);
  assert.ok(prompt.includes(voiceProtocol()));
  assert.doesNotMatch(prompt, /Several specialists/);
});
