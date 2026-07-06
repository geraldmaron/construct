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

// planRun resolves the run store through the machine-scoped state root
// (ADR-0066), which reads CX_HOME_OVERRIDE from real process.env directly.
// Pin it for the whole file so these runs never write into the real
// developer machine's ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-readiness-exec-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

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

// construct-neq9.2/.3: the third fixture cell — a provider key present, no
// CX_MODEL_REASONING/STANDARD/FAST pin — is the exact incident machine state
// (run-02158a157d53). resolveEmbeddedModel resolves it via
// credential-family-fallback, so it must land in the same non-degraded bucket
// as the fully-pinned env, not the no-keys-no-tiers bucket above.

test('parity holds on a keys-present-no-tiers env: credential-family-fallback resolves, readiness stays PASS', async () => {
  const cwd = freshCwd();
  const env = { ANTHROPIC_API_KEY: 'sk-test-canary' };
  const readiness = buildOrchestrationReadiness(ATTACHED_INPUT, { env, cwd });
  const run = await planRun({ request: 'x', requestedStrategy: 'orchestrated' }, { env, cwd });

  assert.equal(readiness.verdict, 'pass', 'a present provider key with no tier pin must not read as unready');
  assert.equal(run.execution.degraded, false, 'the same env must not degrade the run either');
  assert.equal(readiness.reasonCode !== 'attached', run.execution.degraded, 'readiness-green must equal run-executability on the same env');
});
