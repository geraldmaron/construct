/**
 * tests/functional/oracle-closed-loop.functional.test.mjs —
 *
 * End-to-end: tick writes verdicts, dry-run beads raise, approve executes
 * outcomes-aggregate, re-tick reflects outcomes present.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import { runOracleTick, approvePending } from '../../lib/oracle/actions.mjs';
import { verdictsDir } from '../../lib/oracle/verdicts.mjs';
import { gapFingerprint } from '../../lib/oracle/issues.mjs';
import { routingDir } from '../../lib/oracle/dispatch.mjs';

function freshProject() {
  const projectDir = mkdtempSync(join(tmpdir(), 'construct-oracle-loop-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'construct-oracle-loop-home-'));
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
    assert.ok(['healthy', 'attention', 'degraded'].includes(parsed.latest.verdict));
  } finally {
    delete process.env.CONSTRUCT_ORACLE_AUTO_RAISE;
    env.cleanup();
  }
});

test('gapFingerprint is stable per gap id and day', () => {
  const gap = { id: 'parity-drift' };
  const fp1 = gapFingerprint(gap, new Date('2026-06-18T12:00:00Z'));
  const fp2 = gapFingerprint(gap, new Date('2026-06-18T23:00:00Z'));
  const fp3 = gapFingerprint(gap, new Date('2026-06-19T01:00:00Z'));
  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);
});

test('approve executes outcomes-aggregate and creates outcomes summary', async () => {
  const env = freshProject();
  const prevRolesRoot = process.env.CONSTRUCT_ROLES_ROOT;
  process.env.CONSTRUCT_ROLES_ROOT = join(env.homeDir, '.cx');
  try {
    process.env.CONSTRUCT_ORACLE_AUTO_RAISE = 'off';
    mkdirSync(join(env.projectDir, '.cx', 'oracle'), { recursive: true });
    const action = {
      id: 'oracle-test-outcomes',
      kind: 'outcomes-aggregate',
      summary: 'Run outcomes aggregation',
      classification: 'approve',
      status: 'pending',
    };
    writeFileSync(join(env.projectDir, '.cx', 'oracle', 'pending.jsonl'), JSON.stringify(action) + '\n');
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
    writeFileSync(join(env.projectDir, '.cx', 'contract-violations.jsonl'), JSON.stringify({
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
