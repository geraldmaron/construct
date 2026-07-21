/**
 * tests/workers-unavailable-ux.test.mjs — first-run messaging when DATABASE_URL
 * is unset for `construct workers`.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatWorkersUnavailableGuidance } from '../lib/orchestration/worker-runtime.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(REPO, 'bin', 'construct');

test('formatWorkersUnavailableGuidance explains solo vs shared', () => {
  const text = formatWorkersUnavailableGuidance();
  assert.match(text, /DATABASE_URL|CONSTRUCT_DATABASE_URL/);
  assert.match(text, /Solo/);
  assert.match(text, /Team\/shared/);
  assert.match(text, /construct db migrate/);
});

test('construct workers list without DATABASE_URL prints first-run guidance', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.CONSTRUCT_DATABASE_URL;

  const result = spawnSync(process.execPath, [BIN, 'workers', 'list'], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Workers registry unavailable/);
  assert.match(result.stdout, /optional/i);
  assert.match(result.stdout, /DATABASE_URL/);
  assert.match(result.stdout, /construct db migrate/);
});

test('construct workers list --json without DATABASE_URL includes nextSteps', () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.CONSTRUCT_DATABASE_URL;

  const result = spawnSync(process.execPath, [BIN, 'workers', 'list', '--json'], {
    cwd: REPO,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'unavailable');
  assert.equal(payload.reason, 'postgres-unavailable');
  assert.equal(payload.optionalForSolo, true);
  assert.ok(Array.isArray(payload.nextSteps) && payload.nextSteps.length >= 2);
  assert.match(payload.guidance, /Solo/);
});
