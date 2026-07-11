/**
 * tests/functional/cost-vertical-recruitment.functional.test.mjs — the
 * cost/financial participation reference vertical (construct-pteo2.7, cdsp.22).
 *
 * Drives `construct workflow invoke --json` against the real binary in an
 * isolated tmpdir with a redirected HOME and CONSTRUCT_ROLES=off (zero
 * network). A cost-heavy PRD request must recruit the full cost vertical:
 * cx-data-analyst for quant rigor (skill affinity + cost-quant-review rule on
 * specialists/org/specialists/cx-data-analyst.json) AND cx-product-manager as
 * value-tradeoff reviewer (cost-value-tradeoff-review rule on
 * specialists/org/specialists/cx-product-manager.json), each surfaced with a
 * reason in recruitment.rationale. On prd-draft the product-manager is
 * already the chain's primary owner, so the cx-pm-value-tradeoff framework
 * (ADR-0062 appliesToRole binding) equips the plan directly; on a chain
 * without the PM (architecture-review) the participation rule pulls the PM on
 * as reviewer. This is the pattern template the other verticals copy
 * (docs/guides/concepts/participation-verticals.md).
 *
 * @capability workflow.prd-draft
 * @capability workflow.architecture-review
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const COST_HEAVY_PRD_REQUEST =
  'PRD for usage-based billing pricing: per-request cost budget, monthly spend caps, and ROI targets for the finance dashboard';

const tmpDirs = [];
function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

function invoke(args) {
  const cwd = fresh('cx-cost-vert-');
  const home = fresh('cx-cost-vert-home-');
  const res = spawnSync('node', [BIN, 'workflow', 'invoke', '--json', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off' },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('cost-heavy PRD draft recruits cx-data-analyst and binds the PM value-tradeoff framework', () => {
  const env = invoke([
    '--workflow-type', 'prd-draft', '--approval-mode', 'proposal-only',
    '--text', COST_HEAVY_PRD_REQUEST,
  ]);

  assert.equal(env.data.selectedRoles[0], 'product-manager', 'PM authors the PRD (manifest chain floor)');
  assert.ok(env.data.selectedRoles.includes('data-analyst'), `cost signal recruits data-analyst; got ${env.data.selectedRoles.join(',')}`);

  const analyst = env.data.recruitment.recruited.find((p) => p.specialist === 'cx-data-analyst');
  assert.ok(analyst, 'cx-data-analyst appears in the recruited set');
  assert.equal(analyst.role, 'reviewer');
  assert.ok(analyst.dimensions.includes('cost'), 'recruit is attributed to the cost dimension');
  assert.ok(env.data.recruitment.rationale.some((r) => r.includes('cx-data-analyst') && r.includes('cost')), 'rationale names the recruit and the reason');

  assert.equal(env.data.framework.available, true, 'primary role carries a bound framework');
  assert.equal(env.data.framework.frameworkId, 'cx-pm-value-tradeoff', 'PM value-tradeoff framework equips the plan');
  assert.ok(env.data.framework.requiredOutputFields.includes('tradeoff-table'), 'framework contract demands the tradeoff table');
  assert.equal(env.data.trace.frameworkId, 'cx-pm-value-tradeoff', 'trace provenance records the governing framework');
});

test('cost signal on a chain without the PM recruits cx-product-manager as value-tradeoff reviewer', () => {
  const env = invoke([
    '--workflow-type', 'architecture-review', '--approval-mode', 'proposal-only',
    '--text', COST_HEAVY_PRD_REQUEST,
  ]);

  assert.deepEqual(
    env.data.recruitment.addedRoles.slice().sort(),
    ['data-analyst', 'product-manager'],
    'the cost vertical recruits exactly the quant reviewer and the value-tradeoff reviewer',
  );

  const pm = env.data.recruitment.recruited.find((p) => p.specialist === 'cx-product-manager');
  assert.ok(pm, 'cx-product-manager appears in the recruited set');
  assert.equal(pm.role, 'reviewer');
  assert.equal(pm.gate, 'advisory');
  assert.equal(pm.via, 'participation-rule');
  assert.equal(pm.rule, 'cost-value-tradeoff-review');
  assert.ok(pm.reason.includes('value-tradeoff'), 'reason names the framework the PM reviews with');

  assert.ok(
    env.data.recruitment.rationale.some((r) => r.includes('cx-product-manager') && r.includes('value-tradeoff')),
    'rationale surfaces the PM recruit with its framework reason',
  );
  assert.ok(
    env.data.recruitment.rationale.some((r) => r.includes('cx-data-analyst')),
    'rationale surfaces the quant recruit alongside',
  );
});

test('a request with no cost language recruits neither cost reviewer', () => {
  const env = invoke([
    '--workflow-type', 'architecture-review', '--approval-mode', 'proposal-only',
    '--text', 'Review the proposed module layout for the notification service refactor',
  ]);

  const specialists = env.data.recruitment.recruited.map((p) => p.specialist).filter(Boolean);
  assert.equal(specialists.includes('cx-data-analyst'), false, 'no cost signal, no quant recruit');
  assert.equal(specialists.includes('cx-product-manager'), false, 'no cost signal, no value-tradeoff recruit');
});
