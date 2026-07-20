/**
 * tests/functional/cost-vertical-recruitment.functional.test.mjs — the
 * cost/financial participation reference vertical (construct-pteo2.7, cdsp.22).
 *
 * Drives the embedded Procedure contract in an isolated tmpdir with a
 * redirected HOME (zero network). A cost-heavy PRD request must recruit the
 * full cost vertical:
 * data-analyst for quant rigor (skill affinity + cost-quant-review rule on
 * registry/worker-profiles/data-analyst.json) AND product-manager as
 * value-tradeoff reviewer (cost-value-tradeoff-review rule on
 * registry/worker-profiles/product-manager.json), each surfaced with a
 * reason in recruitment.rationale. On prd-draft the product-manager is
 * already the Assignment sequence's primary Worker Profile; on a Procedure
 * without the PM (architecture-review), the participation rule pulls the PM
 * in as reviewer. This is the pattern template the other verticals copy
 * (docs/guides/concepts/participation-verticals.md).
 *
 * @capability workflow.prd-draft
 * @capability workflow.architecture-review
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { invokeProcedure } from '../../lib/embedded-contract/procedure-invoke.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

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

async function invoke(procedureId, input) {
  const cwd = fresh('cx-cost-vert-');
  const home = fresh('cx-cost-vert-home-');
  return invokeProcedure(
    { procedureId, approvalMode: 'proposal-only', input },
    { cwd, env: { ...process.env, HOME: home } },
  );
}

test('cost-heavy PRD Procedure keeps PM primary and recruits data-analyst', async () => {
  const result = await invoke('prd-draft', COST_HEAVY_PRD_REQUEST);

  assert.equal(result.selectedWorkerProfiles[0], 'product-manager', 'PM authors the PRD (Procedure assignment floor)');
  assert.ok(result.selectedWorkerProfiles.includes('data-analyst'), `cost signal recruits data-analyst; got ${result.selectedWorkerProfiles.join(',')}`);

  const analyst = result.recruitment.recruited.find((p) => p.workerProfile === 'data-analyst');
  assert.ok(analyst, 'data-analyst appears in the recruited set');
  assert.equal(analyst.assignmentRole, 'reviewer');
  assert.ok(analyst.dimensions.includes('cost'), 'recruit is attributed to the cost dimension');
  assert.ok(result.recruitment.rationale.some((r) => r.includes('data-analyst') && r.includes('cost')), 'rationale names the recruit and the reason');
});

test('cost signal on a Procedure without the PM recruits product-manager as value-tradeoff reviewer', async () => {
  const result = await invoke('architecture-review', COST_HEAVY_PRD_REQUEST);

  assert.deepEqual(
    result.recruitment.addedWorkerProfiles.slice().sort(),
    ['data-analyst', 'product-manager'],
    'the cost vertical recruits exactly the quant reviewer and the value-tradeoff reviewer',
  );

  const pm = result.recruitment.recruited.find((p) => p.workerProfile === 'product-manager');
  assert.ok(pm, 'product-manager appears in the recruited set');
  assert.equal(pm.assignmentRole, 'reviewer');
  assert.equal(pm.gate, 'advisory');
  assert.equal(pm.via, 'participation-rule');
  assert.equal(pm.rule, 'cost-value-tradeoff-review');
  assert.ok(pm.reason.includes('value-tradeoff'), 'reason names the framework the PM reviews with');

  assert.ok(
    result.recruitment.rationale.some((r) => r.includes('product-manager') && r.includes('value-tradeoff')),
    'rationale surfaces the PM recruit with its framework reason',
  );
  assert.ok(
    result.recruitment.rationale.some((r) => r.includes('data-analyst')),
    'rationale surfaces the quant recruit alongside',
  );
});

test('a request with no cost language recruits neither cost reviewer', async () => {
  const result = await invoke('architecture-review', 'Review the proposed module layout for the notification service refactor');

  const workerProfiles = result.recruitment.recruited.map((p) => p.workerProfile).filter(Boolean);
  assert.equal(workerProfiles.includes('data-analyst'), false, 'no cost signal, no quant recruit');
  assert.equal(workerProfiles.includes('product-manager'), false, 'no cost signal, no value-tradeoff recruit');
});
