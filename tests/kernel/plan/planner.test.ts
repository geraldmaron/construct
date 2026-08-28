/**
 * tests/kernel/plan/planner.test.ts — the plan is one recorded pass:
 * understanding absorbed from densified intake, risk tier from the catalog,
 * high-tier steps sequenced first, routing labeled with how it was reached,
 * and the one hard gate — a citation of nothing real is discarded aloud.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, vetCitations } from '../../../src/kernel/plan/planner.ts';
import type { PlanInput } from '../../../src/kernel/plan/planner.ts';
import type { Source } from '../../../src/kernel/store/sources.ts';
import { lensForDomain } from '../../../src/kernel/plan/lenses.ts';

const AT = '2026-08-05T00:00:00.000Z';

const SRC: Source = {
  id: 'src-1',
  workspace: 'acme',
  kind: 'jira',
  locator: 'PROJ',
  addedAt: AT,
  retiredAt: null,
};

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    id: 'plan-run-1',
    run: 'run-1',
    outcome: 'launch the newsletter signup',
    densified: null,
    implicated: [
      { domain: 'security', concern: 'c', score: 10, signals: ['signup'] },
      { domain: 'privacy', concern: 'c', score: 12, signals: ['email'] },
    ],
    inferredBy: 'keywords',
    sources: [SRC],
    workspace: 'default',
    mode: 'team',
    plannedAt: AT,
    ...overrides,
  };
}

test('high-tier domains are sequenced before low-tier ones and set the run tier', () => {
  const plan = buildPlan(input());
  // privacy carries licensed review, so it is high tier and goes first even
  // though the implication order listed security first.
  assert.equal(plan.steps[0]?.domain, 'privacy');
  assert.equal(plan.steps[1]?.domain, 'security');
  assert.equal(plan.riskTier, 'high');
  // The chain is a sequence: each later step waits on the one before it.
  assert.deepEqual(plan.steps[0]?.after, []);
  assert.deepEqual(plan.steps[1]?.after, [plan.steps[0]?.id]);
});

test('an all-low-tier run is low risk, and nothing implicated is high, not safe', () => {
  const low = buildPlan(
    input({ implicated: [{ domain: 'security', concern: 'c', score: 10, signals: ['auth'] }] }),
  );
  assert.equal(low.riskTier, 'low');
  const none = buildPlan(input({ implicated: [] }));
  assert.equal(none.riskTier, 'high');
  assert.equal(none.steps.length, 0);
});

test('routing is labeled by how the inference was reached, fallback named as fallback', () => {
  assert.equal(buildPlan(input()).routing[0]?.routedBy, 'lexical-fallback');
  assert.equal(buildPlan(input({ inferredBy: 'namer' })).routing[0]?.routedBy, 'namer');
  assert.equal(buildPlan(input({ inferredBy: 'cache' })).routing[0]?.routedBy, 'namer');
  assert.equal(buildPlan(input({ inferredBy: 'user' })).routing[0]?.routedBy, 'user');
  assert.equal(buildPlan(input({ inferredBy: 'session' })).routing[0]?.routedBy, 'session');
  assert.equal(buildPlan(input({ inferredBy: 'ground' })).routing[0]?.routedBy, 'ground');
});

test('understanding absorbs the densified intake and falls back to the raw outcome', () => {
  const densified = buildPlan(
    input({
      densified: {
        outcome: 'ship signup',
        constraints: ['no third-party trackers'],
        decisions: ['use the existing list provider'],
        parked: ['redesign later'],
        underspecified: '',
      },
    }),
  );
  assert.equal(densified.understanding.restated, 'ship signup');
  assert.deepEqual(densified.understanding.constraints, ['no third-party trackers']);
  const raw = buildPlan(input());
  assert.equal(raw.understanding.restated, 'launch the newsletter signup');
  assert.deepEqual(raw.understanding.constraints, []);
});

test('steps cite the catalog domain and every declared source', () => {
  const plan = buildPlan(input());
  const citations = plan.steps[0]?.citations ?? [];
  assert.deepEqual(citations, [
    { kind: 'catalog', domain: 'privacy' },
    { kind: 'source', source: 'src-1' },
  ]);
  assert.deepEqual(plan.sourcesDeclared, ['src-1']);
});

test('a step routed to a domain no lens equips carries a deliverable that says so', () => {
  // Every domain in the shipped catalog carries a lens today (see
  // tests/kernel/plan/playbooks.test.ts), so this names a domain outside it —
  // the shape a workspace's own domain catalog would route through, per
  // implication/domains.ts's own docstring on why the catalog is
  // caller-replaceable.
  assert.equal(lensForDomain('inventory-forecasting'), undefined);
  const plan = buildPlan(
    input({ implicated: [{ domain: 'inventory-forecasting', concern: 'c', score: 10, signals: ['stock'] }] }),
  );
  const method = plan.steps[0]?.deliverable.slots.find((s) => s.name === 'method');
  assert.ok(method, 'the plan step a lensless domain routes to must carry the method slot');
  assert.equal(method.required, true);
});

test('a citation of an undeclared source or unknown domain is discarded and said aloud', () => {
  const { kept, discarded } = vetCitations(
    [
      { kind: 'source', source: 'src-1' },
      { kind: 'source', source: 'src-ghost' },
      { kind: 'catalog', domain: 'privacy' },
      { kind: 'catalog', domain: 'astrology' },
    ],
    [SRC],
  );
  assert.equal(kept.length, 2);
  assert.equal(discarded.length, 2);
  assert.match(discarded[0]?.reason ?? '', /fabricated provenance/);
  assert.match(discarded[1]?.reason ?? '', /fabricated provenance/);
});
