/**
 * tests/kernel/workflow/consequence.test.ts — rigor comes from what the work
 * does. Structure sets the floor, the stakes the host reports only raise it,
 * an unreported reading is said rather than guessed, and only a side project
 * with nothing raised is light. No row reads the person's words.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessConsequence,
  DEPTHS,
  STAKE_AREAS,
  type ConsequenceInput,
  type Judgment,
  type Stakes,
} from '../../../src/kernel/workflow/consequence.ts';
import { PROJECT_SCALES, type ProjectScale } from '../../../src/kernel/state/profile.ts';
import { ACTION_TIERS } from '../../../src/kernel/state/steps.ts';

const SCALES: readonly (ProjectScale | null)[] = [...PROJECT_SCALES, null];
const NOTHING_TOUCHED: Stakes = { reversible: true, affects: ['none'] };

function judge(scale: ProjectScale | null, extra: Partial<ConsequenceInput> = {}): Judgment {
  return assessConsequence({ scale, workflowChallenge: false, stepTiers: [], activeContradictions: 0, stakes: NOTHING_TOUCHED, ...extra });
}

const rank = (j: Judgment) => DEPTHS.indexOf(j.depth);
const kinds = (j: Judgment) => j.signals.filter((s) => s.raises).map((s) => s.kind);

test('each structural row raises on its own and names itself', () => {
  const rows: readonly {
    readonly name: string;
    readonly extra: Partial<ConsequenceInput>;
    readonly kind: string;
    readonly detail: RegExp;
  }[] = [
    { name: 'workflow', extra: { workflowChallenge: true }, kind: 'workflow', detail: /workflow declares/ },
    { name: 'external_write', extra: { stepTiers: ['draft', 'external_write'] }, kind: 'tier', detail: /external_write/ },
    { name: 'destructive', extra: { stepTiers: ['destructive', 'external_write'] }, kind: 'tier', detail: /destructive/ },
    { name: 'licensed_judgment', extra: { stepTiers: ['licensed_judgment'] }, kind: 'tier', detail: /licensed_judgment/ },
    { name: 'contradiction', extra: { activeContradictions: 1 }, kind: 'contradiction', detail: /contradiction/ },
    { name: 'irreversible', extra: { stakes: { reversible: false, affects: [] } }, kind: 'host_stakes', detail: /hard to undo/ },
  ];
  for (const row of rows) {
    for (const scale of SCALES) {
      const j = judge(scale, row.extra);
      assert.equal(j.depth, 'challenged', `${row.name} at ${String(scale)}`);
      assert.equal(j.challenge, true);
      assert.deepEqual(kinds(j), [row.kind], row.name);
      assert.match(j.signals[0]!.detail, row.detail);
      assert.match(j.why, /^challenge before treating the result as strongly validated: /);
      assert.ok(j.why.includes(j.signals[0]!.detail), 'why lists the raising detail');
    }
  }
  for (const tier of ACTION_TIERS.filter((t) => t === 'observe' || t === 'draft' || t === 'project_write')) {
    assert.equal(judge('team', { stepTiers: [tier] }).depth, 'standard', `${tier} does not raise`);
  }
});

test('every stake area other than none raises, and says what it touches', () => {
  for (const area of STAKE_AREAS) {
    const j = judge('side_project', { stakes: { reversible: true, affects: [area] } });
    if (area === 'none') {
      assert.equal(j.depth, 'light', 'none touches nothing');
      assert.deepEqual(kinds(j), []);
      continue;
    }
    assert.equal(j.depth, 'challenged', area);
    assert.deepEqual(kinds(j), ['host_stakes'], area);
    assert.match(j.signals[0]!.detail, new RegExp(`touches ${area.replace(/_/g, ' ')}`));
  }
  const both = judge('team', { stakes: { reversible: false, affects: ['money', 'public'] } });
  assert.equal(both.signals[0]!.detail, 'the host reported it is hard to undo and touches money, public');
  assert.equal(
    judge('team', { stakes: { reversible: null, affects: [] } }).depth,
    'standard',
    'unknown reversibility alone does not raise',
  );
});

test('stakes the host did not report are said, never guessed, and raise nothing', () => {
  for (const scale of SCALES) {
    const j = judge(scale, { stakes: null });
    assert.equal(j.challenge, false, String(scale));
    assert.ok(
      j.signals.some((s) => s.kind === 'host_stakes' && !s.raises && /did not report/.test(s.detail)),
      String(scale),
    );
    assert.doesNotMatch(j.why, /did not report/, 'a non-raising signal is not given as a reason to challenge');
  }
  const raised = judge('team', { stakes: null, stepTiers: ['external_write'] });
  assert.equal(raised.depth, 'challenged');
  assert.doesNotMatch(raised.why, /did not report/);
});

test('raise-only: stakes never lower the depth, and nothing falls below the structural floor', () => {
  const tierSets: readonly (readonly (typeof ACTION_TIERS)[number][])[] = [
    [],
    ['draft', 'project_write'],
    ['external_write'],
    ['destructive'],
  ];
  const stakeSets: readonly (Stakes | null)[] = [
    null,
    { reversible: true, affects: [] },
    NOTHING_TOUCHED,
    { reversible: false, affects: [] },
    { reversible: true, affects: ['customers'] },
  ];
  for (const scale of SCALES) {
    for (const stepTiers of tierSets) {
      for (const contradictions of [0, 1]) {
        const floor = judge(scale, { stepTiers, activeContradictions: contradictions, stakes: null });
        for (const stakes of stakeSets) {
          const j = judge(scale, { stepTiers, activeContradictions: contradictions, stakes });
          assert.ok(rank(j) >= rank(floor), `stakes cannot lower: ${String(scale)} with ${JSON.stringify(stakes)}`);
          assert.equal(j.challenge, j.depth === 'challenged');
        }
      }
    }
  }
});

test('only a side project is light; an unanswered scale is standard and says so', () => {
  const unanswered = judge(null);
  assert.equal(unanswered.depth, 'standard');
  assert.deepEqual(unanswered.signals, [{ kind: 'scale', detail: 'not answered; treated as a team project', raises: false }]);
  const side = judge('side_project');
  assert.equal(side.depth, 'light');
  assert.equal(side.why, 'The person set this up as a side project and nothing in the work raised the stakes');
  for (const scale of ['solo', 'team', 'multi_team', 'organization'] as const) assert.equal(judge(scale).depth, 'standard', scale);
});
