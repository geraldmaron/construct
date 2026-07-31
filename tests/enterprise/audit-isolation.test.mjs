/**
 * tests/enterprise/audit-isolation.test.mjs — enterprise audit isolation.
 *
 * Two adversarial guarantees for enterprise mode:
 *
 *   1. Mandatory audit is fail-closed: enterprise mode's policy gate
 *      (lib/policy/audit-gate.mjs, wired into lib/policy/engine.mjs#policyDecision)
 *      denies every action when the audit sink is down, rather than allowing the
 *      action through and silently dropping the audit record (the pre-H5 broker
 *      behavior at lib/mcp/broker.mjs's best-effort audit catch).
 *
 *   2. Cross-tenant isolation: tenant A's records are never readable via a
 *      tenant B context, across the queue (lib/intake/queue.mjs), the denied
 *      decision store and audit trail (I3's tenant-tagged records), and the
 *      memory/observation and entity stores (rootDir-scoped today; H4 owns
 *      physical multi-tenant storage, not yet landed). lib/tenant/isolation.mjs
 *      is the enforcement layer under test: assertTenantMatch and
 *      scopeToTenant must throw/exclude on every cross-tenant read attempt,
 *      and fail closed (throw) when either side's tenant is unresolved.
 *
 * The observation/entity store cases resolve project state through the
 * machine-scoped state root, keyed by a hash of each tmp rootDir —
 * so CONSTRUCT_HOME_OVERRIDE is pinned for the whole file to keep those writes off
 * the real developer machine's $HOME.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { policyDecision } from '../../lib/policy/engine.mjs';
import { enforceMandatoryAudit, AUDIT_GATE_SOURCE } from '../../lib/policy/audit-gate.mjs';
import { checkAuditSinkAvailable, appendAuditRecord } from '../../lib/audit-trail.mjs';
import { createIntakeQueue, TENANT_ID_ENV_KEY } from '../../lib/intake/queue.mjs';
import { DeniedStore } from '../../lib/mcp/denied-store.mjs';
import {
  assertTenantMatch,
  scopeToTenant,
  readTenantScoped,
  TenantIsolationViolation,
} from '../../lib/tenant/isolation.mjs';
import { addObservation, listObservations } from '../../lib/observation-store.mjs';
import { createEntity, listEntities } from '../../lib/entity-store.mjs';

let homeOverride;
let prevHomeOverride;

before(() => {
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-audit-isolation-home-'));
  prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
});

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function healthySink() {
  return () => ({ available: true, reason: null });
}

function downSink(reason = 'EROFS') {
  return () => ({ available: false, reason });
}

describe('mandatory audit — fail closed when the sink is down', () => {
  it('enforceMandatoryAudit denies in enterprise mode when the sink is unavailable', () => {
    const result = enforceMandatoryAudit({ deploymentMode: 'enterprise', checkSink: downSink('ENOSPC') });
    assert.ok(result, 'gate must return a decision, not null, when the sink is down');
    assert.equal(result.allowed, false);
    assert.equal(result.approvalRequired, false);
    assert.equal(result.source, AUDIT_GATE_SOURCE);
    assert.match(result.reason, /audit sink unavailable/);
    assert.match(result.reason, /ENOSPC/);
  });

  it('enforceMandatoryAudit is a no-op (returns null) when the sink is healthy', () => {
    const result = enforceMandatoryAudit({ deploymentMode: 'enterprise', checkSink: healthySink() });
    assert.equal(result, null);
  });

  it('enforceMandatoryAudit never fires outside enterprise mode, even with the sink down', () => {
    assert.equal(enforceMandatoryAudit({ deploymentMode: 'solo', checkSink: downSink() }), null);
    assert.equal(enforceMandatoryAudit({ deploymentMode: 'team', checkSink: downSink() }), null);
  });

  it('policyDecision refuses an enterprise action end-to-end when the audit sink is down', () => {
    const decision = policyDecision(
      { role: 'engineer', tool: 'Edit', action: 'files:write', deploymentMode: 'enterprise' },
      { checkSink: downSink('read-only file system') },
    );
    assert.equal(decision.allowed, false, 'enterprise action must be refused when the audit sink is down');
    assert.equal(decision.source, AUDIT_GATE_SOURCE);
    assert.match(decision.reason, /fail-closed/);
  });

  it('policyDecision denies via the audit gate specifically, not merely via deny-by-default, when the sink is down', () => {
    // Both an unresolvable role manifest and the audit gate deny in
    // enterprise mode, so the discriminator under test is `source`: the gate
    // must be the reason recorded, proving it runs (and wins) ahead of the
    // manifest/deny-by-default path rather than coincidentally agreeing with it.
    const withHealthySink = policyDecision(
      { role: 'engineer', tool: 'Read', action: 'files:read', deploymentMode: 'enterprise' },
      { checkSink: healthySink() },
    );
    assert.equal(withHealthySink.allowed, false, 'sanity: no manifest for this role means enterprise still denies');
    assert.notEqual(withHealthySink.source, AUDIT_GATE_SOURCE, 'sanity: this denial is from manifest lookup, not the audit gate');

    const withDownSinkEnterprise = policyDecision(
      { role: 'engineer', tool: 'Read', action: 'files:read', deploymentMode: 'enterprise' },
      { checkSink: downSink() },
    );
    assert.equal(withDownSinkEnterprise.allowed, false);
    assert.equal(withDownSinkEnterprise.source, AUDIT_GATE_SOURCE, 'the audit gate, not manifest lookup, must be the recorded reason');
  });

  it('policyDecision proceeds normally in enterprise mode once the sink recovers', () => {
    // Deny-by-default still applies past the gate (no role manifest / grant configured
    // for this identity-less enterprise call) — the point under test is that the gate
    // itself yields control back rather than permanently refusing.
    const decision = policyDecision(
      { role: 'engineer', tool: 'Edit', action: 'files:write', deploymentMode: 'enterprise' },
      { checkSink: healthySink() },
    );
    assert.notEqual(decision.source, AUDIT_GATE_SOURCE);
  });

  it('checkAuditSinkAvailable reports unavailable for a path that cannot be created', () => {
    // Point the audit file at a path segment that is itself a regular file —
    // mkdirSync(dirname(file), {recursive:true}) must fail because a file
    // cannot be treated as a directory, exercising the real fs-backed probe.
    const root = tmp('cx-audit-sink-blocked-');
    const blocker = path.join(root, 'blocker-is-a-file');
    fs.writeFileSync(blocker, 'not a directory');
    const auditFile = path.join(blocker, 'nested', 'audit-trail.jsonl');

    const result = checkAuditSinkAvailable({ file: auditFile });
    assert.equal(result.available, false);
    assert.ok(result.reason, 'must report a reason when the sink is unavailable');
  });

  it('checkAuditSinkAvailable reports available for a healthy writable directory', () => {
    const root = tmp('cx-audit-sink-healthy-');
    const auditFile = path.join(root, 'nested', 'audit-trail.jsonl');
    const result = checkAuditSinkAvailable({ file: auditFile });
    assert.equal(result.available, true);
    assert.equal(result.reason, null);

    // The probe must not leave debris behind in the healthy case.
    const leftover = fs.readdirSync(path.dirname(auditFile)).filter((f) => f.startsWith('.audit-sink-probe-'));
    assert.equal(leftover.length, 0, 'sink probe must clean up after itself');
  });

  it('appendAuditRecord (I3 schema, N3 redaction, chain hash) still functions when the sink is healthy', () => {
    // Regression guard: the fail-closed gate must not have disturbed the
    // existing redact-then-sign + chain-hash append path it wraps around.
    const root = tmp('cx-audit-append-regress-');
    const file = path.join(root, 'audit-trail.jsonl');
    const record = appendAuditRecord(
      { agent: 'mcp-broker', actor: 'tenant-a-user', tenant: 'tenant-a', tool: 'Edit', target: 'file.js' },
      { file },
    );
    assert.equal(record.actor, 'tenant-a-user');
    assert.equal(record.tenant, 'tenant-a');
    assert.ok('prev_line_hash' in record);

    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
  });
});

describe('cross-tenant isolation — audit trail records (I3 schema)', () => {
  it('tenant A audit records are excluded when read under tenant B context', () => {
    // readAuditTrail() always reads the process-default AUDIT_FILE (it has
    // no file override), so the isolation guard is exercised directly
    // against records drawn from this test's own hermetic file instead.
    const root = tmp('cx-audit-isolation-');
    const file = path.join(root, 'audit-trail.jsonl');

    appendAuditRecord({ agent: 'mcp-broker', actor: 'user-a', tenant: 'tenant-a', tool: 'Edit', target: 'a.js' }, { file });
    appendAuditRecord({ agent: 'mcp-broker', actor: 'user-b', tenant: 'tenant-b', tool: 'Edit', target: 'b.js' }, { file });
    appendAuditRecord({ agent: 'mcp-broker', actor: 'user-a', tenant: 'tenant-a', tool: 'Write', target: 'a2.js' }, { file });

    const rawLines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

    const tenantAView = scopeToTenant(rawLines, 'tenant-a');
    assert.equal(tenantAView.length, 2);
    assert.ok(tenantAView.every((r) => r.tenant === 'tenant-a'));
    assert.ok(!tenantAView.some((r) => r.tenant === 'tenant-b'), 'tenant B record must never appear in tenant A view');

    const tenantBView = scopeToTenant(rawLines, 'tenant-b');
    assert.equal(tenantBView.length, 1);
    assert.ok(!tenantBView.some((r) => r.tenant === 'tenant-a'), 'tenant A record must never appear in tenant B view');
  });

  it('assertTenantMatch throws when a tenant-A record is checked against a tenant-B context', () => {
    assert.throws(
      () => assertTenantMatch('tenant-a', 'tenant-b'),
      TenantIsolationViolation,
    );
  });

  it('assertTenantMatch fails closed (throws) when the context tenant is missing, not just on mismatch', () => {
    assert.throws(() => assertTenantMatch('tenant-a', null), TenantIsolationViolation);
    assert.throws(() => assertTenantMatch('tenant-a', ''), TenantIsolationViolation);
    assert.throws(() => assertTenantMatch('tenant-a', '   '), TenantIsolationViolation);
  });

  it('assertTenantMatch fails closed (throws) when the record tenant is missing', () => {
    assert.throws(() => assertTenantMatch(null, 'tenant-a'), TenantIsolationViolation);
    assert.throws(() => assertTenantMatch(undefined, 'tenant-a'), TenantIsolationViolation);
  });

  it('assertTenantMatch passes silently for a genuine same-tenant read', () => {
    assert.doesNotThrow(() => assertTenantMatch('tenant-a', 'tenant-a'));
  });

  it('scopeToTenant fails closed (throws) rather than returning the unfiltered list when tenantId is unresolved', () => {
    const records = [{ tenant: 'tenant-a' }, { tenant: 'tenant-b' }];
    assert.throws(() => scopeToTenant(records, null), TenantIsolationViolation);
    assert.throws(() => scopeToTenant(records, ''), TenantIsolationViolation);
  });

  it('scopeToTenant drops records with no resolvable tenant field rather than leaking them into any view', () => {
    const records = [{ tenant: 'tenant-a' }, { actor: 'no-tenant-field' }, { tenant: '' }];
    const view = scopeToTenant(records, 'tenant-a');
    assert.equal(view.length, 1);
  });
});

describe('cross-tenant isolation — denied decision store (I3)', () => {
  it('tenant A denied decisions are never readable via tenant B context', () => {
    const rootDir = tmp('cx-denied-isolation-');
    const store = new DeniedStore({ rootDir });

    store.append({ decisionId: 'd1', actor: 'user-a', tenant: 'tenant-a', tool: 'Edit', target: 'a.js', risk: 'low', outcome: 'denied', correlationId: 'c1', ts: new Date().toISOString() });
    store.append({ decisionId: 'd2', actor: 'user-b', tenant: 'tenant-b', tool: 'Edit', target: 'b.js', risk: 'low', outcome: 'denied', correlationId: 'c2', ts: new Date().toISOString() });

    const tenantAView = store.readAllForTenant('tenant-a');
    assert.equal(tenantAView.length, 1);
    assert.equal(tenantAView[0].decisionId, 'd1');
    assert.ok(!tenantAView.some((r) => r.tenant === 'tenant-b'));

    const tenantBView = store.readAllForTenant('tenant-b');
    assert.equal(tenantBView.length, 1);
    assert.equal(tenantBView[0].decisionId, 'd2');
    assert.ok(!tenantBView.some((r) => r.tenant === 'tenant-a'));
  });

  it('readAllForTenant fails closed for an unresolved tenantId even with cross-tenant data present', () => {
    const rootDir = tmp('cx-denied-isolation-unresolved-');
    const store = new DeniedStore({ rootDir });
    store.append({ decisionId: 'd1', actor: 'user-a', tenant: 'tenant-a', tool: 'Edit', target: 'a.js', risk: 'low', outcome: 'denied', correlationId: 'c1', ts: new Date().toISOString() });

    assert.throws(() => store.readAllForTenant(undefined), TenantIsolationViolation);
  });
});

describe('cross-tenant isolation — intake queue', () => {
  it('createIntakeQueue stamps distinct tenantId per tenant context; queue entries from tenant A are excluded from a tenant-B-scoped read', () => {
    const rootDir = tmp('cx-queue-isolation-');

    const queueA = createIntakeQueue(rootDir, { [TENANT_ID_ENV_KEY]: 'tenant-a', CONSTRUCT_INTAKE_QUEUE_BACKEND: 'filesystem' });
    const queueB = createIntakeQueue(rootDir, { [TENANT_ID_ENV_KEY]: 'tenant-b', CONSTRUCT_INTAKE_QUEUE_BACKEND: 'filesystem' });
    assert.equal(queueA.tenantId, 'tenant-a');
    assert.equal(queueB.tenantId, 'tenant-b');

    // The filesystem queue backend is rootDir-scoped, not tenant-scoped (H4
    // is the bead that lands physical per-tenant queue storage) — entries
    // are stamped with tenantId so a reader can filter, which is exactly
    // what scopeToTenant/readTenantScoped enforce below.
    queueA.enqueue({ tenantId: queueA.tenantId, intake: { sourcePath: '/repo/a.md', outputPath: '/out/a.md', characters: 10, knowledgeSubdir: 'a' }, triage: { intakeType: 'note', rdStage: 'discover', primaryOwner: 'engineer', recommendedChain: [], recommendedAction: 'file', risk: 'low', requiresApproval: false, confidence: 0.9, rationale: 'test' }, suggestion: { lane: 'default', source: 'test' }, related: [], excerpt: '', query: '' });
    queueB.enqueue({ tenantId: queueB.tenantId, intake: { sourcePath: '/repo/b.md', outputPath: '/out/b.md', characters: 10, knowledgeSubdir: 'b' }, triage: { intakeType: 'note', rdStage: 'discover', primaryOwner: 'engineer', recommendedChain: [], recommendedAction: 'file', risk: 'low', requiresApproval: false, confidence: 0.9, rationale: 'test' }, suggestion: { lane: 'default', source: 'test' }, related: [], excerpt: '', query: '' });

    const allPending = queueA.listPending();
    assert.equal(allPending.length, 2, 'sanity: both entries land in the shared rootDir-scoped queue');

    const tenantAView = readTenantScoped(() => queueA.listPending(), 'tenant-a');
    assert.equal(tenantAView.length, 1);
    assert.match(tenantAView[0].intake.sourcePath, /a\.md$/);
    assert.ok(!tenantAView.some((e) => e.tenantId === 'tenant-b'), 'tenant B entry must never appear in tenant A view');

    const tenantBView = readTenantScoped(() => queueB.listPending(), 'tenant-b');
    assert.equal(tenantBView.length, 1);
    assert.match(tenantBView[0].intake.sourcePath, /b\.md$/);
    assert.ok(!tenantBView.some((e) => e.tenantId === 'tenant-a'), 'tenant A entry must never appear in tenant B view');

    // Fail-closed: an unresolved tenantId must refuse the read rather than
    // hand back every entry in the shared rootDir-scoped queue.
    assert.throws(() => readTenantScoped(() => queueA.listPending(), ''), TenantIsolationViolation);
  });
});

// Neither the observation store nor the entity store carries a native tenant
// column today (H4 is the bead that lands physical per-tenant storage
// schema/columns). The isolation unit that exists right now is rootDir: a
// tenant-scoped deployment gives each tenant its own rootDir, which is the
// real boundary these adversarial checks pin — a reader constructed against
// tenant A's rootDir must never observe tenant B's records, however queried.

describe('cross-tenant isolation — memory (observation store)', () => {
  it('tenant A observations are never returned from a read scoped to tenant B rootDir', async () => {
    const rootA = tmp('cx-mem-tenant-a-');
    const rootB = tmp('cx-mem-tenant-b-');

    // addObservation/listObservations resolve the machine-scoped state root
    // via CONSTRUCT_HOME_OVERRIDE read in-process, not via rootA/rootB —
    // pin it or they write into the real developer machine's home.
    const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
    process.env.CONSTRUCT_HOME_OVERRIDE = rootA;
    try {
      await addObservation(rootA, { role: 'engineer', category: 'insight', summary: 'tenant-a-secret-summary', content: 'tenant-a-secret-content', project: 'tenant-a' });
      await addObservation(rootB, { role: 'engineer', category: 'insight', summary: 'tenant-b-secret-summary', content: 'tenant-b-secret-content', project: 'tenant-b' });

      const viewFromB = listObservations(rootB, { limit: 100 });
      assert.ok(!viewFromB.some((o) => o.summary === 'tenant-a-secret-summary'), 'tenant A observation must never be visible from tenant B rootDir');
      assert.ok(viewFromB.some((o) => o.summary === 'tenant-b-secret-summary'));

      const viewFromA = listObservations(rootA, { limit: 100 });
      assert.ok(!viewFromA.some((o) => o.summary === 'tenant-b-secret-summary'), 'tenant B observation must never be visible from tenant A rootDir');
      assert.ok(viewFromA.some((o) => o.summary === 'tenant-a-secret-summary'));
    } finally {
      if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
      else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    }
  });
});

describe('cross-tenant isolation — entity store', () => {
  it('tenant A entities are never returned from a read scoped to tenant B rootDir', () => {
    const rootA = tmp('cx-entity-tenant-a-');
    const rootB = tmp('cx-entity-tenant-b-');

    createEntity(rootA, { name: 'tenant-a-only-entity', type: 'concept', summary: 'belongs to tenant a', project: 'tenant-a' });
    createEntity(rootB, { name: 'tenant-b-only-entity', type: 'concept', summary: 'belongs to tenant b', project: 'tenant-b' });

    const viewFromB = listEntities(rootB, { limit: 100 });
    assert.ok(!viewFromB.some((e) => e.name === 'tenant-a-only-entity'), 'tenant A entity must never be visible from tenant B rootDir');
    assert.ok(viewFromB.some((e) => e.name === 'tenant-b-only-entity'));

    const viewFromA = listEntities(rootA, { limit: 100 });
    assert.ok(!viewFromA.some((e) => e.name === 'tenant-b-only-entity'), 'tenant B entity must never be visible from tenant A rootDir');
    assert.ok(viewFromA.some((e) => e.name === 'tenant-a-only-entity'));
  });
});
