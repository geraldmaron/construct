/**
 * tests/functional/oracle-hygiene-policy.functional.test.mjs —
 *
 * Verdict-only hygiene gaps stay in the read model but never auto-raise beads.
 */

import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { raiseIssuesForGaps } from '../../lib/oracle/issues.mjs';
import { runOracleTick } from '../../lib/oracle/actions.mjs';
import { isVerdictOnlyGap, autoRaiseEnabledForGap } from '../../lib/oracle/policy.mjs';
import { planHygieneReconcile, planContractViolationSupersede } from '../../lib/oracle/reconcile.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-hygiene-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-hygiene-home-'));
  mkdirSync(join(projectDir, '.cx'), { recursive: true });
  mkdirSync(join(homeDir, '.cx'), { recursive: true });
  return {
    projectDir,
    homeDir,
    rootDir: process.cwd(),
    cleanup() {
      for (const d of [projectDir, homeDir]) {
        try { rmTmpDir(d); } catch { /* ignore */ }
      }
    },
  };
}

test('synthesizeVerdict emits beads-hygiene from stuck counts without auto-raise eligibility', () => {
  const readModel = {
    parity: { ok: true, skipped: false },
    contractViolations: { recentCount: 0 },
    doctorLog: { recent: [] },
    outcomes: { present: true, roles: {} },
    alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
    registryValidate: { needsRun: false, warningCount: 0 },
    observations: { present: true, count: 1 },
    orgGraph: {},
    beads: { stuckInProgress: 2, staleOpen: 50 },
    projectDir: '/tmp',
  };
  const { gaps } = synthesizeVerdict(readModel);
  const hygiene = gaps.find((g) => g.id === 'beads-hygiene');
  assert.ok(hygiene);
  assert.equal(isVerdictOnlyGap(hygiene), true);
  assert.equal(autoRaiseEnabledForGap(hygiene), false);
});

test('runOracleTick does not write raised-issues for hygiene-only synthesis', async () => {
  const env = freshProject();
  try {
    const readModel = {
      parity: { ok: true, skipped: false },
      contractViolations: { recentCount: 0 },
      doctorLog: { recent: [] },
      outcomes: { present: true, roles: {} },
      alignmentCensus: { present: true, generatedAt: new Date().toISOString(), stale: false, audit: { regressions: [] }, skills: {} },
      registryValidate: { needsRun: false, warningCount: 0 },
      observations: { present: true, count: 1 },
      orgGraph: { workflow: { present: false, findings: [{ severity: 'HIGH', issue: 'No .cx/workflow.json found' }] } },
      beads: { stuckInProgress: 1, staleOpen: 10 },
      projectDir: env.projectDir,
    };
    const { gaps } = synthesizeVerdict(readModel);
    const raised = await raiseIssuesForGaps({ projectDir: env.projectDir, gaps, dryRun: false });
    assert.ok(raised.every((r) => r.skipped && r.reason === 'verdict-only'));
    assert.equal(existsSync(join(env.projectDir, '.cx', 'oracle', 'raised-issues.jsonl')), false);
  } finally {
    env.cleanup();
  }
});

test('planHygieneReconcile closes all verdict-only hygiene oracle beads', () => {
  const { keep, close } = planHygieneReconcile([
    { id: 'construct-a', gapId: 'beads-hygiene', updatedAt: 100 },
    { id: 'construct-b', gapId: 'beads-hygiene', updatedAt: 200 },
    { id: 'construct-c', gapId: 'workflow-misaligned', updatedAt: 50 },
  ]);
  assert.equal(keep.size, 0);
  assert.deepEqual(close.sort(), ['construct-a', 'construct-b', 'construct-c']);
});

test('planContractViolationSupersede targets homogeneous bare-goal construct violations', async () => {
  const env = freshProject();
  try {
    const { logViolation } = await import('../../lib/contracts/violation-log.mjs');
    logViolation(
      'construct-to-orchestrator',
      'output',
      [
        'artifact missing required field: intent',
        'artifact missing required field: workCategory',
        'artifact missing required field: riskFlags',
        'artifact missing required field: acceptanceCriteria',
      ],
      { goal: 'x' },
      { repoRoot: env.projectDir },
    );
    const plan = planContractViolationSupersede(env.projectDir);
    assert.equal(plan.shouldSupersede, true);
    assert.equal(plan.recentCount, 1);
  } finally {
    env.cleanup();
  }
});

test('runOracleTick with auto-raise on still skips hygiene gaps in beadsRaised', async () => {
  const env = freshProject();
  try {
    process.env.CONSTRUCT_ORACLE_AUTO_RAISE = 'on';
    const result = await runOracleTick({ ...env, dryRun: true });
    const hygieneRaised = (result.beadsRaised ?? []).filter((r) => r.gapId === 'beads-hygiene' || r.gapId === 'workflow-misaligned');
    for (const row of hygieneRaised) {
      assert.equal(row.skipped, true);
      assert.equal(row.reason, 'verdict-only');
    }
  } finally {
    delete process.env.CONSTRUCT_ORACLE_AUTO_RAISE;
    env.cleanup();
  }
});
