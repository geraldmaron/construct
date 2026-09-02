/**
 * tests/kernel/workflow/classify-validate.test.ts — the four classes from
 * ordinary language, the validators, and the cron clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInteraction } from '../../../src/kernel/workflow/classify.ts';
import { runValidators, knownValidators } from '../../../src/kernel/workflow/validators.ts';
import { nextCronAfter, parseCron } from '../../../src/kernel/workflow/cron.ts';
import { BUILTIN_VALIDATORS } from '../../../src/kernel/registry/capability-registry.ts';

test('the directive’s examples classify as it says', () => {
  const a = classifyInteraction('What does this function do?');
  assert.equal(a.class, 'answer');
  assert.ok(a.confidence >= 0.9);
  const r = classifyInteraction('Remember that we will not support schema migration before stable');
  assert.equal(r.class, 'remember');
  assert.equal(r.rememberKind, 'decision');
  const r2 = classifyInteraction('Record that we will not add schema migration until stable.');
  assert.equal(r2.class, 'remember');
  const m = classifyInteraction('Review this implementation against our design principles');
  assert.equal(m.class, 'manage');
  assert.equal(m.confirmBeforeProceeding, false);
  const s = classifyInteraction('Every January, compare team strategies to active Jira work and capacity');
  assert.equal(s.class, 'maintain');
  assert.equal(s.confirmBeforeProceeding, false);
  const vague = classifyInteraction('this happens every month and it is annoying');
  assert.equal(vague.class, 'maintain');
  assert.equal(vague.confirmBeforeProceeding, true, 'a recurring mention without a work verb asks before setting anything up');
  const none = classifyInteraction('thanks');
  assert.equal(none.class, 'answer');
  assert.equal(classifyInteraction('').class, 'answer');
  assert.equal(classifyInteraction('note: never deploy on Fridays').rememberKind, 'constraint');
});

test('validators are deterministic and every shipped name has an implementation', () => {
  assert.deepEqual([...knownValidators()].sort(), [...BUILTIN_VALIDATORS].sort());
  const base = { expectedKeys: ['summary', 'findings'], evidence: [{ ref: 'docs/design.md#L4' }], resolvableRefs: new Set(['docs/design.md#L4']) };
  const good = runValidators(['schema', 'citations_present', 'no_uncited_material_findings', 'deliverable_complete', 'evidence_refs_resolve'], { ...base, output: { summary: 'ok', findings: [{ material: true, citations: ['docs/design.md#L4'] }] } });
  assert.ok(good.every((v) => v.ok), JSON.stringify(good));
  const bad = runValidators(['schema', 'citations_present', 'no_uncited_material_findings', 'evidence_refs_resolve'], { ...base, evidence: [{ ref: 'nowhere' }], output: { summary: 'x', findings: [{ severity: 'material' }] } });
  assert.deepEqual(bad.map((v) => [v.validator, v.ok]), [['schema', true], ['citations_present', true], ['no_uncited_material_findings', false], ['evidence_refs_resolve', false]]);
  assert.match(runValidators(['schema'], { ...base, output: { summary: 'x' } })[0]!.problems[0]!, /lacks "findings"/);
  assert.match(bad[2]!.problems[0]!, /material but cites nothing/);
  const velocity = runValidators(['no_velocity_as_capacity'], { ...base, output: { capacity: { basis: 'velocity', points: 40 } } });
  assert.equal(velocity[0]!.ok, false);
  assert.match(velocity[0]!.problems.join(' '), /never capacity/);
  const capacityOk = runValidators(['no_velocity_as_capacity'], { ...base, output: { capacity: { range: [3, 5] }, assumptions: ['5 people at 80%'] } });
  assert.equal(capacityOk[0]!.ok, true);
  assert.equal(runValidators(['nope'], { ...base, output: {} })[0]!.ok, false);
});

test('cron fires at the right wall-clock instant in a timezone, and refuses bad expressions', () => {
  assert.equal(nextCronAfter('0 9 * * 1', 'Europe/Berlin', '2026-09-02T12:00:00.000Z'), '2026-09-07T07:00:00.000Z', 'Monday 09:00 Berlin is 07:00 UTC in summer');
  assert.equal(nextCronAfter('0 9 * * 1', 'Europe/Berlin', '2026-12-02T12:00:00.000Z'), '2026-12-07T08:00:00.000Z', 'and 08:00 UTC in winter');
  assert.equal(nextCronAfter('0 0 1 1 *', 'UTC', '2026-09-02T12:00:00.000Z'), '2027-01-01T00:00:00.000Z', 'every January');
  assert.equal(nextCronAfter('*/15 * * * *', 'UTC', '2026-09-02T12:07:00.000Z'), '2026-09-02T12:15:00.000Z');
  assert.equal(nextCronAfter('30 14 * * *', 'America/New_York', '2026-09-02T18:30:00.000Z'), '2026-09-03T18:30:00.000Z', 'strictly after');
  assert.equal(nextCronAfter('0 0 31 2 *', 'UTC', '2026-09-02T12:00:00.000Z'), null, 'never fires within the horizon');
  assert.throws(() => parseCron('0 9 * *'), /five fields/);
  assert.throws(() => parseCron('0 25 * * *'), /outside/);
  assert.throws(() => nextCronAfter('0 9 * * *', 'Mars/Olympus', '2026-09-02T12:00:00.000Z'), /not a timezone/);
});
