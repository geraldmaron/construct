/**
 * tests/kernel/workflow/consequence.test.ts — rigor comes from what the work
 * does. Structure sets the floor, host stakes and the labeled lexical floor
 * only raise it, and only a side project with nothing raised is light.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessConsequence, DEPTHS, STAKE_AREAS, wordsOf, type ConsequenceInput, type Judgment, type Stakes } from '../../../src/kernel/workflow/consequence.ts';
import { PROJECT_SCALES, type ProjectScale } from '../../../src/kernel/state/profile.ts';
import { ACTION_TIERS } from '../../../src/kernel/state/steps.ts';

const SCALES: readonly (ProjectScale | null)[] = [...PROJECT_SCALES, null];

function judge(words: string, scale: ProjectScale | null, extra: Partial<ConsequenceInput> = {}): Judgment {
  return assessConsequence({
    scale,
    workflowChallenge: false,
    stepTiers: [],
    boundSkills: [],
    chosenSkill: null,
    activeContradictions: 0,
    stakes: null,
    words,
    ...extra,
  });
}

const rank = (j: Judgment) => DEPTHS.indexOf(j.depth);
const kinds = (j: Judgment) => j.signals.filter((s) => s.raises).map((s) => s.kind);

test('each structural row raises on its own, names itself, and leaves benign words alone', () => {
  const rows: readonly { readonly name: string; readonly extra: Partial<ConsequenceInput>; readonly kind: string; readonly detail: RegExp }[] = [
    { name: 'workflow', extra: { workflowChallenge: true }, kind: 'workflow', detail: /workflow declares/ },
    { name: 'external_write', extra: { stepTiers: ['draft', 'external_write'] }, kind: 'tier', detail: /external_write/ },
    { name: 'destructive', extra: { stepTiers: ['destructive', 'external_write'] }, kind: 'tier', detail: /destructive/ },
    { name: 'licensed_judgment', extra: { stepTiers: ['licensed_judgment'] }, kind: 'tier', detail: /licensed_judgment/ },
    { name: 'contradiction', extra: { activeContradictions: 1 }, kind: 'contradiction', detail: /contradiction/ },
    { name: 'irreversible', extra: { stakes: { reversible: false, affects: [] } }, kind: 'host_stakes', detail: /hard to undo/ },
  ];
  for (const row of rows) {
    for (const scale of SCALES) {
      const j = judge('Write a short status update', scale, row.extra);
      assert.equal(j.depth, 'challenged', `${row.name} at ${String(scale)}`);
      assert.equal(j.challenge, true);
      assert.deepEqual(kinds(j), [row.kind], row.name);
      assert.match(j.signals[0]!.detail, row.detail);
      assert.match(j.why, /^challenge before treating the result as strongly validated: /);
      assert.ok(j.why.includes(j.signals[0]!.detail), 'why lists the raising detail');
    }
  }
  for (const tier of ACTION_TIERS.filter((t) => t === 'observe' || t === 'draft' || t === 'project_write')) {
    assert.equal(judge('Write a short status update', 'team', { stepTiers: [tier] }).depth, 'standard', `${tier} does not raise`);
  }
});

test('every stake area other than none raises, and says what it touches', () => {
  for (const area of STAKE_AREAS) {
    const stakes: Stakes = { reversible: true, affects: [area] };
    const j = judge('Write a short status update', 'side_project', { stakes });
    if (area === 'none') {
      assert.equal(j.depth, 'light', 'none touches nothing');
      assert.deepEqual(kinds(j), []);
      continue;
    }
    assert.equal(j.depth, 'challenged', area);
    assert.deepEqual(kinds(j), ['host_stakes'], area);
    assert.match(j.signals[0]!.detail, new RegExp(`touches ${area.replace(/_/g, ' ')}`));
  }
  const both = judge('Write a short status update', 'team', { stakes: { reversible: false, affects: ['money', 'public'] } });
  assert.equal(both.signals[0]!.detail, 'the host reported it is hard to undo and touches money, public');
  assert.equal(judge('Write a short status update', 'team', { stakes: { reversible: null, affects: [] } }).depth, 'standard', 'unknown reversibility alone does not raise');
});

test('raise-only: stakes never lower the depth, and nothing falls below the structural floor', () => {
  const words = ['', 'Fix a typo in the README', 'Refactor the ownership of the billing reports', 'Retune the postgres indexes', 'Migrate the billing schema to the new platform', 'Fix the typo in the drop table migration'];
  const tierSets: readonly (readonly (typeof ACTION_TIERS)[number][])[] = [[], ['draft', 'project_write'], ['external_write'], ['destructive']];
  const stakeSets: readonly (Stakes | null)[] = [null, { reversible: true, affects: [] }, { reversible: true, affects: ['none'] }, { reversible: false, affects: [] }, { reversible: true, affects: ['customers'] }];
  const skills: readonly (string | null)[] = [null, 'system-architecture', 'adversarial-review', 'program-delivery'];
  for (const scale of SCALES) {
    for (const stepTiers of tierSets) {
      for (const contradictions of [0, 1]) {
        const floor = judge('', scale, { stepTiers, activeContradictions: contradictions });
        for (const w of words) {
          for (const chosenSkill of skills) {
            const without = judge(w, scale, { stepTiers, activeContradictions: contradictions, chosenSkill });
            assert.ok(rank(without) >= rank(floor), `words cannot lower the floor: ${w} at ${String(scale)}`);
            for (const stakes of stakeSets) {
              const withStakes = judge(w, scale, { stepTiers, activeContradictions: contradictions, chosenSkill, stakes });
              assert.ok(rank(withStakes) >= rank(without), `stakes cannot lower: ${w} at ${String(scale)} with ${JSON.stringify(stakes)}`);
              assert.ok(rank(withStakes) >= rank(floor));
              assert.equal(withStakes.challenge, withStakes.depth === 'challenged');
            }
          }
        }
      }
    }
  }
});

test('a typo in a drop table migration is challenged at every scale, by a labeled lexical signal', () => {
  for (const scale of SCALES) {
    const j = judge('Fix the typo in the drop table migration', scale);
    assert.equal(j.depth, 'challenged', String(scale));
    const lexical = j.signals.find((s) => s.kind === 'lexical_floor');
    assert.ok(lexical, String(scale));
    assert.equal(lexical!.detail, 'the request says "drop table" (lexical)');
  }
});

test('an outward step is challenged on a side project even when the words say typo', () => {
  const j = judge('Fix a typo in the Confluence page', 'side_project', { stepTiers: ['draft', 'external_write'] });
  assert.equal(j.depth, 'challenged');
  assert.deepEqual(kinds(j), ['tier']);
});

test('one mid-weight subject word does not challenge, even at multi_team', () => {
  for (const text of ['Fix a typo in the database docs', 'Add a unit test for the schema helper']) {
    const j = judge(text, 'multi_team');
    assert.equal(j.depth, 'standard', text);
    assert.equal(j.challenge, false, text);
  }
});

test('only a side project is light; an unanswered scale is standard and says so', () => {
  const unanswered = judge('Write a short status update', null);
  assert.equal(unanswered.depth, 'standard');
  assert.deepEqual(unanswered.signals, [{ kind: 'scale', detail: 'not answered; treated as a team project', raises: false }]);
  const side = judge('Write a short status update', 'side_project');
  assert.equal(side.depth, 'light');
  assert.equal(side.why, 'The person set this up as a side project and nothing in the work raised the stakes');
  for (const scale of ['solo', 'team', 'multi_team', 'organization'] as const) {
    assert.equal(judge('Write a short status update', scale).depth, 'standard', scale);
  }
});

test('a chosen method skill tips subject words by scale; the challenge method never raises', () => {
  const words = 'Sketch the architecture of the reporting module';
  assert.equal(judge(words, 'team', { chosenSkill: 'system-architecture' }).depth, 'standard');
  const multi = judge(words, 'multi_team', { chosenSkill: 'system-architecture' });
  assert.equal(multi.depth, 'challenged');
  assert.deepEqual(kinds(multi), ['skill']);
  assert.match(multi.signals[0]!.detail, /\(lexical\)$/);
  assert.equal(judge(words, 'multi_team', { boundSkills: ['system-architecture'] }).depth, 'challenged', 'a bound skill counts the same');
  assert.equal(judge(words, 'multi_team', { boundSkills: ['system-architecture'], chosenSkill: 'system-architecture' }).signals.length, 1, 'a skill counts once');
  for (const scale of SCALES) {
    for (const w of ['', words, 'Retune the postgres indexes for the reporter', 'Refactor the ownership of the billing reports']) {
      assert.equal(judge(w, scale, { chosenSkill: 'adversarial-review' }).depth, judge(w, scale).depth, `${w} at ${String(scale)}`);
    }
  }
});

test('every word-based raise is labeled lexical', () => {
  const texts = [
    'Fix the typo in the drop table migration',
    'Migrate the billing schema to the new platform',
    'Introduce a shared database for billing and identity',
    'Retune the postgres indexes for the reporter',
    'Sketch the architecture of the reporting module',
  ];
  for (const scale of SCALES) {
    for (const text of texts) {
      for (const chosenSkill of [null, 'system-architecture']) {
        for (const s of judge(text, scale, { chosenSkill }).signals) {
          if (s.kind === 'lexical_floor' || s.kind === 'skill') assert.match(s.detail, /\(lexical\)$/, `${text}: ${s.detail}`);
          else assert.doesNotMatch(s.detail, /\(lexical\)/);
        }
      }
    }
  }
});

test('a shared database is challenged without the person saying challenge; a helper rename is standard at organization', () => {
  const arch = judge('Introduce a shared database for billing and identity', 'solo');
  assert.equal(arch.depth, 'challenged');
  assert.equal(arch.challenge, true);
  const rename = judge('Rename a private helper in the invoice formatter', 'organization');
  assert.equal(rename.depth, 'standard');
  assert.equal(rename.challenge, false);
});

test('mid-weight wording is light on a side project, standard at multi_team, and challenged once the host says it touches other teams', () => {
  const request = 'Migrate the billing schema to the new platform';
  assert.equal(judge(request, 'side_project').challenge, true, 'schema plus migration plus platform raises at any scale');
  assert.equal(judge(request, 'organization').challenge, true);
  const mid = 'Refactor the ownership of the billing reports';
  assert.equal(judge(mid, 'side_project').depth, 'light');
  assert.equal(judge(mid, 'multi_team').depth, 'standard');
  const declared = judge(mid, 'multi_team', { stakes: { reversible: true, affects: ['other_teams'] } });
  assert.equal(declared.depth, 'challenged');
  assert.deepEqual(kinds(declared), ['host_stakes']);
});

test('unusual consequential phrasing is challenged; a chosen architecture skill tips a strong store signal', () => {
  assert.equal(judge('Put identity and billing on the same postgres', 'solo').challenge, true, 'same postgres is a shared store');
  assert.equal(judge('Open this endpoint to the internet with no auth', 'side_project').challenge, true, 'an open unauthenticated boundary');
  assert.equal(judge('Delete the production audit logs after launch', 'solo').challenge, true, 'destructive production data work');
  assert.equal(judge('Retune the postgres indexes for the reporter', 'side_project').challenge, false);
  assert.equal(judge('Retune the postgres indexes for the reporter', 'side_project', { chosenSkill: 'system-architecture' }).challenge, true);
  assert.equal(judge('Write a short status update', 'side_project', { workflowChallenge: true }).challenge, true);
  assert.equal(judge('Tidy the docs a little', 'side_project', { activeContradictions: 1 }).challenge, true);
});

test('small reversible wording is standard at organization: words never make work lighter', () => {
  for (const text of [
    'Rename a private helper in the invoice formatter',
    'Fix a typo in the README',
    'Sort the imports in utils.ts',
    'Add a comment explaining the timeout',
  ]) {
    const j = judge(text, 'organization');
    assert.equal(j.challenge, false, text);
    assert.equal(j.depth, 'standard', text);
  }
});

test('external or destructive step tiers raise without magic wording', () => {
  assert.equal(judge('Update the tracker ticket description', 'side_project', { stepTiers: ['external_write'] }).challenge, true);
  assert.equal(judge('Clean up old rows', 'side_project', { stepTiers: ['destructive'] }).challenge, true);
});

test('the words a judgment reads are the request-like fields plus declared words, never the whole input', () => {
  assert.equal(wordsOf({ request: 'Fix it', target: 'docs/a.md', scope: 'one file', purpose: 'clarity', text: 'now', other: 'drop table' }), 'Fix it docs/a.md one file clarity now');
  assert.equal(wordsOf({ question: 'Should we drop table users?' }), '', 'no stringified fallback');
  assert.equal(wordsOf({ request: 'Fix it' }, 'on the shared database'), 'Fix it on the shared database');
  assert.equal(wordsOf('Plain text'), 'Plain text');
  assert.equal(wordsOf(null), '');
});
