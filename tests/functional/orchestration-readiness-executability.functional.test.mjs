/**
 * tests/functional/orchestration-readiness-executability.functional.test.mjs
 *
 * Locks in that buildOrchestrationReadiness (lib/orchestration/readiness.mjs)
 * invokes the same resolution orchestration_run uses
 * (resolveExecution/resolveEmbeddedModel, resolveWorkerBackend, the web
 * grant ladder) against the same env, so a verdict of "attached" never
 * precedes a run that degrades with "No model could be resolved". The
 * resulting verdict must predict planRun's degraded/prepare-only outcome on
 * that same env — no network calls, env/config-local only.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildOrchestrationReadiness } from '../../lib/orchestration/readiness.mjs';
import { planRun } from '../../lib/orchestration/runtime.mjs';

const dirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-readiness-exec-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} } });

const ATTACHED_INPUT = { observedTools: ['orchestration_policy', 'orchestration_run'] };

test('no model resolvable on this env: readiness is non-PASS with a model reason code and an actionable next step', () => {
  const cwd = freshCwd();
  const env = {};
  const readiness = buildOrchestrationReadiness(ATTACHED_INPUT, { env, cwd });
  assert.notEqual(readiness.verdict, 'pass');
  assert.ok(['model_unresolved', 'execution_degraded'].includes(readiness.reasonCode));
  assert.ok(readiness.nextStep && readiness.nextStep.length > 0);
  assert.deepEqual(readiness.modelResolved, { reasoning: false, standard: false, fast: false });
});

test('a fully resolvable env: verdict PASS and includes workerBackend and web mode fields', () => {
  const cwd = freshCwd();
  const env = {
    CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
    ANTHROPIC_API_KEY: 'sk-test-canary',
  };
  const readiness = buildOrchestrationReadiness(ATTACHED_INPUT, { env, cwd });
  assert.equal(readiness.verdict, 'pass');
  assert.equal(readiness.reasonCode, 'attached');
  assert.equal(readiness.workerBackend, 'inline');
  assert.ok(readiness.webMode);
  assert.deepEqual(readiness.modelResolved, { reasoning: true, standard: true, fast: true });
});

test('parity: the readiness verdict on env E predicts whether planRun on env E degrades', async () => {
  const cwd = freshCwd();
  const env = {};
  const readiness = buildOrchestrationReadiness(ATTACHED_INPUT, { env, cwd });
  const run = await planRun({ request: 'x', requestedStrategy: 'orchestrated' }, { env, cwd });
  assert.equal(run.execution.degraded, true);
  assert.equal(readiness.reasonCode !== 'attached', run.execution.degraded);
});

test('parity holds on a fully resolvable env too (non-degraded control)', async () => {
  const cwd = freshCwd();
  const env = {
    CX_MODEL_REASONING: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_STANDARD: 'anthropic/claude-sonnet-4-6',
    CX_MODEL_FAST: 'anthropic/claude-sonnet-4-6',
    ANTHROPIC_API_KEY: 'sk-test-canary',
  };
  const readiness = buildOrchestrationReadiness(ATTACHED_INPUT, { env, cwd });
  const run = await planRun({ request: 'x', requestedStrategy: 'orchestrated' }, { env, cwd });
  assert.equal(run.execution.degraded, false);
  assert.equal(readiness.reasonCode !== 'attached', run.execution.degraded);
});
