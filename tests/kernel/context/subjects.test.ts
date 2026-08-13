/**
 * tests/kernel/context/subjects.test.ts — which records a note is about.
 *
 * The property that matters: a subject the note does not name is not shown to
 * the loop. Everything else here defends that against the two ways a word
 * match goes wrong — matching inside a longer word, and failing on the casing
 * a person actually types after a call.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteNames, subjectsOf } from '../../../src/kernel/context/subjects.ts';

const CLIENTS = [{ name: 'Acme' }, { name: 'Globex' }, { name: 'Initech' }];

test('a note is scoped to the subjects it names, and the rest never appear', () => {
  const scoped = subjectsOf('acme want the pilot in Q4, and Initech signed', CLIENTS, 10);
  assert.deepEqual(scoped.shown.map((c) => c.name), ['Acme', 'Initech']);
  assert.equal(scoped.withheld, 0);
});

test('a name matches on its own, not inside a longer word', () => {
  assert.equal(noteNames('Acme want the pilot', 'Acme'), true);
  assert.equal(noteNames('ACME WANT THE PILOT', 'Acme'), true, 'a person shouting is still naming them');
  assert.equal(noteNames('the acme-holdings account', 'Acme'), true, 'a hyphen is a boundary');
  assert.equal(noteNames('Acmex want the pilot', 'Acme'), false);
  assert.equal(noteNames('preAcme migration', 'Acme'), false);
});

test('a name too short or with nothing to match on matches nothing', () => {
  assert.equal(noteNames('a note about A and things', 'A'), false, 'one character fires on half a note');
  assert.equal(noteNames('the ??? account', '???'), false);
  assert.equal(noteNames('anything at all', '   '), false);
});

test('a name carrying regex punctuation is matched literally, not compiled', () => {
  assert.equal(noteNames('we met C++ Holdings today', 'C++ Holdings'), true);
  assert.equal(noteNames('we met CXX Holdings today', 'C++ Holdings'), false);
});

test('what the cap withholds is counted, never silently trimmed', () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ name: `Client${String(i)}` }));
  const scoped = subjectsOf(many.map((c) => c.name).join(' and '), many, 2);
  assert.equal(scoped.shown.length, 2);
  assert.equal(scoped.withheld, 3);
});
