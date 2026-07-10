/**
 * tests/functional/participation-cross-surface.functional.test.mjs — one
 * request, four surfaces (construct-pteo2.18, cdsp.71): the recruited set and
 * its reasons must be identical on the CLI (`construct workflow invoke`, real
 * binary), MCP (`workflow_invoke` handler, real module), the durable trace
 * (the `.cx/observations` decision record the invoke writes under
 * allow-durable-write), and the UI (Org Studio's participation preview over
 * HTTP). Each surface runs in its own tmpdir fixture with HOME redirected so
 * nothing leaks into the repo. The routePath half of cdsp.71 is pinned by
 * tests/orchestration-route-path.test.mjs (folded onto staging by the
 * construct-pteo2.15 substrate cherry-pick of 69ea7853).
 *
 * @capability workflow.prd-draft
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startOrgStudio } from '../../lib/org-studio/server.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO, 'bin', 'construct');

const COST_REQUEST =
  'PRD for usage-based billing pricing: per-request cost budget, monthly spend caps, and ROI targets for the finance dashboard';

const tmpDirs = [];
function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const home = fresh('cx-xsurface-home-');
const fixtures = { cli: fresh('cx-xsurface-cli-'), mcp: fresh('cx-xsurface-mcp-'), ui: fresh('cx-xsurface-ui-') };
fs.cpSync(path.join(REPO, 'specialists', 'org'), path.join(fixtures.ui, 'specialists', 'org'), { recursive: true });

// The MCP surface runs in-process, so the machine-scoped state root
// (~/.construct/projects/<key>, resolved via lib/paths.mjs homeDir()) must be
// redirected for THIS process too, not just the spawned CLI — otherwise the
// in-process workflowInvoke registers the tmp fixture as a real project key.

const originalHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = home;

let studio;
before(async () => {
  studio = await startOrgStudio({ rootDir: fixtures.ui, port: 0 });
});
after(async () => {
  await studio?.close();
  if (originalHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = originalHomeOverride;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// Reasons are compared as {specialist -> reason} so surface-specific
// ordering and volatile fields (workflowId, traceId) never enter the diff.

function recruitMap(recruited) {
  return Object.fromEntries(recruited.filter((p) => p.specialist).map((p) => [p.specialist, { role: p.role, gate: p.gate, reason: p.reason }]));
}

let cliData;
let mcpData;

test('CLI and MCP: the same request returns the same recruited set and reasons', async () => {
  const res = spawnSync('node', [BIN, 'workflow', 'invoke', '--json',
    '--workflow-type', 'prd-draft', '--approval-mode', 'allow-durable-write',
    '--text', COST_REQUEST,
  ], { cwd: fixtures.cli, encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: home, CX_HOME_OVERRIDE: home, CONSTRUCT_ROLES: 'off' } });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  cliData = JSON.parse(res.stdout).data;

  const prevCwd = process.cwd();
  process.chdir(fixtures.mcp);
  try {
    const { workflowInvoke } = await import('../../lib/mcp/tools/embedded-contract.mjs');
    mcpData = (await workflowInvoke({
      workflow_type: 'prd-draft', input: COST_REQUEST, approval_mode: 'allow-durable-write',
    })).data;
  } finally {
    process.chdir(prevCwd);
  }

  assert.ok(cliData.recruitment.recruited.length > 0, 'the cost request recruits someone');
  assert.deepEqual(recruitMap(cliData.recruitment.recruited), recruitMap(mcpData.recruitment.recruited), 'CLI and MCP recruited sets + reasons are identical');
  assert.deepEqual(cliData.recruitment.rationale, mcpData.recruitment.rationale, 'CLI and MCP rationale lines are identical');
  assert.deepEqual(cliData.selectedRoles, mcpData.selectedRoles, 'the recruited chain matches');
});

test('traces: the durable observation carries the recruited roles AND their reasons', () => {
  for (const [surface, dir] of [['cli', fixtures.cli], ['mcp', fixtures.mcp]]) {
    const obsDir = path.join(dir, '.cx', 'observations');
    const records = fs.readdirSync(obsDir)
      .filter((n) => n.endsWith('.json') && n !== 'index.json')
      .map((n) => JSON.parse(fs.readFileSync(path.join(obsDir, n), 'utf8')));
    const decision = records.find((r) => r.summary?.includes('Embedded workflow invoked'));
    assert.ok(decision, `${surface}: the invoke wrote a durable decision observation`);
    const data = surface === 'cli' ? cliData : mcpData;
    for (const role of data.recruitment.addedRoles) {
      assert.ok(decision.content.includes(`recruited=`) && decision.content.includes(role), `${surface}: trace names recruited role ${role}`);
    }
    for (const line of data.recruitment.rationale) {
      assert.ok(decision.content.includes(line), `${surface}: trace carries the recruitment reason "${line}"`);
    }
  }
});

test('UI: the participation preview for the same request surfaces the same recruits and reasons', async () => {
  const chainExclude = cliData.selectedRoles
    .filter((r) => !cliData.recruitment.addedRoles.includes(r))
    .map((r) => `cx-${r}`);
  const preview = await fetch(studio.url + '/api/preview/participation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: COST_REQUEST, exclude: chainExclude }),
  }).then((r) => r.json());

  const uiMap = recruitMap(preview.recruited);
  const runMap = recruitMap(cliData.recruitment.recruited);
  for (const [specialist, why] of Object.entries(runMap)) {
    assert.deepEqual(uiMap[specialist], why, `UI preview recruits ${specialist} with the same role/gate/reason as the run path`);
  }
});

test('MCP surface has no CLI-only recruitment capability: recruitment=off reconciles', async () => {
  const res = spawnSync('node', [BIN, 'workflow', 'invoke', '--json',
    '--workflow-type', 'prd-draft', '--approval-mode', 'proposal-only',
    '--recruitment', 'off', '--text', COST_REQUEST,
  ], { cwd: fixtures.cli, encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: home, CX_HOME_OVERRIDE: home, CONSTRUCT_ROLES: 'off' } });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  const cliOff = JSON.parse(res.stdout).data;

  const prevCwd = process.cwd();
  process.chdir(fixtures.mcp);
  let mcpOff;
  try {
    const { workflowInvoke } = await import('../../lib/mcp/tools/embedded-contract.mjs');
    mcpOff = (await workflowInvoke({
      workflow_type: 'prd-draft', input: COST_REQUEST, approval_mode: 'proposal-only', recruitment: 'off',
    })).data;
  } finally {
    process.chdir(prevCwd);
  }

  assert.deepEqual(cliOff.recruitment, { recruited: [], addedRoles: [], rationale: ['recruitment: off (caller override)'] });
  assert.deepEqual(mcpOff.recruitment, cliOff.recruitment, 'the off override behaves identically on both surfaces');
});
