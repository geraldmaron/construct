/**
 * tests/status-enterprise.test.mjs — Enterprise mode status honesty checks.
 *
 * Verifies that CONSTRUCT_DEPLOYMENT_MODE=enterprise causes:
 *   1. buildStatus to include a per-capability truth table in deployment.
 *   2. deployment.enterpriseVerdict === 'unsupported' while the ADR-0057
 *      IMPLEMENT-NOW capabilities are not yet implemented.
 *   3. formatStatusReport emits the standing warning and capability table.
 *
 * Bead: construct-9oi4.8.6 — LMCP-H6
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildStatus, formatStatusReport, categorizeEnterpriseCapability } from '../lib/status.mjs';
import { CAPABILITY_REGISTRY } from '../lib/mode-capabilities.mjs';
import { tempDir } from './helpers.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

async function createEnterpriseFixture() {
  const rootDir = tempDir('construct-status-enterprise-root-');
  const homeDir = tempDir('construct-status-enterprise-home-');

  writeJson(path.join(rootDir, 'package.json'), { name: 'construct', version: '9.9.9' });
  writeJson(path.join(rootDir, 'agents', 'registry.json'), {
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
    },
    personas: [{ name: 'construct', displayName: 'Construct', role: 'orchestrator', description: 'Public entry point' }],
    agents: [{ name: 'engineer', description: 'Implements changes' }],
  });
  // Note: no CONSTRUCT_DEPLOYMENT_MODE in .env — it is passed via the env param below.
  writeText(path.join(rootDir, '.env'), 'MEMORY_PORT=8765\nBRIDGE_PORT=5173\n');
  writeJson(path.join(homeDir, '.claude', 'settings.json'), { mcpServers: {}, hooks: {} });

  return { rootDir, homeDir };
}

test('buildStatus enterprise mode: deployment has enterpriseCapabilityTable with per-capability truth', async () => {
  const { rootDir, homeDir } = await createEnterpriseFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' },
    probeService: async () => ({ status: 'unavailable', message: 'not connected' }),
  });

  assert.equal(status.deployment.mode, 'enterprise', 'deployment mode should be enterprise');
  assert.ok(
    Array.isArray(status.deployment.enterpriseCapabilityTable),
    'enterpriseCapabilityTable should be an array',
  );

  const table = status.deployment.enterpriseCapabilityTable;

  // Should have as many entries as the enterprise capability registry.
  const registryCaps = CAPABILITY_REGISTRY.enterprise;
  assert.equal(
    table.length,
    registryCaps.length,
    'table length should match the enterprise capability registry',
  );

  // Each entry must have the real status from the registry.
  for (const regCap of registryCaps) {
    const tableEntry = table.find((c) => c.id === regCap.id);
    assert.ok(tableEntry, `capability ${regCap.id} should be in the table`);
    assert.equal(
      tableEntry.status,
      regCap.status,
      `capability ${regCap.id} status should match registry (${regCap.status})`,
    );
    assert.equal(typeof tableEntry.label, 'string', `capability ${regCap.id} should have a label`);
    assert.equal(typeof tableEntry.implementNow, 'boolean', `capability ${regCap.id} should have implementNow boolean`);
  }

  // All current enterprise capabilities are not-implemented → status must be in that set.
  for (const entry of table) {
    assert.ok(
      ['implemented', 'stub', 'not-implemented'].includes(entry.status),
      `capability ${entry.id} status '${entry.status}' should be a valid status value`,
    );
  }
});

test('buildStatus enterprise mode: overall enterpriseVerdict is unsupported when implement-now caps are not implemented', async () => {
  const { rootDir, homeDir } = await createEnterpriseFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' },
    probeService: async () => ({ status: 'unavailable', message: 'not connected' }),
  });

  // All enterprise capabilities are currently not-implemented → verdict must be unsupported.
  assert.equal(
    status.deployment.enterpriseVerdict,
    'unsupported',
    'enterpriseVerdict should be unsupported while implement-now capabilities are not implemented',
  );

  // capabilityStatus from getModeCapabilityStatus should also reflect this.
  assert.equal(
    status.deployment.capabilityStatus,
    'unsupported',
    'capabilityStatus should be unsupported',
  );
});

test('buildStatus enterprise mode: implement-now capabilities are correctly flagged', async () => {
  const { rootDir, homeDir } = await createEnterpriseFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' },
    probeService: async () => ({ status: 'unavailable', message: 'not connected' }),
  });

  const table = status.deployment.enterpriseCapabilityTable;
  const IMPLEMENT_NOW_IDS = ['tenant-isolation', 'rbac', 'mandatory-audit'];

  for (const id of IMPLEMENT_NOW_IDS) {
    const entry = table.find((c) => c.id === id);
    if (entry) {
      assert.equal(
        entry.implementNow,
        true,
        `${id} should be flagged as implementNow`,
      );
    }
    // If the capability id doesn't exist in the current registry it is simply absent — no failure.
  }
});

test('formatStatusReport enterprise mode: emits standing warning and capability table', async () => {
  const { rootDir, homeDir } = await createEnterpriseFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    env: { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' },
    probeService: async () => ({ status: 'unavailable', message: 'not connected' }),
  });

  const report = formatStatusReport(status);

  assert.match(
    report,
    /Enterprise mode: most capabilities not yet implemented/,
    'report should contain the standing enterprise warning',
  );
  assert.match(
    report,
    /Enterprise verdict: unsupported/,
    'report should show unsupported verdict',
  );
  assert.match(
    report,
    /Enterprise capability table:/,
    'report should include capability table header',
  );

  // Each registered enterprise capability should appear in the report, tagged
  // with its ADR-0057 category (active/fail-closed/later) — never the bare
  // 'not-implemented' status, which conflates fail-closed and later capabilities.
  for (const cap of CAPABILITY_REGISTRY.enterprise) {
    const category = categorizeEnterpriseCapability(cap);
    assert.match(
      report,
      new RegExp(cap.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `report should include capability label: ${cap.label}`,
    );
    assert.match(
      report,
      new RegExp(`${cap.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\(${category}\\)`),
      `report should show the ADR-0057 category (${category}) for ${cap.label}`,
    );
    assert.doesNotMatch(
      report,
      new RegExp(`${cap.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\(not-implemented\\)`),
      `report must never render the bare 'not-implemented' status for ${cap.label} — it must be categorized`,
    );
  }
});

test('categorizeEnterpriseCapability: distinguishes fail-closed from later per ADR-0057', () => {
  assert.equal(categorizeEnterpriseCapability({ id: 'tenant-isolation', status: 'not-implemented' }), 'fail-closed');
  assert.equal(categorizeEnterpriseCapability({ id: 'isolated-workers', status: 'not-implemented' }), 'fail-closed');
  assert.equal(categorizeEnterpriseCapability({ id: 'rbac', status: 'not-implemented' }), 'later');
  assert.equal(categorizeEnterpriseCapability({ id: 'signed-mcp-allowlists', status: 'not-implemented' }), 'later');
  assert.equal(categorizeEnterpriseCapability({ id: 'mandatory-audit', status: 'implemented' }), 'active');
  // An implemented capability is always 'active', even a fail-closed or later id,
  // per the ADR: "must never show a not-implemented capability as active" implies
  // the inverse is also true — an implemented one is never anything but active.
  assert.equal(categorizeEnterpriseCapability({ id: 'tenant-isolation', status: 'implemented' }), 'active');
  // An id with no ADR-0057 category (and not implemented) defaults to absent.
  assert.equal(categorizeEnterpriseCapability({ id: 'some-future-capability', status: 'not-implemented' }), 'absent');
});

test('buildStatus solo mode: no enterpriseCapabilityTable', async () => {
  const { rootDir, homeDir } = await createEnterpriseFixture();

  const status = await buildStatus({
    rootDir,
    homeDir,
    cwd: rootDir,
    env: {},
    probeService: async () => ({ status: 'unavailable', message: 'not connected' }),
  });

  assert.equal(status.deployment.mode, 'solo', 'default mode should be solo');
  assert.equal(
    status.deployment.enterpriseCapabilityTable,
    undefined,
    'solo mode should not have enterpriseCapabilityTable',
  );
  assert.equal(
    status.deployment.enterpriseVerdict,
    undefined,
    'solo mode should not have enterpriseVerdict',
  );
});
