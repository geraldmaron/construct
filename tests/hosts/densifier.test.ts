/**
 * tests/hosts/densifier.test.ts — the intake densifier's contract.
 *
 * The inputs here are verbatim entries from the harvested rough-framings
 * corpus (user-authored, provenance in the fixture), because the whole point
 * of the seam is how outcomes actually arrive — a matcher validated on text
 * written to be parseable validates nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { densifierPrompt, parseDensified } from '../../src/hosts/densifier.ts';
import { toDensifiedIntake } from '../../src/kernel/intake/densify.ts';

const CORPUS = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'rough-framings.json'), 'utf8'),
) as { framings: { text: string }[] };

test('the prompt carries every corpus framing verbatim — extraction reads the real words', () => {
  for (const framing of CORPUS.framings) {
    assert.ok(
      densifierPrompt(framing.text).includes(framing.text),
      `framing not carried verbatim: ${framing.text.slice(0, 40)}…`,
    );
  }
});

test('a fenced reply parses; the wrapper is a formatting habit, not a failure', () => {
  const parsed = parseDensified(
    'Sure! Here you go:\n```json\n{"outcome":"Hire a contractor in Poland compliantly","constraints":["budget is limited"],"decisions":[],"parked":["the mobile app question"]}\n```',
  );
  assert.equal(parsed.outcome, 'Hire a contractor in Poland compliantly');
  assert.deepEqual(parsed.parked, ['the mobile app question']);
});

test('a blank outcome is a failure, not a result', () => {
  assert.throws(() => toDensifiedIntake({ outcome: '  ', constraints: [] }), /no outcome/);
  assert.throws(() => parseDensified('no json here at all'), /no JSON/);
});

test('non-string and empty list entries are dropped, not passed downstream', () => {
  const parsed = toDensifiedIntake({
    outcome: 'x',
    constraints: ['keep', '', 42, '  also keep  '],
    decisions: null,
  });
  assert.deepEqual(parsed.constraints, ['keep', 'also keep']);
  assert.deepEqual(parsed.decisions, []);
});
