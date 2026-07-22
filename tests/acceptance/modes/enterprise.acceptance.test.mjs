/**
 * tests/acceptance/modes/enterprise.acceptance.test.mjs — LMCP-L6 enterprise-mode
 * acceptance leg.
 *
 * Enterprise mode has 6 CAPABILITY_REGISTRY.enterprise entries (lib/mode-capabilities.mjs):
 * 2 'implemented' (worker-heartbeat, mandatory-audit) and 4 'not-implemented'
 * (tenant-isolation, rbac, isolated-workers, signed-mcp-allowlists). Unlike
 * solo/team, "what enterprise delivers today" is mostly a fail-closed refusal, not
 * a working feature — so this leg proves the refusal is real, not that the missing
 * capabilities work:
 *
 * H1 (lib/tenant/context.mjs): resolveTenantContext throws TenantResolutionError
 * for enterprise mode with no resolvable tenant id, and never throws for solo/team.
 * H5 (lib/policy/audit-gate.mjs, lib/audit-trail.mjs): enforceMandatoryAudit denies
 * every enterprise action when checkAuditSinkAvailable's real write-probe fails
 * (forced by pointing it at a path whose parent segment is a plain file — ENOTDIR
 * is a genuine fs error, not a mock — so it fails deterministically regardless of
 * the OS user's permissions, unlike a chmod-based approach which root can bypass).
 * H6 (lib/status.mjs): buildStatus/formatStatusReport render the real capability
 * table and an 'unsupported' enterpriseVerdict while enterprise is not fully wired.
 *
 * worker-heartbeat (shared with team mode) is additionally proven here with a
 * tenant-scoping angle team's leg doesn't need: two WorkerRegistry instances
 * constructed with different tenantIds but the SAME workerId, against a real
 * Postgres, each see only their own row via list() — the tenant_id column is a
 * real WHERE-clause dimension (H1 data plumbing), not a label. This is not H4
 * (isolated storage/workers) — see lib/tenant/context.mjs's own doc comment.
 * Self-skips (does not fail) when neither DATABASE_URL nor CONSTRUCT_DATABASE_URL
 * is set, matching team.acceptance.test.mjs; the fail-closed (H1/H5/H6) checks
 * above need no database and always run.
 *
 * mandatory-audit needs no database and always runs as part of the parity check.
 *
 * Run standalone (fail-closed checks need nothing; worker-heartbeat needs Postgres):
 *   node --test tests/acceptance/modes/enterprise.acceptance.test.mjs
 *   DATABASE_URL=postgres://... node --test tests/acceptance/modes/enterprise.acceptance.test.mjs
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createSqlClient, closeSqlClient } from '../../../lib/storage/backend.mjs';
import { applyMigrations } from '../../../lib/db/migrate.mjs';
import { WorkerRegistry } from '../../../lib/orchestration/worker-runtime.mjs';
import { resolveTenantContext, TenantResolutionError } from '../../../lib/tenant/context.mjs';
import { enforceMandatoryAudit, AUDIT_GATE_SOURCE } from '../../../lib/policy/audit-gate.mjs';
import { checkAuditSinkAvailable } from '../../../lib/audit-trail.mjs';
import { buildStatus, formatStatusReport, categorizeEnterpriseCapability } from '../../../lib/status.mjs';
import { CAPABILITY_REGISTRY } from '../../../lib/mode-capabilities.mjs';
import { tempDir } from '../../helpers.mjs';
import { rmTmpDir } from '../../helpers/cleanup.mjs';

// buildStatus's storage/run-store probes resolve through the machine-scoped
// state root (ADR-0066, lib/state-root.mjs) via the real homeDir() function,
// not the `homeDir` parameter passed into buildStatus() below — only
// CONSTRUCT_HOME_OVERRIDE (a real process.env mutation) relocates that. Set for the
// whole file so no probe here ever touches the real developer machine's $HOME.

const homeOverride = tempDir('cx-l6-enterprise-home-override-');
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { rmTmpDir(homeOverride); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const PROJECT = `lmcp-l6-enterprise-acceptance-${process.pid}`;

function hasDatabaseUrl() {
  return Boolean((process.env.DATABASE_URL || process.env.CONSTRUCT_DATABASE_URL || '').trim());
}

test('[LMCP-L6] enterprise mode: fail-closed tenant resolution (H1)', () => {
  assert.throws(
    () => resolveTenantContext({ env: {}, mode: 'enterprise' }),
    TenantResolutionError,
    'enterprise mode with no tenant id anywhere must fail closed',
  );
  assert.throws(
    () => resolveTenantContext({ env: { CONSTRUCT_TENANT_ID: '   ' }, mode: 'enterprise' }),
    TenantResolutionError,
    'a whitespace-only tenant id must be treated as unresolved',
  );

  const resolved = resolveTenantContext({ env: { CONSTRUCT_TENANT_ID: 'acme-corp' }, mode: 'enterprise' });
  assert.equal(resolved.tenantId, 'acme-corp');
  assert.equal(resolved.source, 'env');

  const soloDefault = resolveTenantContext({ env: {}, mode: 'solo' });
  assert.equal(soloDefault.tenantId, 'local', 'solo mode must never throw; it defaults instead');
  const teamDefault = resolveTenantContext({ env: {}, mode: 'team' });
  assert.equal(teamDefault.tenantId, 'local', 'team mode must never throw; it defaults instead');
});

test('[LMCP-L6] enterprise mode: mandatory-audit gate fails closed on a genuinely broken sink (H5)', () => {
  const dir = tempDir('cx-l6-enterprise-audit-sink-');
  try {
    // A plain file cannot be mkdir'd into, even for the process owner/root —
    // a real, permission-independent fs failure (ENOTDIR), not a mock.
    const regularFile = path.join(dir, 'not-a-directory');
    fs.writeFileSync(regularFile, 'x');
    const brokenFile = path.join(regularFile, 'nested', 'audit-trail.jsonl');

    const sinkCheck = checkAuditSinkAvailable({ file: brokenFile });
    assert.equal(sinkCheck.available, false, 'the real write-probe must fail against an unwritable path');
    assert.ok(sinkCheck.reason, 'a failure reason must be reported');

    const decision = enforceMandatoryAudit({
      deploymentMode: 'enterprise',
      checkSink: () => checkAuditSinkAvailable({ file: brokenFile }),
    });
    assert.ok(decision, 'enterprise mode must produce a fail-closed decision when the sink is down');
    assert.equal(decision.allowed, false);
    assert.equal(decision.source, AUDIT_GATE_SOURCE);
    assert.match(decision.reason, /audit sink unavailable/);

    for (const mode of ['solo', 'team']) {
      const bypassed = enforceMandatoryAudit({ deploymentMode: mode, checkSink: () => ({ available: false, reason: 'forced-down' }) });
      assert.equal(bypassed, null, `${mode} mode must not be gated by the mandatory-audit check even when the sink is down`);
    }
  } finally {
    rmTmpDir(dir);
  }
});

test('[LMCP-L6] enterprise mode: mandatory-audit gate is a no-op against the real, healthy local sink', () => {
  const decision = enforceMandatoryAudit({ deploymentMode: 'enterprise' });
  assert.equal(decision, null, 'a healthy audit sink must not gate enterprise actions');
});

test('[LMCP-L6] enterprise mode: status/doctor renders real capability truth and an unsupported verdict (H6)', async () => {
  const rootDir = tempDir('cx-l6-enterprise-status-root-');
  const homeDir = tempDir('cx-l6-enterprise-status-home-');
  fs.mkdirSync(path.join(rootDir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'construct', version: '0.0.0-test' }));
  fs.writeFileSync(
    path.join(rootDir, 'agents', 'registry.json'),
    JSON.stringify({
      models: {
        reasoning: { primary: 'claude-opus-4-1-20250805' },
        standard: { primary: 'claude-3-5-sonnet-20241022' },
        fast: { primary: 'claude-3-5-haiku-20241022' },
      },
      personas: [{ name: 'construct', displayName: 'Construct', role: 'orchestrator', description: 'Public entry point' }],
      agents: [{ name: 'engineer', description: 'Implements changes' }],
    }),
  );
  fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify({ mcpServers: {}, hooks: {} }));

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' },
    probeService: async () => ({ status: 'unavailable', message: 'not connected' }),
  });

  assert.equal(status.deployment.mode, 'enterprise');
  assert.equal(status.deployment.enterpriseVerdict, 'unsupported', 'not every implement-now capability is implemented yet');
  assert.equal(status.deployment.capabilityStatus, 'unsupported');

  const table = status.deployment.enterpriseCapabilityTable;
  assert.equal(table.length, CAPABILITY_REGISTRY.enterprise.length, 'capability table must mirror the registry exactly');
  for (const regCap of CAPABILITY_REGISTRY.enterprise) {
    const entry = table.find((c) => c.id === regCap.id);
    assert.ok(entry, `capability ${regCap.id} must be in the rendered table`);
    assert.equal(entry.status, regCap.status, `rendered status for ${regCap.id} must match the registry, not a stale copy`);
    // ADR-0057 status contract: the table must also carry the four-way category
    // (active/fail-closed/later/absent) so callers can't conflate a fail-closed
    // capability with a later one just because both show 'not-implemented'.
    assert.equal(entry.category, categorizeEnterpriseCapability(regCap), `rendered category for ${regCap.id} must follow ADR-0057's partition`);
  }

  const report = formatStatusReport(status);
  assert.match(report, /Enterprise verdict: unsupported/);
  assert.match(report, /Enterprise capability table:/);
  assert.doesNotMatch(report, /\(not-implemented\)/, 'report must render ADR-0057 categories, never the bare not-implemented status');
});

async function checkMandatoryAudit() {
  const decision = enforceMandatoryAudit({ deploymentMode: 'enterprise' });
  assert.equal(decision, null, 'mandatory-audit capability check: healthy local sink must not gate');
}

async function checkWorkerHeartbeatEnterprise(sql) {
  const tenantA = resolveTenantContext({ env: { CONSTRUCT_TENANT_ID: 'lmcp-l6-tenant-a' }, mode: 'enterprise' }).tenantId;
  const tenantB = resolveTenantContext({ env: { CONSTRUCT_TENANT_ID: 'lmcp-l6-tenant-b' }, mode: 'enterprise' }).tenantId;
  const registryA = new WorkerRegistry({ sql, project: PROJECT, tenantId: tenantA });
  const registryB = new WorkerRegistry({ sql, project: PROJECT, tenantId: tenantB });

  await registryA.register({ workerId: 'worker-shared-id', capabilities: ['claim'] });
  await registryB.register({ workerId: 'worker-shared-id', capabilities: ['claim'] });

  const beatA = await registryA.heartbeat('worker-shared-id', { ttlSeconds: 60 });
  const beatB = await registryB.heartbeat('worker-shared-id', { ttlSeconds: 60 });
  assert.equal(beatA.renewed, true);
  assert.equal(beatB.renewed, true);

  const listedA = await registryA.list();
  const listedB = await registryB.list();
  assert.equal(listedA.length, 1, 'tenant A must only see its own worker row, not tenant B\'s same-id row');
  assert.equal(listedB.length, 1, 'tenant B must only see its own worker row, not tenant A\'s same-id row');
  assert.equal(listedA[0].workerId, 'worker-shared-id');
  assert.equal(listedB[0].workerId, 'worker-shared-id');

  await registryA.deregister('worker-shared-id');
  await registryB.deregister('worker-shared-id');
}

const ENTERPRISE_CAPABILITY_CHECKS = {
  'mandatory-audit': checkMandatoryAudit,
  'worker-heartbeat': checkWorkerHeartbeatEnterprise,
};

test('[LMCP-L6] enterprise mode: every implemented capability has a passing acceptance check', async (t) => {
  const implemented = CAPABILITY_REGISTRY.enterprise.filter((c) => c.status === 'implemented');
  const uncovered = implemented.filter((c) => typeof ENTERPRISE_CAPABILITY_CHECKS[c.id] !== 'function').map((c) => c.id);
  assert.deepEqual(
    uncovered,
    [],
    `enterprise capabilities marked 'implemented' with no acceptance check (${uncovered.length}/${implemented.length}): ${uncovered.join(', ')}`,
  );

  await t.test('mandatory-audit', () => ENTERPRISE_CAPABILITY_CHECKS['mandatory-audit']());

  await t.test('worker-heartbeat', async (st) => {
    if (!hasDatabaseUrl()) {
      st.skip('no DATABASE_URL/CONSTRUCT_DATABASE_URL set — the tenant-scoped worker-heartbeat leg requires a real Postgres (see dev/team-harness/README.md)');
      return;
    }
    const sql = createSqlClient(process.env);
    assert.ok(sql, 'DATABASE_URL/CONSTRUCT_DATABASE_URL is set but createSqlClient returned null — is the `postgres` package installed?');
    try {
      await applyMigrations(sql);
      await ENTERPRISE_CAPABILITY_CHECKS['worker-heartbeat'](sql);
    } finally {
      await closeSqlClient(sql);
    }
  });
});

test('[LMCP-L6] enterprise mode: not-implemented capabilities have not silently flipped', () => {
  const notImplemented = CAPABILITY_REGISTRY.enterprise.filter((c) => c.status !== 'implemented');
  const expectedDeferred = ['tenant-isolation', 'rbac', 'isolated-workers', 'signed-mcp-allowlists'];
  const actualDeferred = notImplemented.map((c) => c.id).sort();
  assert.deepEqual(
    actualDeferred,
    [...expectedDeferred].sort(),
    'enterprise not-implemented capability set changed — update LMCP-L6 acceptance coverage (add an ENTERPRISE_CAPABILITY_CHECKS entry and an H-track fail-closed/implemented check) if one flipped status',
  );
});
