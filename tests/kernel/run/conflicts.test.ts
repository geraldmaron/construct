/**
 * tests/kernel/run/conflicts.test.ts — a cross-domain disagreement becomes one
 * framed decision, and nothing else does.
 *
 * The parser cases marked "observed" came off a live OpenCode run against a
 * local model, not from imagination, because that is the only way a matcher
 * over model output earns any trust: a hermetic fixture proves the regex works
 * on the string its author thought of. Three roles answering the same
 * three-line instruction returned three different shapes — plain, bold-wrapped
 * with unbalanced asterisks, and a bold label with the colon inside — and all
 * three had to parse before this was worth shipping.
 *
 * Framing is deterministic and covered here in full. That live run produced no
 * conflict to observe (all three roles said hold, which is correctly not a
 * decision), so the disagreement cases are constructed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STANCE_PROTOCOL,
  frameConflict,
  isConflict,
  parseStance,
  stanceLabel,
} from '../../../src/kernel/run/conflicts.ts';
import type { RoleStance } from '../../../src/kernel/run/conflicts.ts';

const AT = '2026-08-03T00:00:00.000Z';

function stance(
  role: string,
  stance: string,
  because: string | null,
  citation: string | null,
  qualifier: string | null = null,
): RoleStance {
  return {
    role,
    declared: { stance: stance as RoleStance['declared']['stance'], qualifier, because, citation },
  };
}

test('the protocol asks for the three lines and says unclear is a real answer', () => {
  assert.match(STANCE_PROTOCOL, /STANCE: proceed \| hold \| unclear/);
  assert.match(STANCE_PROTOCOL, /do not pick a side you cannot support/);
});

test('a declared stance is parsed through whatever markdown wraps it', () => {
  // Observed: privacy and program-sequencing, live.
  const plain = parseStance(
    'Some analysis.\n\nSTANCE: hold\nBECAUSE: no processing agreement is in place\nCITE: GDPR Art. 28',
  );
  assert.deepEqual(plain, {
    stance: 'hold',
    // A plainly declared stance carries no qualifier — see the qualifier tests
    // below for the case where the role wrote one.
    qualifier: null,
    because: 'no processing agreement is in place',
    citation: 'GDPR Art. 28',
  });

  // Observed: product-scoping, live, in the same run as the plain one above —
  // bold around the whole line and an asterisk pair that never closes.
  const wrapped = parseStance(
    '**STANCE: hold**\n**BECAUSE: consumer rights documentation is not verified\n**CITE: none',
  );
  assert.equal(wrapped?.stance, 'hold');
  assert.equal(wrapped?.because, 'consumer rights documentation is not verified');
  assert.equal(wrapped?.citation, null);

  const bold = parseStance('**STANCE:** proceed\n**BECAUSE:** the date has slack\n**CITE:** none');
  assert.equal(bold?.stance, 'proceed');
  assert.equal(bold?.citation, null, '"none" is not a citation');

  const listed = parseStance('- STANCE: unclear\n- BECAUSE: the outcome does not say where\n- CITE: n/a');
  assert.equal(listed?.stance, 'unclear');

  const heading = parseStance('### STANCE - hold\n### BECAUSE - the vendor is unnamed');
  assert.equal(heading?.stance, 'hold');
  assert.equal(heading?.citation, null);
});

test('a stance that was not declared is never guessed at', () => {
  assert.equal(parseStance('I have serious concerns about this and would wait.'), null);
  assert.equal(parseStance(''), null);
  assert.equal(parseStance(null), null);
  assert.equal(parseStance('STANCE: maybe'), null, 'only the declared vocabulary counts');
  assert.equal(parseStance('STANCE:'), null);
  // "hold on" starts with the word, and a role that wrote it declared hold —
  // with a qualifier, which is kept rather than dropped.
  assert.equal(parseStance('STANCE: hold on the launch')?.stance, 'hold');
  assert.equal(parseStance('STANCE: hold on the launch')?.qualifier, 'on the launch');
});

test('a qualified stance is not recorded as the plain one', () => {
  // Observed live on run-20260804174150559 (accessibility), quoted verbatim.
  const declared = parseStance(
    [
      'STANCE: proceed with conditions',
      'BECAUSE: the outcome is valid but "usable by blind customers" requires',
      'specifying which assistive technologies to test with and what success',
      'criteria define "usable" before development begins.',
    ].join('\n'),
  );

  assert.equal(declared?.stance, 'proceed');
  assert.equal(
    declared?.qualifier,
    'with conditions',
    'the qualifier is the role\'s position, not decoration around it',
  );
  assert.equal(stanceLabel(declared!), 'proceed with conditions');
});

test('a punctuation tail is decoration, not a qualifier', () => {
  // These parsed correctly before the parser fix and must keep doing so: the
  // tolerance for a decorated line is what makes live model output usable.
  for (const raw of ['proceed.', 'proceed --', 'hold!', 'proceed  ', 'unclear —', 'hold,']) {
    const declared = parseStance(`STANCE: ${raw}`);
    assert.ok(declared, `"${raw}" should still declare a stance`);
    assert.equal(declared.qualifier, null, `"${raw}" carries no qualifier`);
    assert.equal(stanceLabel(declared), declared.stance);
  }
});

test('the framing never reports a role as plainer than it wrote', () => {
  const decision = frameConflict({
    run: 'run-2',
    outcome: 'make checkout usable by blind customers',
    at: AT,
    stances: [
      stance('accessibility', 'proceed', 'success criteria are undefined', null, 'with conditions'),
      stance('commerce-tax', 'proceed', 'no tax impact', null),
      stance('privacy', 'hold', 'no processing agreement', 'GDPR Art. 28'),
    ],
  });

  assert.ok(decision);
  // The defect in one assertion: this used to read "2 say proceed", counting a
  // role that named a precondition among the unqualified proceeds.
  assert.doesNotMatch(decision.question, /2 say proceed\b/);
  assert.match(decision.question, /1 role\(s\) say hold/);
  assert.match(decision.question, /1 say proceed with conditions/);
  assert.match(decision.question, /1 say proceed\b/);

  const accessibility = decision.positions.find((p) => p.role === 'accessibility');
  assert.match(accessibility!.stance, /^proceed with conditions — /);
});

test('a restated block resolves to the final declaration', () => {
  const text = [
    'Draft answer:',
    'STANCE: unclear',
    '',
    'On reflection:',
    'STANCE: hold',
    'BECAUSE: the transfer basis is missing',
  ].join('\n');
  assert.equal(parseStance(text)?.stance, 'hold');
  assert.equal(parseStance(text)?.because, 'the transfer basis is missing');
});

test('hold against proceed is a conflict; agreement is not', () => {
  assert.equal(
    isConflict([stance('privacy', 'hold', null, null), stance('program', 'proceed', null, null)]),
    true,
  );
  assert.equal(
    isConflict([stance('privacy', 'proceed', null, null), stance('program', 'proceed', null, null)]),
    false,
  );
  assert.equal(
    isConflict([stance('privacy', 'hold', null, null), stance('program', 'unclear', null, null)]),
    false,
    'one side plus a shrug is not a decision',
  );
  assert.equal(isConflict([]), false);
});

test('a conflict frames both sides with citations and picks neither', () => {
  const decision = frameConflict({
    run: 'run-1',
    outcome: 'launch a paid beta to EU users next month',
    at: AT,
    stances: [
      stance('program-sequencing', 'proceed', 'the date has slack', 'the launch plan'),
      stance('privacy', 'hold', 'no processing agreement is in place', 'GDPR Art. 28'),
      stance('product-scoping', 'unclear', 'scope is not stated', null),
    ],
  });

  assert.ok(decision);
  assert.equal(decision.id, 'run-1:stance');
  assert.match(decision.question, /1 role\(s\) say hold, 1 say proceed/);
  assert.match(decision.question, /yours to call/);

  assert.deepEqual(
    decision.positions.map((p) => p.role),
    ['privacy', 'program-sequencing'],
    'ordered by name — any other order would be a precedence the user cannot see',
  );
  assert.deepEqual(decision.positions[0], {
    role: 'privacy',
    stance: 'hold — no processing agreement is in place',
    citation: 'GDPR Art. 28',
  });
  assert.ok(
    !JSON.stringify(decision).match(/recommend|suggest|should probably/i),
    'framing must not arbitrate',
  );
});

test('no disagreement produces no inbox item', () => {
  const agreed = frameConflict({
    run: 'run-1',
    outcome: 'x',
    at: AT,
    stances: [
      stance('privacy', 'proceed', 'nothing personal is processed', null),
      stance('security', 'proceed', null, null),
    ],
  });
  assert.equal(agreed, null, 'a report is not a decision');

  assert.equal(
    frameConflict({ run: 'run-1', outcome: 'x', at: AT, stances: [] }),
    null,
    'a run where nobody declared a stance has nothing to frame',
  );
});

test('an uncited position survives as uncited rather than being dropped', () => {
  const decision = frameConflict({
    run: 'r',
    outcome: 'x',
    at: AT,
    stances: [
      stance('privacy', 'hold', 'this needs a lawyer', null),
      stance('program', 'proceed', 'the date is real', 'the schedule'),
    ],
  });
  assert.equal(decision?.positions.find((p) => p.role === 'privacy')?.citation, null);
});
