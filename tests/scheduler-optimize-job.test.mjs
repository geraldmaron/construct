/**
 * tests/scheduler-optimize-job.test.mjs — scheduled optimize loop is gated.
 *
 * Bead construct-wvbf.9 puts the prompt-optimize loop on a cadence. The safety
 * property is that a scheduled run never auto-applies: these pin that the job is
 * registered and that its argv carries no --apply, so the schedule can only
 * propose patches, never write them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { listJobs, optimizeJobArgv, OPTIMIZE_JOB_ID } from '../lib/scheduler/index.mjs';

test('the optimize loop is registered as a scheduled job', () => {
  const job = listJobs().find((j) => j.id === OPTIMIZE_JOB_ID);
  assert.ok(job, 'optimize-loop job is registered');
  assert.ok(job.schedule && job.schedule.length > 0, 'job has a schedule');
});

test('the scheduled optimize argv never auto-applies', () => {
  assert.equal(optimizeJobArgv().includes('--apply'), false);
});
