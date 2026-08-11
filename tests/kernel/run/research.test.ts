/**
 * tests/kernel/run/research.test.ts — the second rung, and what it is allowed
 * to do.
 *
 * The acquisition ladder has named research since the plan schema was written
 * and never said what the word meant, so every gap in the definition had a
 * default the model supplied: reach for whatever is nearest, cite something
 * that was never opened, quote a summary as if it were the rule, and keep going
 * until the context runs out. These tests hold the four rules that replace
 * those defaults, and they hold them against the text the product actually
 * sends — a protocol asserted in a module and absent from the dispatch is a
 * rule enforced against nobody.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  RESEARCH_PROTOCOL,
  researchCitations,
  undisclosedAggregator,
} from '../../../src/kernel/run/research.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import { runStructuralChallenges } from '../../../src/kernel/challenge/catalog.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

const BRIEF: Brief = {
  id: 't',
  outcome: 'hire a contractor in Poland',
  role: 'employment',
  inputs: [],
  capabilities: [],
  postconditions: [],
  challenges: ['claims-cited'],
};

test('the protocol reaches the role, on the dispatch the product actually sends', () => {
  const assignment = assignmentFor(BRIEF);
  assert.ok(assignment.includes(RESEARCH_PROTOCOL), 'the rung is defined where the role can read it');
});

test('it licenses a capability and never a tool', () => {
  // A brief that picks its own tool is orchestrating itself. The same sentence
  // has to be true on a host with a web tool and on one without.
  assert.match(RESEARCH_PROTOCOL, /if your host gives you a way to read publicly reachable material/i);
  assert.ok(
    !/websearch|web_search|browser tool|curl|fetch\(/i.test(RESEARCH_PROTOCOL),
    'naming a tool would make the protocol false on every host that lacks it',
  );
  assert.match(RESEARCH_PROTOCOL, /you have no\s+research capability on this dispatch/i);
});

test('it states the stop rule, so research cannot become a mode', () => {
  assert.match(RESEARCH_PROTOCOL, /one pass at the gap, not a mode/i);
  assert.match(RESEARCH_PROTOCOL, /stop researching and climb/i);
  assert.match(RESEARCH_PROTOCOL, /never a reason to withhold the work/i);
});

test('it states primary over aggregator as a posture with a disclosure, not a ban', () => {
  assert.match(RESEARCH_PROTOCOL, /A summary of a rule is not the rule/);
  assert.match(RESEARCH_PROTOCOL, /Aggregators are fine for finding the primary source/);
  assert.match(RESEARCH_PROTOCOL, /you did not read the primary source, in the same sentence/);
});

test('a research citation is a distinguishable shape, not a ground citation', () => {
  const found = researchCitations(
    'Notice is 30 days [research: Polish Labour Code art. 36, Dz.U. 1974 nr 24 poz. 141].\n' +
      'The handbook says two weeks [cite:docs/handbook.md].',
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 1);
  assert.match(found[0].cited, /Polish Labour Code/);
});

test('a research citation discharges a claim the same way a ground citation does', () => {
  // Two different qualities of evidence, both citations. A checker that
  // accepted only ground citations would fail an honestly researched claim and
  // teach every role to mislabel the open web as the user's own material.
  const cited = runStructuralChallenges(
    BRIEF,
    'FINDING\nStatutory notice runs to 30 days [research: Polish Labour Code art. 36, Dz.U. 1974 nr 24 poz. 141].\n',
  );
  const claims = cited.results.find((r) => r.challenge === 'claims-cited');
  assert.equal(claims?.passed, true, claims?.detail);

  const bare = runStructuralChallenges(BRIEF, 'FINDING\nStatutory notice runs to 30 days.\n');
  assert.equal(bare.results.find((r) => r.challenge === 'claims-cited')?.passed, false);
});

test('an aggregator cited without saying the primary went unread is the trap', () => {
  const body =
    'FINDING\nNotice is 30 days [research: an explainer blog on Polish employment law].\n';
  const [citation] = researchCitations(body);
  assert.ok(undisclosedAggregator(citation, body), 'the reader cannot tell this from the statute');
});

test('the same aggregator disclosed is not the trap', () => {
  const body =
    'FINDING\nNotice is 30 days [research: an explainer blog on Polish employment law]; ' +
    'I did not read the primary source, so this is the summary only.\n';
  const [citation] = researchCitations(body);
  assert.ok(!undisclosedAggregator(citation, body));
});

test('the planted trap scores, and scores in both directions', () => {
  // A check that only ever passes measures nothing. Each recorded run is
  // scored through the shipped script, and the two failures fail for
  // different, named reasons — an undisclosed summary is not the same defect
  // as an unmarked claim, and a checker that conflated them would report the
  // wrong fix.
  const score = (name: string): { code: number; out: string } => {
    const result = spawnSync(
      process.execPath,
      ['scripts/check-research-discipline.mjs', `fixtures/research-trap/runs/${name}.json`, '--json'],
      { encoding: 'utf8' },
    );
    return { code: result.status ?? -1, out: result.stdout };
  };

  const primary = score('2026-08-10-primary-cited');
  assert.equal(primary.code, 0);
  assert.equal(JSON.parse(primary.out).citedPrimary, true);

  const disclosed = score('2026-08-10-aggregator-disclosed');
  assert.equal(disclosed.code, 0, 'citing a summary and saying so is the honest reach, not the trap');

  const undisclosedRun = score('2026-08-10-aggregator-undisclosed');
  assert.equal(undisclosedRun.code, 1);
  assert.match(JSON.parse(undisclosedRun.out).checks[2].detail, /without saying the primary text went unread/);

  const unmarked = score('2026-08-10-unmarked');
  assert.equal(unmarked.code, 1);
  assert.match(JSON.parse(unmarked.out).checks[0].detail, /carry no marker/);
});

test('a primary citation is never flagged as an aggregator', () => {
  const body = 'FINDING\nNotice is 30 days [research: Polish Labour Code art. 36, Dz.U. 1974].\n';
  const [citation] = researchCitations(body);
  assert.ok(!undisclosedAggregator(citation, body));
});
