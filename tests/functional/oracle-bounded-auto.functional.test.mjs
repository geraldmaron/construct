/**
 * tests/functional/oracle-bounded-auto.functional.test.mjs —
 *
 * Bounded-auto policy, dry-run tick execution, and pending approval queue
 * for the Oracle meta-controller.
 *
 * @capability oracle.meta-review
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAction, AUTO_ACTIONS, APPROVE_ACTIONS } from '../../lib/oracle/policy.mjs';
import { synthesizeVerdict } from '../../lib/oracle/synthesize.mjs';
import { runOracleTick, listPending, approvePending } from '../../lib/oracle/actions.mjs';
import { createDaemon } from '../../lib/daemons/contract.mjs';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-tick-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-tick-home-'));
  mkdirSync(join(projectDir, '.cx'), { recursive: true });
  mkdirSync(join(homeDir, '.cx'), { recursive: true });
  return {
    projectDir,
    homeDir,
    rootDir: process.cwd(),
    cleanup() {
      for (const d of [projectDir, homeDir]) {
        try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ }
      }
    },
  };
}

test('policy classifies auto, approve, and deny actions', () => {
  for (const kind of AUTO_ACTIONS) {
    assert.equal(classifyAction(kind), 'auto');
  }
  for (const kind of APPROVE_ACTIONS) {
    assert.equal(classifyAction(kind), 'approve');
  }
  assert.equal(classifyAction('git-commit'), 'deny');
  assert.equal(classifyAction('unknown-action'), 'approve');
});

test('synthesizeVerdict flags parity drift and missing census', () => {
  const readModel = {
    parity: { ok: false, skipped: false, summary: ['cursor (project): drift — missing: construct-mcp'] },
    contractViolations: { recentCount: 0, recent: [] },
    doctorLog: { recent: [] },
    outcomes: { present: false, roles: {} },
    alignmentCensus: { present: false },
    observations: { present: false, count: 0 },
  };
  const { verdict, gaps, recommendedActions } = synthesizeVerdict(readModel);
  assert.equal(verdict, 'degraded');
  assert.ok(gaps.some((g) => g.id === 'parity-drift'));
  assert.ok(gaps.some((g) => g.id === 'census-stale'));
  assert.ok(recommendedActions.some((a) => a.kind === 'adapters-sync'));
});

test('runOracleTick dry-run executes auto actions without writing pending queue', async () => {
  const env = freshProject();
  try {
    process.env.CONSTRUCT_ORACLE_AUTO_RAISE = 'off';
    const result = await runOracleTick({ ...env, dryRun: true });
    assert.ok(['healthy', 'attention', 'degraded'].includes(result.verdict));
    const hasRegistryAuto = result.tick.executed.some((e) => e.kind === 'registry-validate');
    assert.equal(hasRegistryAuto, result.recommendedActions.some((a) => a.kind === 'registry-validate'));
    const pendingFile = join(env.projectDir, '.cx', 'oracle', 'pending.jsonl');
    assert.equal(existsSync(pendingFile), false);
  } finally {
    delete process.env.CONSTRUCT_ORACLE_AUTO_RAISE;
    env.cleanup();
  }
});

test('runOracleTick queues approve actions to pending.jsonl', async () => {
  const env = freshProject();
  try {
    writeFileSync(join(env.projectDir, '.cx', 'contract-violations.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      contractId: 'test-contract',
      agent: 'cx-engineer',
    }) + '\n');

    const result = await runOracleTick({ ...env, dryRun: false });
    assert.ok(result.tick.queued.length > 0);
    const pending = listPending(env.projectDir);
    assert.ok(pending.length > 0);
    assert.equal(pending[0].status, 'pending');

    const approved = await approvePending(env.projectDir, pending[0].id, { execute: false });
    assert.equal(approved.ok, true);
    const after = listPending(env.projectDir).find((p) => p.id === pending[0].id);
    assert.equal(after.status, 'approved');
  } finally {
    env.cleanup();
  }
});

test('oracle daemon respects CONSTRUCT_ORACLE killswitch', async () => {
  const prev = process.env.CONSTRUCT_ORACLE;
  process.env.CONSTRUCT_ORACLE = 'off';
  try {
    const daemon = createDaemon({
      name: 'oracle-kill-test',
      killswitchEnv: 'CONSTRUCT_ORACLE',
      intervalMs: 10,
      tick: async () => ({ didWork: true }),
    });
    const result = await daemon.run();
    assert.equal(result.reason, 'killswitch');
  } finally {
    if (prev === undefined) delete process.env.CONSTRUCT_ORACLE;
    else process.env.CONSTRUCT_ORACLE = prev;
  }
});
