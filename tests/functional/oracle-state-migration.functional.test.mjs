/**
 * oracle-state-migration.functional.test.mjs — construct-b0nny.17 requirement 6.
 *
 * Spawns the real migrateOracleState against a seeded `.construct/oracle/` tree
 * in an isolated tmpdir and asserts on the durable artifacts it produces: the
 * lossless E5 archive (copied pending/raised-issues/verdicts/routing plus a
 * manifest) and the re-homed observations in the surviving overseer's memory.
 * Also pins the two non-negotiable properties of a point-of-no-return
 * migration: it is non-destructive (the source `.construct/oracle/` survives)
 * and idempotent (a second run records no duplicate observations).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateOracleState } from '../../lib/oracle/migrate-state.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const dirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

test.after(() => {
  for (const d of dirs) { try { rmTmpDir(d); } catch {} }
});

function seedOracleState(projectDir) {
  const oracleDir = path.join(projectDir, '.construct', 'oracle');
  fs.mkdirSync(path.join(oracleDir, 'verdicts'), { recursive: true });
  fs.mkdirSync(path.join(oracleDir, 'routing'), { recursive: true });

  fs.writeFileSync(path.join(oracleDir, 'pending.jsonl'), [
    JSON.stringify({ id: 'oracle-aaa', kind: 'specialist-review', status: 'pending', summary: 'review recent contract violations' }),
    JSON.stringify({ id: 'oracle-bbb', kind: 'doctor-followup', status: 'approved', summary: 'already handled' }),
  ].join('\n') + '\n');

  fs.writeFileSync(path.join(oracleDir, 'pending-archive.jsonl'),
    JSON.stringify({ id: 'oracle-ccc', kind: 'trace-review', status: 'expired', summary: 'aged out' }) + '\n');

  fs.writeFileSync(path.join(oracleDir, 'raised-issues.jsonl'),
    JSON.stringify({ fingerprint: 'gap-1', gapId: 'gap-1', beadId: 'construct-zzz.1', raisedAt: '2026-07-15T00:00:00.000Z' }) + '\n');

  const latest = { at: '2026-07-15T12:00:00.000Z', verdict: 'degraded', gaps: [{ id: 'gap-1', severity: 'high', detail: 'capability without test' }] };
  fs.writeFileSync(path.join(oracleDir, 'verdicts', '2026-07-15.json'),
    JSON.stringify({ date: '2026-07-15', ticks: [latest], latest }, null, 2));

  fs.writeFileSync(path.join(oracleDir, 'routing', 'tick1.md'), '# ORACLE ROUTING — tick1\n\nVERDICT: degraded\n');
  return oracleDir;
}

function withIsolation(t, homeDir) {
  const prevHome = process.env.CX_HOME_OVERRIDE;
  const prevModel = process.env.CONSTRUCT_EMBEDDING_MODEL;
  process.env.CX_HOME_OVERRIDE = homeDir;
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';
  t.after(() => {
    if (prevHome === undefined) delete process.env.CX_HOME_OVERRIDE; else process.env.CX_HOME_OVERRIDE = prevHome;
    if (prevModel === undefined) delete process.env.CONSTRUCT_EMBEDDING_MODEL; else process.env.CONSTRUCT_EMBEDDING_MODEL = prevModel;
  });
}

function readMigrationObservations(projectDir) {
  const dir = path.join(projectDir, '.construct', 'observations');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.json') && n !== 'index.json')
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')))
    .filter((o) => o.source === 'oracle-state-migration');
}

test('migrateOracleState with no oracle state is a clean no-op', async (t) => {
  const projectDir = tmp('cx-oracle-mig-empty-');
  withIsolation(t, tmp('cx-oracle-mig-home-a-'));
  const result = await migrateOracleState({ projectDir, rootDir: projectDir });
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'no-oracle-state');
  assert.equal(result.observationsRecorded, 0);
});

test('migrateOracleState losslessly archives every artifact and re-homes verdict + open pending as observations', async (t) => {
  const projectDir = tmp('cx-oracle-mig-full-');
  const homeDir = tmp('cx-oracle-mig-home-b-');
  withIsolation(t, homeDir);
  const oracleDir = seedOracleState(projectDir);

  const result = await migrateOracleState({ projectDir, rootDir: projectDir });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.counts, { pending: 2, pendingArchive: 1, raisedIssues: 1, verdictFiles: 1, routingFiles: 1 });
  assert.equal(result.observationsRecorded, 2, 'one latest verdict + one still-pending action');

  const archive = result.archiveDir;
  assert.ok(fs.existsSync(path.join(archive, 'manifest.json')), 'manifest written');
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.counts, result.counts);

  for (const rel of ['pending.jsonl', 'pending-archive.jsonl', 'raised-issues.jsonl', 'verdicts/2026-07-15.json', 'routing/tick1.md']) {
    const archived = path.join(archive, rel);
    const original = path.join(oracleDir, rel);
    assert.ok(fs.existsSync(archived), `archived ${rel}`);
    assert.equal(fs.readFileSync(archived, 'utf8'), fs.readFileSync(original, 'utf8'), `byte-identical ${rel}`);
  }

  const obs = readMigrationObservations(projectDir);
  assert.equal(obs.length, 2);
  const verdictObs = obs.find((o) => o.tags.includes('verdict'));
  const pendingObs = obs.find((o) => o.tags.includes('pending'));
  assert.ok(verdictObs, 'verdict observation present');
  assert.equal(verdictObs.category, 'anti-pattern', 'a degraded verdict re-homes as an anti-pattern');
  assert.ok(verdictObs.tags.includes('2026-07-15'));
  assert.ok(pendingObs, 'open-pending observation present');
  assert.equal(pendingObs.category, 'decision');
  assert.ok(pendingObs.tags.includes('oracle-aaa'), 'only the status=pending row is re-homed');
  assert.ok(!obs.some((o) => o.tags.includes('oracle-bbb')), 'the already-approved row is not re-recorded');
});

test('migrateOracleState is non-destructive and idempotent', async (t) => {
  const projectDir = tmp('cx-oracle-mig-idem-');
  withIsolation(t, tmp('cx-oracle-mig-home-c-'));
  const oracleDir = seedOracleState(projectDir);

  const first = await migrateOracleState({ projectDir, rootDir: projectDir });
  assert.equal(first.observationsRecorded, 2);

  assert.ok(fs.existsSync(path.join(oracleDir, 'pending.jsonl')), 'source pending survives (non-destructive)');
  assert.ok(fs.existsSync(path.join(oracleDir, 'verdicts', '2026-07-15.json')), 'source verdict survives');

  const second = await migrateOracleState({ projectDir, rootDir: projectDir });
  assert.equal(second.migrated, true);
  assert.equal(second.observationsRecorded, 0, 'a re-run records no duplicate observations');

  const obs = readMigrationObservations(projectDir);
  assert.equal(obs.length, 2, 'observation count is stable across re-runs');
});

test('migrateOracleState --dry-run reports the plan and writes nothing', async (t) => {
  const projectDir = tmp('cx-oracle-mig-dry-');
  const homeDir = tmp('cx-oracle-mig-home-d-');
  withIsolation(t, homeDir);
  seedOracleState(projectDir);

  const result = await migrateOracleState({ projectDir, rootDir: projectDir, dryRun: true });
  assert.equal(result.migrated, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.observationsRecorded, 2);
  assert.ok(!fs.existsSync(path.join(result.archiveDir, 'manifest.json')), 'dry-run writes no manifest');
  assert.equal(readMigrationObservations(projectDir).length, 0, 'dry-run records no observations');
});
