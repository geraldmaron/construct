/**
 * tests/kernel/policy/engine.test.ts — the tier defaults hold, grants are read
 * by exact scope, denials name the smallest step-up, approvals neither widen
 * nor persist nor transfer, break-glass is short and exact, licensed
 * judgment is never Construct's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAction, approveAction, breakGlass, explainDenial, DEFAULT_APPROVAL_TTL_MS, type ActionRequest, type PolicyContext } from '../../../src/kernel/policy/engine.ts';
import { TIER_POLICIES, tierAtLeast, ACTION_TIERS } from '../../../src/kernel/policy/lattice.ts';
import { createGrant, listGrants, revokeGrant } from '../../../src/kernel/state/grants.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { freshStore } from '../state/support.ts';

const T0 = '2026-09-02T10:00:00.000Z';
const manage: PolicyContext = { at: T0, interactionClass: 'manage', projectWritePolicy: 'managed' };
const jiraWrite: ActionRequest = { tier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-14', operation: 'move PROJ-14 to Done', workflowId: 'design-conformance', executorId: 'session:claude', runId: 'run-1' };

test('the lattice is ordered and every tier states its requirement', () => {
  assert.ok(tierAtLeast('destructive', 'external_write'));
  assert.ok(!tierAtLeast('draft', 'project_write'));
  for (const tier of ACTION_TIERS) assert.ok(TIER_POLICIES[tier].description.length > 20);
  assert.equal(TIER_POLICIES.licensed_judgment.requirement, 'never_by_construct');
  assert.equal(TIER_POLICIES.destructive.standingGrantSuffices, false);
});

test('observe and draft run automatically; nothing switches the gates off', () => {
  const fx = freshStore();
  try {
    for (const tier of ['observe', 'draft'] as const) {
      const d = evaluateAction(fx.store, { tier, targetSystem: 'github', operation: 'read the PR', executorId: 'session:claude' }, { ...manage, interactionClass: 'answer' });
      assert.equal(d.allowed, true);
      assert.equal(d.allowed && d.basis, 'tier_default');
      assert.equal(d.gatesStillApply, true);
    }
  } finally {
    fx.cleanup();
  }
});

test('project writes need a managed outcome or an explicit request to remember', () => {
  const fx = freshStore();
  try {
    const write: ActionRequest = { tier: 'project_write', targetSystem: 'construct-state', targetResource: 'statements', operation: 'record the decision', executorId: 'session:claude' };
    const asked = evaluateAction(fx.store, write, { ...manage, interactionClass: 'remember', explicitRememberRequest: true });
    assert.equal(asked.allowed && asked.basis, 'explicit_request');
    const notAsked = evaluateAction(fx.store, write, { ...manage, interactionClass: 'remember' });
    assert.equal(notAsked.allowed, false);
    assert.match(!notAsked.allowed ? notAsked.denial.missing : '', /explicit request to remember/);

    const inOutcome = evaluateAction(fx.store, write, manage);
    assert.equal(inOutcome.allowed && inOutcome.basis, 'managed_outcome');
    const standing = evaluateAction(fx.store, write, { ...manage, interactionClass: 'maintain' });
    assert.equal(standing.allowed, true);

    const question = evaluateAction(fx.store, write, { ...manage, interactionClass: 'answer' });
    assert.equal(question.allowed, false);
    assert.equal(!question.allowed && question.denial.stepUp.kind, 'managed_outcome');

    const forbidden = evaluateAction(fx.store, write, { ...manage, projectWritePolicy: 'never' });
    assert.equal(forbidden.allowed, false);
    assert.equal(!forbidden.allowed && forbidden.denial.stepUp.kind, 'project_policy');
  } finally {
    fx.cleanup();
  }
});

test('licensed judgment is never Construct’s, whatever the grants say', () => {
  const fx = freshStore();
  try {
    const d = evaluateAction(fx.store, { tier: 'licensed_judgment', targetSystem: 'legal', targetResource: 'msa-v3', operation: 'sign off the MSA', executorId: 'session:claude' }, manage);
    assert.equal(d.allowed, false);
    if (!d.allowed) {
      assert.equal(d.denial.stepUp.kind, 'licensed_review');
      assert.match(d.denial.safeNow.join(' '), /spot the issues/);
      assert.match(explainDenial(d.denial), /^Attempted: sign off the MSA/m);
    }
    assert.throws(() => approveAction(fx.store, { id: 'g', request: { tier: 'licensed_judgment', targetSystem: 'legal', targetResource: 'x', operation: 'x', executorId: 'e' }, by: 'gerald', at: T0 }), /not approved this way/);
  } finally {
    fx.cleanup();
  }
});

test('Scenario F: read and draft complete, the Jira write asks for the smallest approval, and the approval covers exactly that', () => {
  const fx = freshStore();
  try {
    assert.equal(evaluateAction(fx.store, { tier: 'observe', targetSystem: 'github', operation: 'read the PR', executorId: 'session:claude' }, manage).allowed, true);
    assert.equal(evaluateAction(fx.store, { tier: 'draft', targetSystem: 'jira', targetResource: 'PROJ-14', operation: 'draft the status change', executorId: 'session:claude' }, manage).allowed, true);

    const denied = evaluateAction(fx.store, jiraWrite, manage);
    assert.equal(denied.allowed, false);
    if (!denied.allowed) {
      assert.equal(denied.denial.attempted, 'move PROJ-14 to Done (external_write on jira PROJ-14)');
      assert.match(denied.denial.missing, /approval for external_write on jira PROJ-14 by session:claude/);
      assert.deepEqual(denied.denial.safeNow.length, 2);
      assert.equal(denied.denial.stepUp.kind, 'approval');
      if (denied.denial.stepUp.kind === 'approval') {
        assert.deepEqual(denied.denial.stepUp.proposedGrant, {
          actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-14', workflowId: 'design-conformance', executorId: 'session:claude', budgetCents: null, ttlMs: DEFAULT_APPROVAL_TTL_MS,
        });
      }
      const text = explainDenial(denied.denial);
      assert.match(text, /Missing: approval/);
      assert.match(text, /Smallest step-up: Approve exactly this: move PROJ-14 to Done/);
    }

    const grant = approveAction(fx.store, { id: 'g-1', request: jiraWrite, by: 'gerald', at: T0 });
    assert.equal(grant.endsAt, '2026-09-02T11:00:00.000Z');
    assert.equal(grant.breakGlass, false);
    const allowed = evaluateAction(fx.store, jiraWrite, { ...manage, at: '2026-09-02T10:30:00.000Z' });
    assert.equal(allowed.allowed && allowed.basis, 'action_time_approval');
    assert.equal(allowed.allowed && allowed.grant?.id, 'g-1');

    // Not widened: another ticket, another executor, another workflow, a destructive tier.
    assert.equal(evaluateAction(fx.store, { ...jiraWrite, targetResource: 'PROJ-15' }, { ...manage, at: '2026-09-02T10:30:00.000Z' }).allowed, false);
    assert.equal(evaluateAction(fx.store, { ...jiraWrite, executorId: 'runner:headless' }, { ...manage, at: '2026-09-02T10:30:00.000Z' }).allowed, false);
    assert.equal(evaluateAction(fx.store, { ...jiraWrite, workflowId: 'other' }, { ...manage, at: '2026-09-02T10:30:00.000Z' }).allowed, false);
    assert.equal(evaluateAction(fx.store, { ...jiraWrite, tier: 'destructive', operation: 'delete PROJ-14' }, { ...manage, at: '2026-09-02T10:30:00.000Z' }).allowed, false);
    // Not persisted: after the TTL it is gone.
    assert.equal(evaluateAction(fx.store, jiraWrite, { ...manage, at: '2026-09-02T11:00:00.000Z' }).allowed, false);
    assert.deepEqual(listActivity(fx.store).map((e) => e.kind), ['grant.created', 'policy.approved']);
  } finally {
    fx.cleanup();
  }
});

test('a standing grant covers its scope; revocation and budget ceilings end it', () => {
  const fx = freshStore();
  try {
    createGrant(fx.store, { id: 'std', actionTier: 'external_write', targetSystem: 'jira', workflowId: 'design-conformance', budgetCents: 500, startsAt: T0, grantedBy: 'gerald', at: T0 });
    const ok = evaluateAction(fx.store, { ...jiraWrite, budgetCents: 100 }, manage);
    assert.equal(ok.allowed && ok.basis, 'standing_grant');
    const overBudget = evaluateAction(fx.store, { ...jiraWrite, budgetCents: 900 }, manage);
    assert.equal(overBudget.allowed, false);
    assert.match(!overBudget.allowed ? overBudget.denial.missing : '', /budget covers 900 cents/);
    const noTarget = evaluateAction(fx.store, { ...jiraWrite, targetResource: undefined }, manage);
    assert.equal(!noTarget.allowed && noTarget.denial.stepUp.kind, 'name_the_target');
    revokeGrant(fx.store, { id: 'std', reason: 'done', by: 'gerald', at: '2026-09-02T10:05:00.000Z' });
    assert.equal(evaluateAction(fx.store, jiraWrite, { ...manage, at: '2026-09-02T10:06:00.000Z' }).allowed, false);
  } finally {
    fx.cleanup();
  }
});

test('destructive actions need action-time approval; a wildcard standing grant is not enough', () => {
  const fx = freshStore();
  try {
    createGrant(fx.store, { id: 'wild', actionTier: 'destructive', targetSystem: 'github', startsAt: T0, grantedBy: 'gerald', at: T0 });
    const del: ActionRequest = { tier: 'destructive', targetSystem: 'github', targetResource: 'acme/ledger#branch/old', operation: 'delete the old branch', executorId: 'session:claude' };
    assert.equal(evaluateAction(fx.store, del, manage).allowed, false);
    approveAction(fx.store, { id: 'ok-1', request: del, by: 'gerald', at: T0, ttlMs: 10 * 60_000 });
    const d = evaluateAction(fx.store, del, { ...manage, at: '2026-09-02T10:05:00.000Z' });
    assert.equal(d.allowed && d.basis, 'action_time_approval');
    assert.equal(evaluateAction(fx.store, del, { ...manage, at: '2026-09-02T10:11:00.000Z' }).allowed, false);
  } finally {
    fx.cleanup();
  }
});

test('break-glass is exact, reasoned, short, non-transferable, and leaves every gate in place', () => {
  const fx = freshStore();
  try {
    const del: ActionRequest = { tier: 'destructive', targetSystem: 'github', targetResource: 'acme/ledger#branch/old', operation: 'delete the old branch', executorId: 'session:claude' };
    assert.throws(() => breakGlass(fx.store, { id: 'bg', request: { ...del, tier: 'draft' }, reason: 'x', by: 'gerald', at: T0, ttlMs: 60_000 }), /external or destructive/);
    assert.throws(() => breakGlass(fx.store, { id: 'bg', request: del, reason: '', by: 'gerald', at: T0, ttlMs: 60_000 }), /needs a reason/);
    assert.throws(() => breakGlass(fx.store, { id: 'bg', request: del, reason: 'incident 7', by: 'gerald', at: T0, ttlMs: 5 * 3_600_000 }), /at most/);
    const g = breakGlass(fx.store, { id: 'bg', request: del, reason: 'incident 7: leaked secret on that branch', by: 'gerald', at: T0, ttlMs: 30 * 60_000 });
    assert.equal(g.breakGlass, true);
    const d = evaluateAction(fx.store, del, { ...manage, at: '2026-09-02T10:10:00.000Z' });
    assert.equal(d.allowed && d.basis, 'break_glass');
    assert.equal(d.gatesStillApply, true);
    assert.equal(evaluateAction(fx.store, { ...del, executorId: 'runner:headless' }, { ...manage, at: '2026-09-02T10:10:00.000Z' }).allowed, false);
    assert.equal(evaluateAction(fx.store, { ...del, targetResource: 'acme/ledger#branch/main' }, { ...manage, at: '2026-09-02T10:10:00.000Z' }).allowed, false);
    assert.equal(evaluateAction(fx.store, del, { ...manage, at: '2026-09-02T10:31:00.000Z' }).allowed, false);
    assert.equal(listGrants(fx.store).filter((x) => x.breakGlass).length, 1);
    assert.ok(listActivity(fx.store).some((e) => e.kind === 'grant.break_glass'));
  } finally {
    fx.cleanup();
  }
});
