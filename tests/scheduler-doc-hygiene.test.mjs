/**
 * tests/scheduler-doc-hygiene.test.mjs — doc-hygiene-scan cadence is
 * deployment-mode-aware.
 *
 * Solo deployments scan nightly with limit 25 (single contributor; doc
 * drift accumulates slowly). Team and enterprise scan hourly with limit
 * 50 (multiple writers; the higher cadence and headroom keep the
 * reconcile worker from falling behind).
 *
 * The schedule + mode + limit resolve from the canonical
 * lib/deployment-mode.mjs getDeploymentMode (CONSTRUCT_DEPLOYMENT_MODE env,
 * then project config, then solo) at registration time and at every handler
 * invocation. An unrecognized mode value falls back to solo cadence rather
 * than silently dropping the job.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveDocHygieneSchedule } from '../lib/scheduler/index.mjs';

test('solo deployment: nightly schedule, limit 25', () => {
  const r = resolveDocHygieneSchedule({ CONSTRUCT_DEPLOYMENT_MODE: 'solo' });
  assert.equal(r.schedule, '0 2 * * *', 'solo runs nightly at 02:00');
  assert.equal(r.mode, 'solo');
  assert.equal(r.limit, 25);
});

test('team deployment: hourly schedule, limit 50', () => {
  const r = resolveDocHygieneSchedule({ CONSTRUCT_DEPLOYMENT_MODE: 'team' });
  assert.equal(r.schedule, '0 * * * *', 'team runs at the top of every hour');
  assert.equal(r.mode, 'team');
  assert.equal(r.limit, 50);
});

test('enterprise deployment: same as team (hourly, limit 50)', () => {
  const r = resolveDocHygieneSchedule({ CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' });
  assert.equal(r.schedule, '0 * * * *');
  assert.equal(r.mode, 'team');
  assert.equal(r.limit, 50);
});

test('unknown deployment mode falls back to solo cadence (fail-safe)', () => {
  const r = resolveDocHygieneSchedule({ CONSTRUCT_DEPLOYMENT_MODE: 'something-future' });
  assert.equal(r.schedule, '0 2 * * *', 'unknown mode defaults to solo nightly');
  assert.equal(r.mode, 'solo');
  assert.equal(r.limit, 25);
});

test('empty env falls back to solo cadence', () => {
  const r = resolveDocHygieneSchedule({});
  assert.equal(r.schedule, '0 2 * * *');
  assert.equal(r.mode, 'solo');
  assert.equal(r.limit, 25);
});
