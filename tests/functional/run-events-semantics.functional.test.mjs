/**
 * tests/functional/run-events-semantics.functional.test.mjs — prepared-vs-executed
 * signal on the lifecycle.completed trace event and the SSE `completed` run event
 * (construct-fbxv.7).
 *
 * terminalStatus (AP5.1/construct-fbxv.1) already distinguishes prepare-only,
 * degraded, completed-with-failures, and clean completion, but its precedence
 * order (cancelled > failed > prepare-only > degraded) can collapse a run that
 * is simultaneously e.g. completed-with-failures AND degraded into one string.
 * These tests pin that both emission sites also carry the run-level
 * executionState (LMCP-F4) and an explicit degraded boolean, so a trace/SSE
 * consumer never has to re-read the run store to recover the signal
 * terminalStatus's precedence dropped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runOrchestration } from '../../lib/orchestration/runtime.mjs';
import { onRunEvent } from '../../lib/orchestration/events.mjs';
import { traceDir as resolveTraceDir } from '../../lib/worker/trace.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Trace reads resolve through the machine-scoped state root (ADR-0066) via
// process.env.CX_HOME_OVERRIDE directly, not through the `env` option passed
// to runOrchestration below, so CX_HOME_OVERRIDE is pinned for the whole file
// to keep trace writes off the real developer machine's $HOME.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-run-events-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function tmpProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-run-events-'));
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });
  return cwd;
}

function readTraceCompletedEvents(cwd) {
  const dir = resolveTraceDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const events = [];
  for (const f of fs.readdirSync(dir)) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      if (parsed.eventType === 'lifecycle.completed') events.push(parsed);
    }
  }
  return events;
}

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

test('prepare-only run: lifecycle.completed trace and SSE completed event carry executionState and degraded:false', async () => {
  const cwd = tmpProject();
  try {
    const run = await runOrchestration(
      { request: 'design and implement a new authentication architecture', file_count: 20, module_count: 6, wait: true, worker_backend: 'inline' },
      { cwd, env: preparedEnv() },
    );

    assert.equal(run.status, 'completed-prepare-only');

    const traceEvents = readTraceCompletedEvents(cwd);
    assert.equal(traceEvents.length, 1, 'exactly one lifecycle.completed trace event');
    assert.equal(traceEvents[0].metadata.status, 'completed-prepare-only');
    assert.equal(traceEvents[0].metadata.executionState, 'prepared', 'trace metadata carries the run-level executionState');
    assert.equal(traceEvents[0].metadata.degraded, false, 'trace metadata carries an explicit degraded boolean');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('degraded zero-task run: lifecycle.completed trace event carries degraded:true independent of status string', async () => {
  const cwd = tmpProject();
  try {
    const run = await runOrchestration(
      { request: 'do something simple', file_count: 1, module_count: 1, wait: true, worker_backend: 'inline' },
      { cwd, env: degradedEnv() },
    );

    assert.equal(run.status, 'degraded');
    assert.equal(run.degraded, true);

    const traceEvents = readTraceCompletedEvents(cwd);
    assert.equal(traceEvents.length, 1, 'exactly one lifecycle.completed trace event');
    assert.equal(traceEvents[0].metadata.status, 'degraded');
    assert.equal(traceEvents[0].metadata.degraded, true, 'trace metadata carries the degraded boolean explicitly, not just via the status string');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('SSE completed event carries executionState and degraded fields, subscribed live via planRun + executeRun', async () => {
  const cwd = tmpProject();
  try {
    const { planRun, executeRun } = await import('../../lib/orchestration/runtime.mjs');
    const planned = await planRun(
      { request: 'design and implement a new authentication architecture', file_count: 20, module_count: 6 },
      { cwd, env: preparedEnv() },
    );

    const events = [];
    const off = onRunEvent(planned.runId, (e) => events.push(e));
    const run = await executeRun(cwd, planned.runId, { env: preparedEnv() });
    off();

    assert.equal(run.status, 'completed-prepare-only');
    const completedEvent = events.find((e) => e.type === 'completed');
    assert.ok(completedEvent, 'a completed SSE event was emitted');
    assert.equal(completedEvent.status, 'completed-prepare-only');
    assert.equal(completedEvent.executionState, 'prepared', 'SSE completed event carries the run-level executionState');
    assert.equal(completedEvent.degraded, false, 'SSE completed event carries an explicit degraded boolean');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
