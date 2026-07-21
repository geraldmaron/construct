/**
 * tests/functional/doctor-run-store-visibility.functional.test.mjs — the
 * doctor run-health watcher actually reads the run store (construct-fbxv.6).
 *
 * lib/orchestration/runtime.mjs's error-path comment claims persisted error
 * runs surface "to doctor and orchestration_status", but nothing under
 * lib/doctor/ read the run store back out. This pins that
 * lib/doctor/watchers/orchestration-runs.mjs's tick() scans getRuns() and
 * records a finding to the doctor audit log when a run carries an error or
 * degraded terminal status, and stays silent when every recent run is clean.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tempDir } from '../helpers.mjs';
import { runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

// runOrchestration resolves its run store through the machine-scoped state
// root (ADR-0066), which reads CONSTRUCT_HOME_OVERRIDE/CONSTRUCT_TOOLKIT_DIR from real
// process.env directly — the HOME/CONSTRUCT_TOOLKIT_DIR keys below only reach the
// `env` option bag runOrchestration threads to model resolution, never
// process.env, so they never isolated state-root writes. Pin the real vars
// for the whole file instead.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-doctor-runstore-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { rmTmpDir(homeOverride); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function degradedEnv() {
  return {
    ...process.env,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CONSTRUCT_MODEL_REASONING: '',
    CONSTRUCT_MODEL_STANDARD: '',
    CONSTRUCT_MODEL_FAST: '',
  };
}

function preparedEnv() {
  return {
    ...process.env,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CONSTRUCT_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
    CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
    CONSTRUCT_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
  };
}

test('orchestration-runs watcher records a finding when a recent run is degraded', async (t) => {
  const projectRoot = tempDir('cx-doctor-runs-project-', t);
  fs.mkdirSync(path.join(projectRoot, '.construct'), { recursive: true });
  const doctorRoot = tempDir('cx-doctor-runs-audit-', t);

  const degradedRun = await runOrchestration(
    { request: 'do something simple', file_count: 1, module_count: 1, wait: true, worker_backend: 'inline' },
    { cwd: projectRoot, env: degradedEnv() },
  );
  assert.equal(degradedRun.status, 'degraded', 'fixture run must actually be degraded');

  const prevProjectRoot = process.env.CONSTRUCT_PROJECT_ROOT;
  const prevDoctorRoot = process.env.CONSTRUCT_DOCTOR_ROOT;
  process.env.CONSTRUCT_PROJECT_ROOT = projectRoot;
  process.env.CONSTRUCT_DOCTOR_ROOT = doctorRoot;
  t.after(() => {
    if (prevProjectRoot === undefined) delete process.env.CONSTRUCT_PROJECT_ROOT; else process.env.CONSTRUCT_PROJECT_ROOT = prevProjectRoot;
    if (prevDoctorRoot === undefined) delete process.env.CONSTRUCT_DOCTOR_ROOT; else process.env.CONSTRUCT_DOCTOR_ROOT = prevDoctorRoot;
  });

  const watcher = await import('../../lib/doctor/watchers/orchestration-runs.mjs');
  const audit = await import('../../lib/doctor/audit.mjs');

  const result = await watcher.tick();
  assert.ok(Array.isArray(result.actions));
  assert.ok(Array.isArray(result.escalations));

  const entries = audit.recent({ watcher: 'orchestration-runs' });
  assert.equal(entries.length, 1, 'exactly one finding recorded for the degraded run');
  assert.equal(entries[0].kind, 'finding');
  assert.equal(entries[0].context.newestRunId, degradedRun.runId);
  assert.equal(entries[0].context.newestStatus, 'degraded');
  assert.ok(entries[0].context.affectedRunIds.includes(degradedRun.runId));
});

test('orchestration-runs watcher stays silent when every recent run is clean', async (t) => {
  const projectRoot = tempDir('cx-doctor-runs-clean-project-', t);
  fs.mkdirSync(path.join(projectRoot, '.construct'), { recursive: true });
  const doctorRoot = tempDir('cx-doctor-runs-clean-audit-', t);

  const cleanRun = await runOrchestration(
    { request: 'design and implement a new authentication architecture', file_count: 20, module_count: 6, wait: true, worker_backend: 'inline' },
    { cwd: projectRoot, env: preparedEnv() },
  );
  assert.ok(
    !['error', 'degraded', 'completed-with-failures'].includes(cleanRun.status) && cleanRun.degraded !== true,
    `fixture run must be clean, got status=${cleanRun.status} degraded=${cleanRun.degraded}`,
  );

  const prevProjectRoot = process.env.CONSTRUCT_PROJECT_ROOT;
  const prevDoctorRoot = process.env.CONSTRUCT_DOCTOR_ROOT;
  process.env.CONSTRUCT_PROJECT_ROOT = projectRoot;
  process.env.CONSTRUCT_DOCTOR_ROOT = doctorRoot;
  t.after(() => {
    if (prevProjectRoot === undefined) delete process.env.CONSTRUCT_PROJECT_ROOT; else process.env.CONSTRUCT_PROJECT_ROOT = prevProjectRoot;
    if (prevDoctorRoot === undefined) delete process.env.CONSTRUCT_DOCTOR_ROOT; else process.env.CONSTRUCT_DOCTOR_ROOT = prevDoctorRoot;
  });

  const watcher = await import('../../lib/doctor/watchers/orchestration-runs.mjs');
  const audit = await import('../../lib/doctor/audit.mjs');

  await watcher.tick();
  const entries = audit.recent({ watcher: 'orchestration-runs' });
  assert.equal(entries.length, 0, 'a clean run produces no finding');
});
