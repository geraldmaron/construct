/**
 * tests/functional/oracle-closed-loop.functional.test.mjs —
 *
 * End-to-end: tick writes verdicts, dry-run beads raise, approve executes
 * outcomes-aggregate, re-tick reflects outcomes present.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { runOracleTick, approvePending } from '../../lib/oracle/actions.mjs';
import { verdictsDir } from '../../lib/oracle/verdicts.mjs';
import { VERDICT_STATES } from '../../lib/oracle/synthesize.mjs';
import { gapFingerprint } from '../../lib/oracle/issues.mjs';
import { routingDir } from '../../lib/oracle/dispatch.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-loop-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-loop-home-'));
  mkdirSync(join(projectDir, '.construct'), { recursive: true });
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

test('runOracleTick writes verdict history under .cx/oracle/verdicts/', async () => {
  const env = freshProject();
  try {
    process.env.CONSTRUCT_ORACLE_AUTO_RAISE = 'off';
    await runOracleTick({ ...env, dryRun: false });
    const dir = verdictsDir(env.projectDir);
    assert.equal(existsSync(dir), true);
    const files = readFileSync(join(dir, `${new Date().toISOString().slice(0, 10)}.json`), 'utf8');
    const parsed = JSON.parse(files);
    assert.ok(parsed.latest);
    assert.ok(VERDICT_STATES.includes(parsed.latest.verdict));
  } finally {
    delete process.env.CONSTRUCT_ORACLE_AUTO_RAISE;
    env.cleanup();
  }
});

test('gapFingerprint is stable per gap id across calendar days', () => {
  const gap = { id: 'parity-drift' };
  assert.equal(gapFingerprint(gap), 'parity-drift');
  assert.equal(gapFingerprint({ id: 'parity-drift' }), gapFingerprint(gap));
});

test('raiseIssuesForGaps skips verdict-only hygiene gaps without bd create', async () => {
  const env = freshProject();
  try {
    const { raiseIssuesForGaps } = await import('../../lib/oracle/issues.mjs');
    const gaps = [
      { id: 'beads-hygiene', severity: 'high', detail: '2 stuck in_progress, 50 stale-open' },
      { id: 'workflow-misaligned', severity: 'high', detail: 'No .cx/workflow.json found' },
    ];
    const raised = await raiseIssuesForGaps({ projectDir: env.projectDir, gaps, dryRun: false });
    assert.equal(raised.length, 2);
    for (const row of raised) {
      assert.equal(row.skipped, true);
      assert.equal(row.reason, 'verdict-only');
    }
    const raisedFile = join(env.projectDir, '.construct', 'oracle', 'raised-issues.jsonl');
    assert.equal(existsSync(raisedFile), false);
  } finally {
    env.cleanup();
  }
});

test('raiseIssuesForGaps persistent dedup skips when raised-issues record exists', async () => {
  const env = freshProject();
  try {
    const { raiseIssuesForGaps } = await import('../../lib/oracle/issues.mjs');
    mkdirSync(join(env.projectDir, '.construct', 'oracle'), { recursive: true });
    writeFileSync(
      join(env.projectDir, '.construct', 'oracle', 'raised-issues.jsonl'),
      JSON.stringify({ fingerprint: 'dead-code-regression', gapId: 'dead-code-regression', beadId: 'construct-test' }) + '\n',
    );
    const gaps = [{ id: 'dead-code-regression', severity: 'high', detail: '1 new dead module' }];
    const raised = await raiseIssuesForGaps({ projectDir: env.projectDir, gaps, dryRun: false });
    assert.equal(raised[0].skipped, true);
    assert.equal(raised[0].reason, 'already-raised');
  } finally {
    env.cleanup();
  }
});

test('approve executes outcomes-aggregate and creates outcomes summary', async () => {
  const env = freshProject();
  const prevRolesRoot = process.env.CONSTRUCT_ROLES_ROOT;
  process.env.CONSTRUCT_ROLES_ROOT = join(env.homeDir, '.cx');
  try {
    process.env.CONSTRUCT_ORACLE_AUTO_RAISE = 'off';
    mkdirSync(join(env.projectDir, '.construct', 'oracle'), { recursive: true });
    const action = {
      id: 'oracle-test-outcomes',
      kind: 'outcomes-aggregate',
      summary: 'Run outcomes aggregation',
      classification: 'approve',
      status: 'pending',
    };
    writeFileSync(join(env.projectDir, '.construct', 'oracle', 'pending.jsonl'), JSON.stringify(action) + '\n');
    const result = await approvePending(env.projectDir, action.id, { execute: true, ...env });
    assert.equal(result.ok, true);
    assert.ok(result.action.executedAt);
    assert.equal(result.executionResult?.ok, true);
  } finally {
    delete process.env.CONSTRUCT_ORACLE_AUTO_RAISE;
    if (prevRolesRoot === undefined) delete process.env.CONSTRUCT_ROLES_ROOT;
    else process.env.CONSTRUCT_ROLES_ROOT = prevRolesRoot;
    env.cleanup();
  }
});

test('high-severity tick writes routing artifact when gaps present', async () => {
  const env = freshProject();
  try {
    process.env.CONSTRUCT_ORACLE_AUTO_RAISE = 'off';
    writeFileSync(join(env.projectDir, '.construct', 'contract-violations.jsonl'), JSON.stringify({
      ts: new Date().toISOString(),
      contractId: 'test',
      agent: 'cx-engineer',
    }) + '\n');
    await runOracleTick({ ...env, dryRun: false });
    const dir = routingDir(env.projectDir);
    assert.equal(existsSync(dir), true);
    const artifacts = readdirSync(dir).filter((f) => f.endsWith('.md'));
    assert.ok(artifacts.length > 0);
  } finally {
    delete process.env.CONSTRUCT_ORACLE_AUTO_RAISE;
    env.cleanup();
  }
});
