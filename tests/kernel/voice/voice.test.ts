/**
 * tests/kernel/voice/voice.test.ts — Construct sounds like itself.
 *
 * The rule these hold is the one commitment 17 states: the voice is bound into
 * the assignment before a role writes anything, it is the same on every
 * deliverable, and the only way past it is a user override that gets recorded.
 * The predecessor's approach — scan the finished deliverable for banned words and
 * fail it afterwards — is deliberately absent, so there is nothing here that
 * asserts a regex ever ran.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_VOICE, voiceProtocol } from '../../../src/kernel/voice/voice.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import { parseWorkArgs } from '../../../src/cli/index.ts';

const BRIEF: Brief = {
  id: 'run-1:privacy',
  outcome: 'Launch a paid beta to EU users',
  role: 'privacy',
  inputs: [],
  capabilities: [],
  postconditions: [],
};

test('every role is handed the same voice, bound before the work rather than checked after', () => {
  const assignment = assignmentFor(BRIEF);
  for (const rule of HOUSE_VOICE) {
    assert.ok(assignment.includes(rule.rule), `assignment must carry the ${rule.id} rule`);
  }
  // Same block for a different role: identity is not a per-role option.
  const other = assignmentFor({ ...BRIEF, role: 'security' });
  assert.equal(voiceProtocol(), voiceProtocol());
  for (const rule of HOUSE_VOICE) assert.ok(other.includes(rule.rule));
});

test("an override replaces the house voice rather than arguing with it", () => {
  const override = { instruction: 'Write it as a limerick.', source: 'cli --voice' };
  const assignment = assignmentFor(BRIEF, undefined, { voice: override });

  assert.ok(assignment.includes('Write it as a limerick.'));
  // Two voice blocks in one prompt is a role asked to sound like two things.
  for (const rule of HOUSE_VOICE) {
    assert.ok(!assignment.includes(rule.rule), `${rule.id} must not survive an override`);
  }
  // The user's words are carried verbatim, not restated in the house register.
  assert.match(voiceProtocol(override), /the voice the user asked for/);
});

test('the voice is stated positively and names the hype vocabulary it refuses', () => {
  const house = voiceProtocol();
  assert.match(house, /Lead with the finding/);
  assert.match(house, /seamless/);
  assert.match(house, /best-in-class/);
  // A gap named is a real answer, and the voice says so rather than implying it.
  assert.match(house, /could not determine/);
});

test('the CLI carries an override through, and blank is not an override', () => {
  assert.equal(parseWorkArgs(['--voice=Write it as a limerick.']).voice, 'Write it as a limerick.');
  assert.equal(parseWorkArgs(['--voice=   ']).voice, undefined);
  assert.equal(parseWorkArgs([]).voice, undefined);
});
