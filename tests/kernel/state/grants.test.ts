/**
 * tests/kernel/state/grants.test.ts — grants are scoped, expire, revoke, and
 * break-glass is exact, short, and non-transferable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGrant, coveringGrants, revokeGrant, listGrants, GRANTABLE_TIERS, MAX_BREAK_GLASS_TTL_MS,
} from '../../../src/kernel/state/grants.ts';
import { listActivity } from '../../../src/kernel/state/activity.ts';
import { freshStore, clock } from './support.ts';

const T0 = '2026-09-02T10:00:00.000Z';
const T1 = '2026-09-02T11:00:00.000Z';
const T2 = '2026-09-02T12:00:00.000Z';

test('a standing grant covers its scope and nothing wider', () => {
  const fx = freshStore();
  try {
    createGrant(fx.store, {
      id: 'g-1', actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-1',
      workflowId: 'design-conformance', startsAt: T0, endsAt: T2, grantedBy: 'gerald', at: T0,
    });
    const hit = coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-1', workflowId: 'design-conformance', at: T1 });
    assert.deepEqual(hit.map((g) => g.id), ['g-1']);
    // Different resource, workflow, system, tier: not covered.
    assert.equal(coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-2', workflowId: 'design-conformance', at: T1 }).length, 0);
    assert.equal(coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-1', workflowId: 'other', at: T1 }).length, 0);
    assert.equal(coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'github', targetResource: 'PROJ-1', at: T1 }).length, 0);
    assert.equal(coveringGrants(fx.store, { actionTier: 'destructive', targetSystem: 'jira', targetResource: 'PROJ-1', workflowId: 'design-conformance', at: T1 }).length, 0);
    // A request that names no resource is wider than the grant: not covered.
    assert.equal(coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'jira', workflowId: 'design-conformance', at: T1 }).length, 0);
    // Outside the window: not covered.
    assert.equal(coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-1', workflowId: 'design-conformance', at: T2 }).length, 0);
    assert.equal(coveringGrants(fx.store, { actionTier: 'external_write', targetSystem: 'jira', targetResource: 'PROJ-1', workflowId: 'design-conformance', at: '2026-09-02T09:00:00.000Z' }).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('a NULL scope on a standing grant means any; revocation ends it', () => {
  const fx = freshStore();
  try {
    createGrant(fx.store, { id: 'g-any', actionTier: 'project_write', targetSystem: 'project', startsAt: T0, grantedBy: 'gerald', at: T0 });
    assert.equal(coveringGrants(fx.store, { actionTier: 'project_write', targetSystem: 'project', targetResource: 'docs/x.md', workflowId: 'w', executorId: 'e', at: T1 }).length, 1);
    revokeGrant(fx.store, { id: 'g-any', reason: 'no longer needed', by: 'gerald', at: T1 });
    assert.equal(coveringGrants(fx.store, { actionTier: 'project_write', targetSystem: 'project', at: T2 }).length, 0);
    assert.throws(() => revokeGrant(fx.store, { id: 'g-any', reason: 'again', by: 'gerald', at: T2 }), /no active grant/);
    assert.equal(listGrants(fx.store, { activeAt: T2 }).length, 0);
    assert.equal(listGrants(fx.store).length, 1);
    assert.deepEqual(listActivity(fx.store).map((e) => e.kind), ['grant.created', 'grant.revoked']);
  } finally {
    fx.cleanup();
  }
});

test('break-glass needs a reason, exact target, one executor, and a short expiry', () => {
  const fx = freshStore();
  try {
    const common = { actionTier: 'destructive' as const, targetSystem: 'github', startsAt: T0, grantedBy: 'gerald', at: T0, breakGlass: true };
    assert.throws(() => createGrant(fx.store, { ...common, id: 'b', targetResource: 'repo/x', executorId: 'e', endsAt: T1 }), /needs a reason/);
    assert.throws(() => createGrant(fx.store, { ...common, id: 'b', reason: 'incident', executorId: 'e', endsAt: T1 }), /exact target resource/);
    assert.throws(() => createGrant(fx.store, { ...common, id: 'b', reason: 'incident', targetResource: 'repo/x', endsAt: T1 }), /one executor/);
    assert.throws(() => createGrant(fx.store, { ...common, id: 'b', reason: 'incident', targetResource: 'repo/x', executorId: 'e' }), /must expire/);
    const tooLong = new Date(Date.parse(T0) + MAX_BREAK_GLASS_TTL_MS + 1000).toISOString();
    assert.throws(() => createGrant(fx.store, { ...common, id: 'b', reason: 'incident', targetResource: 'repo/x', executorId: 'e', endsAt: tooLong }), /at most/);

    const ok = createGrant(fx.store, { ...common, id: 'b', reason: 'incident 42', targetResource: 'repo/x', executorId: 'session:claude', endsAt: T1 });
    assert.equal(ok.breakGlass, true);
    // Exact executor only: it does not transfer.
    assert.equal(coveringGrants(fx.store, { actionTier: 'destructive', targetSystem: 'github', targetResource: 'repo/x', executorId: 'session:claude', at: '2026-09-02T10:30:00.000Z' }).length, 1);
    assert.equal(coveringGrants(fx.store, { actionTier: 'destructive', targetSystem: 'github', targetResource: 'repo/x', executorId: 'runner:headless', at: '2026-09-02T10:30:00.000Z' }).length, 0);
    assert.equal(coveringGrants(fx.store, { actionTier: 'destructive', targetSystem: 'github', targetResource: 'repo/y', executorId: 'session:claude', at: '2026-09-02T10:30:00.000Z' }).length, 0);
    assert.equal(listActivity(fx.store).at(-1)?.kind, 'grant.break_glass');
  } finally {
    fx.cleanup();
  }
});

test('licensed judgment can never be granted or covered', () => {
  const fx = freshStore();
  try {
    assert.ok(!(GRANTABLE_TIERS as readonly string[]).includes('licensed_judgment'));
    assert.throws(
      () => createGrant(fx.store, { id: 'g', actionTier: 'licensed_judgment' as never, targetSystem: 'legal', startsAt: T0, grantedBy: 'gerald', at: T0 }),
      /actionTier must be one of/,
    );
    assert.throws(
      () => fx.store.db.prepare(`INSERT INTO grants (id, action_tier, target_system, starts_at, granted_by, break_glass, created_at) VALUES ('x', 'licensed_judgment', 'legal', ?, 'g', 0, ?)`).run(T0, T0),
      /CHECK/,
    );
    assert.equal(coveringGrants(fx.store, { actionTier: 'licensed_judgment', targetSystem: 'legal', at: T1 }).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('grant inputs are validated', () => {
  const fx = freshStore();
  try {
    assert.throws(() => createGrant(fx.store, { id: 'g', actionTier: 'draft', targetSystem: 'x', startsAt: T1, endsAt: T0, grantedBy: 'g', at: T0 }), /endsAt must be after/);
    assert.throws(() => createGrant(fx.store, { id: 'g', actionTier: 'draft', targetSystem: 'x', startsAt: T0, budgetCents: -1, grantedBy: 'g', at: T0 }), /budgetCents/);
    assert.throws(() => createGrant(fx.store, { id: 'g', actionTier: 'draft', targetSystem: '', startsAt: T0, grantedBy: 'g', at: T0 }), /targetSystem/);
    assert.equal(clock()().length, 24);
  } finally {
    fx.cleanup();
  }
});
