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
import {
  HOUSE_VOICE,
  carriesVoice,
  constructIdentity,
  frameHostTask,
  voiceProtocol,
} from '../../../src/kernel/voice/voice.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';
import { findUntaggedClaims } from '../../../src/kernel/verify/claims.ts';
import { parseWorkArgs } from '../../../src/cli/index.ts';

/**
 * Every way a prompt in this system declares who is writing it. One of these
 * per prompt is the invariant; two was the defect — a dispatch that said "you
 * are acting as the privacy role" and then, further down, bound the house
 * voice, leaving the model to pick which one it was.
 */
const IDENTITY_DECLARATIONS = /You are (?:Construct|acting as|the [a-z-]+ role)/g;

function identityCount(text: string): number {
  return text.match(IDENTITY_DECLARATIONS)?.length ?? 0;
}

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

test('the voice covers register, not only vocabulary', () => {
  const house = voiceProtocol();
  // Lead with the finding, then narrate how you got there.
  assert.match(house, /Lead with the finding/);
  assert.match(house, /tell the story/i);
  // Human, not corporate.
  assert.match(house, /colleague who stepped away/);
  assert.match(house, /Contractions are fine/);
  // The hype list is named outright rather than left to taste.
  assert.match(house, /seamless/);
  assert.match(house, /best-in-class/);
  // Punctuation: dashes are a last resort, not a rhythm.
  assert.match(house, /em dash only where none of those works/);
  // A gap named is a real answer, and the voice says so rather than implying it.
  assert.match(house, /could not determine/);
});

test('the voice asks for language a reader can see themselves in', () => {
  const house = voiceProtocol();
  assert.match(house, /they\/them for a person whose pronouns you have not been told/);
  assert.match(house, /never guess from a name/);
  assert.match(house, /ableist shorthand/);
});

test('the voice teaches the citation notation the deterministic check reads', () => {
  const house = voiceProtocol();
  assert.match(house, /Never invent a fact/);
  // The notation must match what verify/claims.ts actually looks for, or the
  // role is being held to a rule it was shown in different words.
  assert.match(house, /\[cite:/);
  assert.match(house, /\[unverified\]/);

  const taught = 'Churn rose 4% last quarter [cite:billing export 2026-07-01] and the trend held.';
  assert.deepEqual(findUntaggedClaims(taught), []);
  assert.equal(findUntaggedClaims('Churn rose 4% last quarter.').length, 1);
});

test('a role gets one identity instruction, not two: the framing and the voice are one statement', () => {
  const identity = constructIdentity({ framedBy: 'privacy', concern: 'personal data and consent' });
  assert.equal(identityCount(identity), 1, 'one declaration of who is writing, and only one');
  assert.match(identity, /^You are Construct\./);
  assert.match(identity, /framed by the privacy role/);
  assert.match(identity, /Your concern: personal data and consent\./);
  // The framing is what the reader is told about the result, not a second
  // author with a register of its own.
  assert.match(identity, /not a second identity/);
  assert.match(identity, /no register of its own/);
  for (const rule of HOUSE_VOICE) assert.ok(identity.includes(rule.rule), `${rule.id} travels with it`);

  // And the same holds where the assignment is actually built.
  const assignment = assignmentFor(BRIEF);
  assert.equal(identityCount(assignment), 1, 'the dispatch declares an identity once');
  assert.ok(!assignment.includes('You are acting as'), 'the dual-instruction form is gone');
});

test('framing with nothing narrower than Construct still says who is writing, once', () => {
  const identity = constructIdentity();
  assert.equal(identityCount(identity), 1);
  assert.match(identity, /published in Construct's name/);
  assert.ok(!identity.includes('Your concern:'), 'no concern is invented for work nothing framed');
});

test('a host task is framed once: already-bound tasks pass through untouched', () => {
  const bare = frameHostTask({ role: 'security', task: 'Issue-spot this DPA.' });
  assert.equal(identityCount(bare), 1);
  assert.ok(bare.endsWith('Issue-spot this DPA.'), 'the caller\'s task is carried, not rewritten');
  assert.ok(carriesVoice(bare));

  // What the coordinator builds arrives already bound. Framing it again would
  // be the doubling this seam exists to end.
  const assignment = assignmentFor(BRIEF);
  assert.equal(frameHostTask({ role: 'privacy', task: assignment }), assignment);
  assert.equal(identityCount(frameHostTask({ role: 'privacy', task: assignment })), 1);

  // An override in force travels into the host framing rather than being
  // replaced by the house rules on the way in.
  const overridden = frameHostTask({
    role: 'security',
    task: 'Issue-spot this DPA.',
    voice: { instruction: 'Write it as a limerick.', source: 'cli --voice' },
  });
  assert.match(overridden, /Write it as a limerick\./);
  for (const rule of HOUSE_VOICE) assert.ok(!overridden.includes(rule.rule));
  assert.ok(carriesVoice(overridden));
});

test('the CLI carries an override through, and blank is not an override', () => {
  assert.equal(parseWorkArgs(['--voice=Write it as a limerick.']).voice, 'Write it as a limerick.');
  assert.equal(parseWorkArgs(['--voice=   ']).voice, undefined);
  assert.equal(parseWorkArgs([]).voice, undefined);
});
