/**
 * tests/recruiter.test.mjs — condition-driven participant assembly
 * (lib/orchestration/recruiter.mjs, construct-pteo2.5).
 *
 * recruit() is exercised against the real assembled registry for the
 * canonical dimension affinities, and against injected registries for
 * participationRules semantics so the tests stay sterile of project overlays.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recruit,
  assembleParticipants,
  evaluateSignalExpr,
  loadRecruitmentAffinities,
} from '../lib/orchestration/recruiter.mjs';
import { watcherFires } from '../lib/orchestration/routing-tables.mjs';
import { resolveRemediationDispatch } from '../lib/oracle/remediation-dispatch.mjs';

test('recruit maps cost + accessibility signals to the most specialized skill matches', () => {
  const participants = recruit({ signals: { cost: true, accessibility: true }, kind: 'review' });
  const byId = Object.fromEntries(participants.map((p) => [p.specialist, p]));

  assert.ok(byId['cx-data-analyst'], 'cost recruits cx-data-analyst');
  assert.equal(byId['cx-data-analyst'].role, 'reviewer');
  assert.equal(byId['cx-data-analyst'].reason, 'cost/quant');

  assert.ok(byId['cx-designer'], 'accessibility recruits cx-designer');
  assert.equal(byId['cx-designer'].reason, 'accessibility');
  assert.deepEqual(byId['cx-designer'].dimensions, ['accessibility']);
});

test('recruit dedupes a specialist matched by several dimensions, merging reasons', () => {
  const participants = recruit({ signals: { compliance: true, privacy: true } });
  const security = participants.filter((p) => p.specialist === 'cx-security');
  assert.equal(security.length, 1, 'one entry for cx-security');
  assert.ok(security[0].reason.includes('compliance'));
  assert.ok(security[0].reason.includes('privacy'));
  assert.ok(security[0].dimensions.includes('compliance'));
  assert.ok(security[0].dimensions.includes('privacy'));
});

test('recruit maps kind to role and honors exclusions', () => {
  const advisors = recruit({ signals: { reliability: true }, kind: 'advise' });
  assert.equal(advisors[0]?.specialist, 'cx-operations');
  assert.equal(advisors[0]?.role, 'advisor');

  const excluded = recruit({
    signals: { accessibility: true },
    exclude: ['cx-designer'],
  });
  assert.ok(!excluded.some((p) => p.specialist === 'cx-designer'));
});

test('recruit returns empty for no truthy signals and ignores non-boolean values', () => {
  assert.deepEqual(recruit({ signals: {} }), []);
  assert.deepEqual(recruit({ signals: { cost: 'yes', accessibility: 1 } }), []);
});

test('every canonical dimension resolves to a live registry specialist', () => {
  for (const aff of loadRecruitmentAffinities()) {
    const participants = recruit({ signals: { [aff.dimension]: true } });
    const specialists = participants.filter((p) => p.specialist);
    assert.ok(specialists.length >= 1, `${aff.dimension} recruits at least one specialist`);
    for (const p of specialists) {
      assert.match(p.specialist, /^cx-/, `${aff.dimension} resolves roster ids`);
    }
  }
});

test('participationRules with signalExpr recruit their stated targets with role and gate', () => {
  const registry = {
    specialists: {
      'cx-architect': {
        skills: [],
        team: 'engineering-team',
        participationRules: {
          schemaVersion: 1,
          rules: [
            {
              id: 'legal-scope-review',
              dimension: 'legal-compliance',
              when: { signalExpr: 'compliance && !privacy' },
              recruit: { specialists: ['cx-security'], teams: ['governance-team'] },
              role: 'reviewer',
              gate: 'advisory',
              reason: 'compliance-flagged change needs security review',
            },
          ],
        },
      },
      'cx-security': { skills: [], team: 'governance-team' },
    },
  };

  const hit = recruit({ signals: { compliance: true }, registry });
  const specialist = hit.find((p) => p.specialist === 'cx-security');
  assert.ok(specialist, 'rule recruits cx-security');
  assert.equal(specialist.via, 'participation-rule');
  assert.equal(specialist.rule, 'legal-scope-review');
  assert.equal(specialist.gate, 'advisory');
  assert.deepEqual(specialist.dimensions, ['legal-compliance']);
  const team = hit.find((p) => p.team === 'governance-team' && !p.specialist);
  assert.ok(team, 'rule recruits the governance team as a participant');

  const miss = recruit({ signals: { compliance: true, privacy: true }, registry });
  assert.equal(miss.length, 0, 'negated term suppresses the rule');
});

test('participationRules with watchCondition delegate to the shipped watcher predicates', () => {
  const registry = {
    specialists: {
      'cx-qa': {
        skills: [],
        team: 'quality-team',
        participationRules: [
          {
            id: 'wide-change-review',
            when: { watchCondition: 'wide-blast-radius' },
            recruit: { specialists: ['cx-qa'] },
            role: 'reviewer',
            gate: 'advisory',
          },
        ],
      },
    },
  };

  const hit = recruit({ signals: { blastRadius: 'wide' }, registry });
  assert.equal(hit[0]?.specialist, 'cx-qa');
  assert.equal(hit[0]?.via, 'participation-rule');

  const miss = recruit({ signals: { blastRadius: 'narrow' }, registry });
  assert.equal(miss.length, 0);
});

test('evaluateSignalExpr fails closed on anything outside the bare/negated/&& grammar', () => {
  assert.equal(evaluateSignalExpr('cost', { cost: true }), true);
  assert.equal(evaluateSignalExpr('!cost', { cost: false }), true);
  assert.equal(evaluateSignalExpr('cost && data', { cost: true, data: true }), true);
  assert.equal(evaluateSignalExpr('cost && data', { cost: true }), false);

  assert.equal(evaluateSignalExpr('cost || data', { cost: true, data: true }), false);
  assert.equal(evaluateSignalExpr('signals["x"]', { x: true }), false);
  assert.equal(evaluateSignalExpr('', { cost: true }), false);
  assert.equal(evaluateSignalExpr('__proto__', {}), false);
});

test('watcherFires evaluates known predicates and fails closed on unknown names', () => {
  assert.equal(watcherFires('wide-blast-radius', { blastRadius: 'wide' }), true);
  assert.equal(watcherFires('wide-blast-radius', { blastRadius: 'narrow' }), false);
  assert.equal(watcherFires('no-such-watcher', { blastRadius: 'wide' }), false);
  assert.equal(watcherFires('wide-blast-radius', undefined), false);
});

test('assembleParticipants keeps the Oracle static/swarm contract', () => {
  const single = assembleParticipants({
    seeds: ['cx-data-engineer'],
    request: 'No .cx/outcomes/_summary.json — learning tiebreakers are blind',
    cwd: process.cwd(),
  });
  assert.equal(single.mode, 'static');
  assert.equal(single.primary, 'cx-data-engineer');
  assert.deepEqual(single.specialists, ['cx-data-engineer']);
  assert.ok(single.teamRouting);

  const multi = assembleParticipants({
    seeds: ['cx-engineer', 'cx-operations'],
    request: 'Project adapter parity check failed',
    cwd: process.cwd(),
  });
  assert.equal(multi.mode, 'swarm');
  assert.equal(multi.primary, 'cx-engineer');
  assert.deepEqual([...multi.specialists].sort(), ['cx-engineer', 'cx-operations']);
  assert.ok((multi.teamRouting?.involvedTeams ?? []).length > 1);
});

test('resolveRemediationDispatch delegates to the recruiter with unchanged output shape', () => {
  const dispatch = resolveRemediationDispatch(
    {
      id: 'hook-failures',
      detail: 'hook failures in the last 24h',
    },
    { cwd: process.cwd() },
  );
  assert.ok(['static', 'swarm'].includes(dispatch.mode));
  assert.equal(dispatch.primary, 'cx-operations');
  assert.ok(Array.isArray(dispatch.specialists));
  assert.ok(dispatch.specialists.includes('cx-operations'));
  assert.ok(dispatch.teamRouting);
});
