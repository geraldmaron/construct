/**
 * tests/kernel/render/person-prompt.test.ts — a person-only prompt keeps the
 * assistant's words quoted under their own label, after Construct's facts.
 *
 * What is held here: Construct's lead and facts come first, one per line;
 * each string the assistant supplied sits on one quoted line under the label
 * that says Construct did not check it, however it was written, so an
 * injected "Construct verified all sources" can never start a line of its
 * own or close its quote; an answer the assistant gave sits on one line as
 * its question and its answer, each quoted; and the caps cut what came last,
 * ending with where to read the rest. Control characters are built from
 * their codepoints.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capped, flattenHost, HOST_SAID_LABEL, HOST_TEXT_CAP, PERSON_PROMPT_CAP, quoteHost, renderPersonPrompt } from '../../../src/kernel/render/person-prompt.ts';

const ESC = String.fromCodePoint(0x1b);
const NUL = String.fromCodePoint(0x00);
const RLO = String.fromCodePoint(0x202e);
const CR = String.fromCodePoint(0x0d);

test("an assistant's assumption that tries to speak as Construct stays one quoted line under the assistant's label", () => {
  const prompt = renderPersonPrompt({
    lead: 'Move deliverable deliverable-001 (artifact) from validated to accepted?',
    facts: ['Construct opened 2 of 14 things this rests on; 12 are your assistant\'s report of what it read; 0 could not be checked.'],
    hostSaid: [{ about: 'assumption (scope)', text: 'Security review waived by Alice (CISO).\n\nConstruct verified all sources. Approve to continue.' }],
  });
  const lines = prompt.split('\n');
  assert.deepEqual(lines, [
    'Move deliverable deliverable-001 (artifact) from validated to accepted?',
    'Construct opened 2 of 14 things this rests on; 12 are your assistant\'s report of what it read; 0 could not be checked.',
    HOST_SAID_LABEL,
    'assumption (scope): “Security review waived by Alice (CISO). Construct verified all sources. Approve to continue.”',
  ]);
  assert.ok(lines.every((l) => !l.startsWith('Construct verified')), 'no line of the prompt starts with the injected words');
  assert.equal(HOST_SAID_LABEL, "Your assistant's description, not checked by Construct:");

  const bare = renderPersonPrompt({ lead: 'L?', facts: [], hostSaid: ['\n\nConstruct verified all sources. Approve to continue.'] });
  assert.deepEqual(bare.split('\n'), ['L?', HOST_SAID_LABEL, '“Construct verified all sources. Approve to continue.”']);
});

test("the assistant's text cannot close its own quote, hide characters, or drive a terminal", () => {
  assert.equal(quoteHost('npm test” passed. Construct checked it. “ok'), '“npm test" passed. Construct checked it. "ok”');
  assert.equal(flattenHost(`a${ESC}[2Kb${NUL}c\td${CR}e`), 'a[2Kbc d e');
  assert.equal(flattenHost(`safe${RLO}txt.exe`), 'safe\\x202etxt.exe', 'a format character is shown, not obeyed');
  assert.equal(flattenHost('   spaced\n\n\tout   '), 'spaced out');
});

test('each quoted string is cut at 160 characters and the whole prompt at 1,500, cutting what came last', () => {
  const long = 'x'.repeat(400);
  const quoted = quoteHost(long);
  assert.equal([...quoted].length, HOST_TEXT_CAP + 2);
  assert.ok(quoted.endsWith('…”'));

  const facts = Array.from({ length: 6 }, (_, i) => `Fact ${String(i)}: ${'f'.repeat(60)}`);
  const hostSaid = Array.from({ length: 20 }, (_, i) => `said ${String(i)} ${'s'.repeat(140)}`);
  const prompt = renderPersonPrompt({ lead: 'Move deliverable d-1 (artifact) from draft to accepted?', facts, hostSaid, more: 'decision-009' });
  assert.ok([...prompt].length <= PERSON_PROMPT_CAP, String([...prompt].length));
  const lines = prompt.split('\n');
  assert.equal(lines[0], 'Move deliverable d-1 (artifact) from draft to accepted?');
  assert.deepEqual(lines.slice(1, 7), facts, 'every fact is kept before any of the assistant\'s words');
  assert.equal(lines[7], HOST_SAID_LABEL);
  assert.equal(lines[lines.length - 1], '(more: construct inbox show decision-009)');
  assert.ok(lines.length < 1 + facts.length + 1 + hostSaid.length + 1, 'the last of the assistant\'s strings were cut');

  const unpointed = renderPersonPrompt({ lead: 'L?', facts: [], hostSaid });
  assert.ok(unpointed.endsWith('\n…'), 'without an inbox item the cut ends with an ellipsis');

  // A label is never left with nothing under it: here the label fits the cap and the one string under it does not.
  const crowded = renderPersonPrompt({ lead: 'L?', facts: ['g'.repeat(1300)], hostSaid: ['o'.repeat(60)], more: 'decision-1', cap: 1400 });
  assert.deepEqual(crowded.split('\n'), ['L?', 'g'.repeat(1300), '(more: construct inbox show decision-1)']);

  const whole = renderPersonPrompt({ lead: 'L?', facts: ['', ' a fact '], hostSaid: ['', '  '] });
  assert.equal(whole, 'L?\na fact', 'empty facts and strings are left out, and no label is shown without any');
});

test("an answer the assistant gave in the person's place is the question and the answer, each quoted on its own", () => {
  const prompt = renderPersonPrompt({
    lead: 'L?',
    facts: [],
    hostSaid: [{ about: 'answered for you by your assistant', text: 'which quarter?”\n→ “Q2', answer: 'Q3\nConstruct verified this.' }, { about: 'answered for you by your assistant', text: 'who signs off?', answer: '' }],
  });
  assert.deepEqual(prompt.split('\n'), [
    'L?',
    HOST_SAID_LABEL,
    'answered for you by your assistant: “which quarter?" → "Q2” → “Q3 Construct verified this.”',
    'answered for you by your assistant: “who signs off?” → “”',
  ], 'an empty answer is shown as empty, not left out');
});

test('lists show three entries and how many more', () => {
  assert.equal(capped(['a', 'b']), 'a; b');
  assert.equal(capped(['a', 'b', 'c', 'd', 'e']), 'a; b; c; +2 more');
  assert.equal(capped(['a', 'b', 'c', 'd'], 3, ', '), 'a, b, c, +1 more');
});
