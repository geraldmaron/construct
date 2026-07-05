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
import { fileURLToPath } from 'node:url';

import { tempDir } from '../helpers.mjs';
import { runOrchestration } from '../../lib/orchestration/runtime.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function degradedEnv() {
  return {
    ...process.env,
    CX_TOOLKIT_DIR: REPO_ROOT,
    HOME: REPO_ROOT,
    USERPROFILE: REPO_ROOT,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CX_MODEL_REASONING: '',
    CX_MODEL_STANDARD: '',
    CX_MODEL_FAST: '',
  };
}

function preparedEnv() {
  return {
    ...process.env,
    CX_TOOLKIT_DIR: REPO_ROOT,
    HOME: REPO_ROOT,
    USERPROFILE: REPO_ROOT,
    OPENROUTER_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
  };
}

test('orchestration-runs watcher records a finding when a recent run is degraded', async (t) => {
  const projectRoot = tempDir('cx-doctor-runs-project-', t);
  fs.mkdirSync(path.join(projectRoot, '.cx'), { recursive: true });
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
  fs.mkdirSync(path.join(projectRoot, '.cx'), { recursive: true });
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
