/**
 * tests/recruiter.test.mjs — condition-driven participant assembly
 * (lib/orchestration/recruiter.mjs).
 *
 * recruit() is exercised against the real assembled registry for the
 * canonical dimension affinities, and against injected registries for
 * participationRules semantics so the tests stay sterile of project overlays.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  recruit,
  assembleParticipants,
  evaluateSignalExpr,
  loadRecruitmentAffinities,
  clearRecruiterCache,
} from '../lib/orchestration/recruiter.mjs';
import { watcherFires } from '../lib/orchestration/routing-tables.mjs';
import { resolveRemediationDispatch } from '../lib/oracle/remediation-dispatch.mjs';
import { recordOutcome } from '../lib/outcomes/record.mjs';
import { aggregateOutcomes } from '../lib/outcomes/aggregate.mjs';

test('recruit maps cost + accessibility signals to the most specialized skill matches', () => {
  const participants = recruit({ signals: { cost: true, accessibility: true }, kind: 'review' });
  const byId = Object.fromEntries(participants.map((p) => [p.workerProfile, p]));

  assert.ok(byId['data-analyst'], 'cost recruits data-analyst');
  assert.equal(byId['data-analyst'].assignmentRole, 'reviewer');
  assert.equal(byId['data-analyst'].reason, 'cost/quant');

  assert.ok(byId['designer'], 'accessibility recruits designer');
  assert.equal(byId['designer'].reason, 'accessibility');
  assert.deepEqual(byId['designer'].dimensions, ['accessibility']);
});

test('project recruitment affinities load from .construct/orchestration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recruiter-overlay-'));
  const previousCwd = process.cwd();
  try {
    const overlayDir = path.join(root, '.construct', 'orchestration');
    fs.mkdirSync(overlayDir, { recursive: true });
    fs.writeFileSync(
      path.join(overlayDir, 'recruitment-affinities.json'),
      JSON.stringify([{ dimension: 'custom-risk', skillPatterns: ['custom-risk-review'], reason: 'project overlay' }]),
    );
    process.chdir(root);
    clearRecruiterCache();
    const custom = loadRecruitmentAffinities().find((entry) => entry.dimension === 'custom-risk');
    assert.deepEqual(custom, {
      dimension: 'custom-risk',
      skillPatterns: ['custom-risk-review'],
      reason: 'project overlay',
    });
  } finally {
    process.chdir(previousCwd);
    clearRecruiterCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recruit dedupes a specialist matched by several dimensions, merging reasons', () => {
  const participants = recruit({ signals: { compliance: true, privacy: true } });
  const security = participants.filter((p) => p.workerProfile === 'security');
  assert.equal(security.length, 1, 'one entry for security');
  assert.ok(security[0].reason.includes('compliance'));
  assert.ok(security[0].reason.includes('privacy'));
  assert.ok(security[0].dimensions.includes('compliance'));
  assert.ok(security[0].dimensions.includes('privacy'));
});

test('recruit maps kind to role and honors exclusions', () => {
  const advisors = recruit({ signals: { reliability: true }, kind: 'advise' });
  assert.equal(advisors[0]?.workerProfile, 'operations');
  assert.equal(advisors[0]?.assignmentRole, 'advisor');

  const excluded = recruit({
    signals: { accessibility: true },
    exclude: ['designer'],
  });
  assert.ok(!excluded.some((p) => p.workerProfile === 'designer'));
});

test('recruit returns empty for no truthy signals and ignores non-boolean values', () => {
  assert.deepEqual(recruit({ signals: {} }), []);
  assert.deepEqual(recruit({ signals: { cost: 'yes', accessibility: 1 } }), []);
});

test('every canonical dimension resolves to a live registry specialist', () => {
  for (const aff of loadRecruitmentAffinities()) {
    const participants = recruit({ signals: { [aff.dimension]: true } });
    const specialists = participants.filter((p) => p.workerProfile);
    assert.ok(specialists.length >= 1, `${aff.dimension} recruits at least one specialist`);
    for (const p of specialists) {
      assert.match(p.workerProfile, /^[a-z][a-z0-9-]*$/, `${aff.dimension} resolves canonical Worker Profile ids`);
      assert.doesNotMatch(p.workerProfile, /^cx-/, `${aff.dimension} excludes retired persona ids`);
    }
  }
});

test('participationRules with signalExpr recruit their stated targets with role and gate', () => {
  const registry = {
    workerProfiles: {
      'architect': {
        skillEmphasis: [],
        participationRules: {
          schemaVersion: 1,
          rules: [
            {
              id: 'legal-scope-review',
              dimension: 'legal-compliance',
              when: { signalExpr: 'compliance && !privacy' },
              workerProfiles: ['security'],
              assignmentRole: 'reviewer',
              gate: 'advisory',
              reason: 'compliance-flagged change needs security review',
            },
          ],
        },
      },
      'security': { skillEmphasis: [] },
    },
  };

  const hit = recruit({ signals: { compliance: true }, registry });
  const specialist = hit.find((p) => p.workerProfile === 'security');
  assert.ok(specialist, 'rule recruits security');
  assert.equal(specialist.via, 'participation-rule');
  assert.equal(specialist.rule, 'legal-scope-review');
  assert.equal(specialist.gate, 'advisory');
  assert.deepEqual(specialist.dimensions, ['legal-compliance']);

  const miss = recruit({ signals: { compliance: true, privacy: true }, registry });
  assert.equal(miss.length, 0, 'negated term suppresses the rule');
});

test('participationRules with watchCondition delegate to the shipped watcher predicates', () => {
  const registry = {
    workerProfiles: {
      'qa': {
        skillEmphasis: [],
        participationRules: [
          {
            id: 'wide-change-review',
            when: { watchCondition: 'wide-blast-radius' },
            workerProfiles: ['qa'],
            assignmentRole: 'reviewer',
            gate: 'advisory',
          },
        ],
      },
    },
  };

  const hit = recruit({ signals: { blastRadius: 'wide' }, registry });
  assert.equal(hit[0]?.workerProfile, 'qa');
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

test('assembleParticipants creates canonical single and parallel Assignment sets', () => {
  const single = assembleParticipants({
    seeds: ['engineer'],
  });
  assert.equal(single.mode, 'single');
  assert.equal(single.primary, 'engineer');
  assert.deepEqual(single.workerProfiles, ['engineer']);
  assert.deepEqual(single.assignments, [
    { id: 'assignment-1', workerProfileId: 'engineer', workerProfile: 'engineer', primary: true },
  ]);

  const multi = assembleParticipants({
    seeds: ['engineer', 'operations'],
  });
  assert.equal(multi.mode, 'parallel');
  assert.equal(multi.primary, 'engineer');
  assert.deepEqual(multi.workerProfiles, ['engineer', 'operations']);
  assert.deepEqual(multi.assignments, [
    { id: 'assignment-1', workerProfileId: 'engineer', workerProfile: 'engineer', primary: true },
    { id: 'assignment-2', workerProfileId: 'operations', workerProfile: 'operations', primary: false },
  ]);
});

test('resolveRemediationDispatch creates a canonical Assignment from the routed Worker Profile', () => {
  const dispatch = resolveRemediationDispatch({
    id: 'hook-failures',
    detail: 'hook failures in the last 24h',
  });
  assert.deepEqual(dispatch, {
    mode: 'single',
    assignments: [
      { id: 'assignment-1', workerProfileId: 'operations', primary: true },
    ],
  });
});

// outcomeBoost tie-breaker: a bounded ±0.05 nudge between candidates
// the specialization signal already ranked equal. Each test gets an isolated
// tmpdir so outcome history from one case never leaks into another.

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recruiter-outcome-boost-'));
}

function seedOutcomes(cwd, role, { successes = 0, failures = 0 } = {}) {
  for (let i = 0; i < successes; i++) {
    recordOutcome(cwd, { role, success: true, notes: 'test', source: 'test' });
  }
  for (let i = 0; i < failures; i++) {
    recordOutcome(cwd, { role, success: false, notes: 'test', source: 'test' });
  }
  aggregateOutcomes(cwd);
}

const TIED_REGISTRY = {
  workerProfiles: {
    'data-analyst': { skillEmphasis: ['cost-optimization'] },
    'product-manager': { skillEmphasis: ['pricing-positioning'] },
  },
};

test('outcomeBoost re-ranks candidates the specialization signal left tied', () => {
  const cwd = tmpProject();
  try {
    const baseline = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
    assert.deepEqual(
      baseline.map((p) => p.workerProfile),
      ['data-analyst'],
      'with no outcome history, the alphabetical tie-break picks data-analyst',
    );

    seedOutcomes(cwd, 'data-analyst', { failures: 5 });
    seedOutcomes(cwd, 'product-manager', { successes: 5 });

    const boosted = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
    assert.deepEqual(
      boosted.map((p) => p.workerProfile),
      ['product-manager'],
      'product-manager\'s strong recent outcomes flip the tie-break',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('outcomeBoost can never override a lower declared-skill-count (most-specialized-wins)', () => {
  const cwd = tmpProject();
  const registry = {
    workerProfiles: {
      'data-analyst': { skillEmphasis: ['cost-optimization'] },
      'engineer': {
        skillEmphasis: ['cost-optimization', 'pricing-positioning', 'raw-data-structuring'],
      },
    },
  };
  try {
    // The narrower (more specialized) candidate gets the worst possible outcome
    // history and the broader one the best — the boost must still lose to skillCount.
    seedOutcomes(cwd, 'data-analyst', { failures: 5 });
    seedOutcomes(cwd, 'engineer', { successes: 5 });

    const picks = recruit({ signals: { cost: true }, kind: 'review', registry, cwd });
    assert.deepEqual(
      picks.map((p) => p.workerProfile),
      ['data-analyst'],
      'a 1-skill candidate must beat a 3-skill candidate regardless of outcome history',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('orchestration.outcomeRouting=off restores plain alphabetical tie-breaking', () => {
  const cwd = tmpProject();
  try {
    seedOutcomes(cwd, 'data-analyst', { failures: 5 });
    seedOutcomes(cwd, 'product-manager', { successes: 5 });
    fs.writeFileSync(
      path.join(cwd, 'construct.config.json'),
      JSON.stringify({ version: 1, orchestration: { outcomeRouting: 'off' } }),
    );

    const picks = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
    assert.deepEqual(
      picks.map((p) => p.workerProfile),
      ['data-analyst'],
      'outcomeRouting=off must ignore outcome history entirely',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('missing outcome summary leaves recruitment order unchanged', () => {
  const cwd = tmpProject();
  try {
    const picks = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
    assert.deepEqual(
      picks.map((p) => p.workerProfile),
      ['data-analyst'],
      'no outcome data must fall back to the deterministic alphabetical tie-break',
    );
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
