/**
 * tests/functional/outcome-routing.functional.test.mjs — ADR-0076 end-to-end.
 *
 * Closes the loop tests/recruiter.test.mjs exercises at the unit level: a
 * real spawned lib/hooks/agent-tracker.mjs process (not an in-process import)
 * recording Task outcomes, refreshing .construct/outcomes/_summary.json, and
 * that summary then demoting/recovering a specialist's pick order through the
 * real recruit(). Complements tests/functional/a3-outcomes.functional.test.mjs,
 * which pins the capture -> aggregate -> classifier-never-inverts loop; this
 * file pins capture -> aggregate -> recruiter tie-break.
 *
 * The summary refresh inside agent-tracker debounces (OUTCOME_SUMMARY_STALE_MS)
 * to avoid a full rebuild on every single dispatch; recordOutcome itself never
 * debounces, so a burst of rapid dispatches is always durably captured even
 * when several of the summary refreshes inside that burst get skipped. Each
 * phase below fires its burst, waits past the debounce window, then fires one
 * settle dispatch — whose refresh always rebuilds from the complete JSONL
 * history, picking up everything the burst recorded.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

import { recruit } from '../../lib/orchestration/recruiter.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const TRACKER = path.join(REPO, 'lib', 'hooks', 'agent-tracker.mjs');
const DEBOUNCE_SETTLE_MS = 2_200; // just past agent-tracker's 2s summary-refresh debounce

const TIED_REGISTRY = {
  specialists: {
    'data-analyst': { skills: ['cost-optimization'], team: null },
    'cx-finance-ops': { skills: ['pricing-positioning'], team: null },
  },
};

function dispatchTask(cwd, fakeHome, { agent, description, resultText }) {
  const payload = {
    tool_name: 'Task',
    tool_input: { subagent_type: agent, description },
    tool_result: { result: resultText },
    cwd,
  };
  const result = spawnSync('node', [TRACKER], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  assert.equal(result.status, 0, `agent-tracker exited non-zero: ${result.stderr}`);
}

const FAIL = { resultText: 'Task failed: exception thrown while processing. ❌' };
const SUCCESS = { resultText: 'Done. Completed successfully. ✅' };

test('real agent-tracker dispatches demote a losing specialist through the recruiter, then recover it', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-routing-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-routing-home-'));
  fs.mkdirSync(path.join(cwd, '.construct'), { recursive: true });

  const baseline = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
  assert.deepEqual(
    baseline.map((p) => p.specialist),
    ['data-analyst'],
    'with no outcome history yet, the alphabetical tie-break picks data-analyst',
  );

  // Phase 1 — demotion: data-analyst fails every dispatch, cx-finance-ops succeeds every one.
  for (let i = 0; i < 4; i++) {
    dispatchTask(cwd, fakeHome, { agent: 'data-analyst', description: `analyze cost report attempt ${i}`, ...FAIL });
    dispatchTask(cwd, fakeHome, { agent: 'cx-finance-ops', description: `reconcile pricing model attempt ${i}`, ...SUCCESS });
  }
  await sleep(DEBOUNCE_SETTLE_MS);
  dispatchTask(cwd, fakeHome, { agent: 'cx-finance-ops', description: 'reconcile pricing model settle', ...SUCCESS });

  const summaryPath = path.join(cwd, '.construct', 'outcomes', '_summary.json');
  assert.ok(fs.existsSync(summaryPath), 'agent-tracker never refreshed .construct/outcomes/_summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.roles['data-analyst']?.last30?.successRate, 0, 'data-analyst outcomes recorded as all failures');
  assert.equal(summary.roles['finance-ops']?.last30?.successRate, 1, 'finance-ops outcomes recorded as all successes');

  const afterDemotion = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
  assert.deepEqual(
    afterDemotion.map((p) => p.specialist),
    ['cx-finance-ops'],
    'recruit() must pick cx-finance-ops once real dispatches demote data-analyst',
  );

  // Phase 2 — recovery: outcomeBoost reads the cumulative last-30-day window, not a fixed-size
  // recent buffer, so data-analyst succeeding from here on can approach but never overtake a
  // rival still sitting at a perfect record. Demonstrate the ranking is freshly recomputed every
  // call (never sticky) by having data-analyst trend upward while cx-finance-ops trends down —
  // the same dynamic a real specialist's fortunes reversing over time would produce. After this
  // burst, data-analyst sits at 7/11 success and finance-ops at 5/11 — a clear, unambiguous flip.
  for (let i = 0; i < 6; i++) {
    dispatchTask(cwd, fakeHome, { agent: 'data-analyst', description: `analyze cost report recovery ${i}`, ...SUCCESS });
    dispatchTask(cwd, fakeHome, { agent: 'cx-finance-ops', description: `reconcile pricing model regression ${i}`, ...FAIL });
  }
  await sleep(DEBOUNCE_SETTLE_MS);
  dispatchTask(cwd, fakeHome, { agent: 'data-analyst', description: 'analyze cost report settle', ...SUCCESS });

  const afterRecovery = recruit({ signals: { cost: true }, kind: 'review', registry: TIED_REGISTRY, cwd });
  assert.deepEqual(
    afterRecovery.map((p) => p.specialist),
    ['data-analyst'],
    'recruit() must flip back to data-analyst once fresh outcomes reverse the relative success rates',
  );

  rmTmpDir(cwd);
  rmTmpDir(fakeHome);
});
