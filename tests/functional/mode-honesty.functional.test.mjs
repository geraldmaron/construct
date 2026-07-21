/**
 * tests/functional/mode-honesty.functional.test.mjs — LMCP-G8.
 *
 * Verifies that team/enterprise mode cannot silently fall back to solo
 * behavior when a required subsystem is unavailable.
 *
 * Scenarios:
 *   1. requireTeamCapabilityOrDegrade throws DeploymentModeError in team
 *      mode when CONSTRUCT_DEGRADED_OK is not set.
 *   2. requireTeamCapabilityOrDegrade succeeds (does not throw) when
 *      CONSTRUCT_DEGRADED_OK includes the subsystem, and writes a
 *      degradation record to .construct/degradation.jsonl.
 *   3. createIntakeQueue throws in team mode without CONSTRUCT_DEGRADED_OK.
 *   4. createIntakeQueue succeeds in team mode with CONSTRUCT_DEGRADED_OK
 *      set and returns a GitIntakeQueue (degraded git-backed queue).
 *   5. requireTeamCapabilityOrDegrade is a no-op in solo mode even when
 *      the subsystem is unavailable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { requireTeamCapabilityOrDegrade, DeploymentModeError } from '../../lib/deployment-mode.mjs';
import { createIntakeQueue, GitIntakeQueue } from '../../lib/intake/queue.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const tmpDirs = [];
function makeTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mode-honesty-'));
  tmpDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

// ─── 1. Team mode throws without CONSTRUCT_DEGRADED_OK ────────────────────────

test('requireTeamCapabilityOrDegrade throws DeploymentModeError in team mode without CONSTRUCT_DEGRADED_OK', () => {
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team' };
  assert.throws(
    () => requireTeamCapabilityOrDegrade('postgres-queue', false, env),
    (err) => {
      assert.ok(err instanceof DeploymentModeError, `Expected DeploymentModeError, got ${err.constructor.name}`);
      assert.ok(
        err.message.includes('postgres-queue'),
        `Expected message to mention subsystem; got: ${err.message}`,
      );
      assert.ok(
        err.message.includes('CONSTRUCT_DEGRADED_OK'),
        `Expected message to mention CONSTRUCT_DEGRADED_OK; got: ${err.message}`,
      );
      return true;
    },
  );
});

test('requireTeamCapabilityOrDegrade throws DeploymentModeError in enterprise mode without CONSTRUCT_DEGRADED_OK', () => {
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' };
  assert.throws(
    () => requireTeamCapabilityOrDegrade('brokered-mcp', false, env),
    (err) => err instanceof DeploymentModeError,
  );
});

// ─── 2. Succeeds with CONSTRUCT_DEGRADED_OK and writes degradation record ─────

test('requireTeamCapabilityOrDegrade succeeds with CONSTRUCT_DEGRADED_OK and writes degradation.jsonl', () => {
  const cwd = makeTmp();
  const env = {
    CONSTRUCT_DEPLOYMENT_MODE: 'team',
    CONSTRUCT_DEGRADED_OK: 'postgres-queue',
  };

  // Must not throw
  assert.doesNotThrow(() => requireTeamCapabilityOrDegrade('postgres-queue', false, env, { cwd }));

  // Degradation record must be written
  const degradationPath = path.join(cwd, '.construct', 'degradation.jsonl');
  assert.ok(fs.existsSync(degradationPath), 'degradation.jsonl must exist after degraded operation');

  const lines = fs.readFileSync(degradationPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'At least one degradation record must be written');

  const record = JSON.parse(lines[0]);
  assert.equal(record.mode, 'team');
  assert.equal(record.subsystem, 'postgres-queue');
  assert.equal(record.degradedOk, true);
  assert.ok(typeof record.ts === 'string', 'degradation record must have a timestamp');
});

test('requireTeamCapabilityOrDegrade handles comma-separated CONSTRUCT_DEGRADED_OK list', () => {
  const env = {
    CONSTRUCT_DEPLOYMENT_MODE: 'team',
    CONSTRUCT_DEGRADED_OK: 'shared-memory,postgres-queue,central-telemetry',
  };
  assert.doesNotThrow(() => requireTeamCapabilityOrDegrade('postgres-queue', false, env));
  assert.doesNotThrow(() => requireTeamCapabilityOrDegrade('shared-memory', false, env));
});

// ─── 3. createIntakeQueue: team mode requires postgres unless degraded ───────

test('createIntakeQueue throws in team mode without DATABASE_URL or degraded override', () => {
  const rootDir = makeTmp();
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team' };
  assert.throws(() => createIntakeQueue(rootDir, env), DeploymentModeError);
});

test('createIntakeQueue returns visibly degraded GitIntakeQueue in team mode with degraded override', () => {
  const rootDir = makeTmp();
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team', CONSTRUCT_DEGRADED_OK: 'postgres-queue' };
  const queue = createIntakeQueue(rootDir, env);
  assert.ok(queue instanceof GitIntakeQueue, `Expected GitIntakeQueue, got ${queue?.constructor?.name}`);
  assert.equal(queue.degraded, true);
  assert.equal(queue.degradedReason, 'postgres-unavailable');
  assert.equal(queue.requestedBackend, 'postgres');
});

// ─── 5. Solo mode is always a no-op ──────────────────────────────────────────

test('requireTeamCapabilityOrDegrade is a no-op in solo mode even when subsystem is unavailable', () => {
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'solo' };
  assert.doesNotThrow(() => requireTeamCapabilityOrDegrade('postgres-queue', false, env));
});

test('requireTeamCapabilityOrDegrade is a no-op when isAvailable is true', () => {
  const env = { CONSTRUCT_DEPLOYMENT_MODE: 'team' };
  assert.doesNotThrow(() => requireTeamCapabilityOrDegrade('postgres-queue', true, env));
});
