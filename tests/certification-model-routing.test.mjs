/**
 * tests/certification-model-routing.test.mjs — OpenRouter free-first certification routing.
 *
 * @capability test-system.certification-model-routing
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runCertificationCli } from '../lib/certification/cli.mjs';
import {
  CERTIFICATION_MODEL_ROUTES,
  PAID_BUDGET_ENV,
  PAID_OPT_IN_ENV,
  listCertificationModels,
  resolveCertificationModel,
} from '../lib/certification/model-routing.mjs';
import { runCertificationScenario } from '../lib/certification/runner.mjs';

test('routing table lists free models by default without network', () => {
  assert.ok(CERTIFICATION_MODEL_ROUTES.length >= 3);
  const env = { ...process.env };
  delete env[PAID_OPT_IN_ENV];
  const models = listCertificationModels({ env });
  assert.ok(models.every((entry) => entry.tier !== 'paid-reference'));
  assert.ok(models.some((entry) => entry.tier === 'free'));
});

test('paid path fails closed without opt-in env', () => {
  const env = { ...process.env };
  delete env[PAID_OPT_IN_ENV];
  const resolved = resolveCertificationModel({
    provider: 'openrouter',
    requestedId: 'anthropic/claude-sonnet-4',
    resolvedId: 'openrouter/anthropic/claude-sonnet-4',
    tier: 'paid-reference',
  }, { env, now: () => '2026-06-22T18:00:00.000Z' });
  assert.equal(resolved.blocked, true);
  assert.equal(resolved.paidOptIn, false);
  assert.equal(resolved.operatorAckAt, null);
});

test('paid path records operator ack when opt-in is enabled', () => {
  const env = { ...process.env, [PAID_OPT_IN_ENV]: '1', [PAID_BUDGET_ENV]: '1.0' };
  const resolved = resolveCertificationModel({
    provider: 'openrouter',
    requestedId: 'anthropic/claude-sonnet-4',
    resolvedId: 'openrouter/anthropic/claude-sonnet-4',
    tier: 'paid-reference',
  }, { env, now: () => '2026-06-22T18:00:00.000Z' });
  assert.equal(resolved.blocked, false);
  assert.equal(resolved.paidOptIn, true);
  assert.equal(resolved.operatorAckAt, '2026-06-22T18:00:00.000Z');
});

test('construct certify models lists free models only by default', async () => {
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };
  try {
    const env = { ...process.env };
    delete env[PAID_OPT_IN_ENV];
    const code = await runCertificationCli(['models'], { env });
    assert.equal(code, 0);
    const output = chunks.join('');
    assert.match(output, /free/);
    assert.doesNotMatch(output, /paid-reference/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('run artifact records tier and opt-in state', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-routing-artifact-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const env = { ...process.env, [PAID_OPT_IN_ENV]: '1', [PAID_BUDGET_ENV]: '1.0' };
  const result = await runCertificationScenario('ledger.traceability', {
    projectDir: rootDir,
    repoRoot: process.cwd(),
    env,
  });
  assert.equal(result.run.model.tier, 'hermetic');
  assert.equal(result.run.model.paidOptIn, false);
});

test('paid scenario without opt-in persists blocked model state', async (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-paid-blocked-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  const env = { ...process.env, CONSTRUCT_CERTIFY_LIVE: '1' };
  delete env[PAID_OPT_IN_ENV];
  const result = await runCertificationScenario('worker-profile.prompt.paid-reference', {
    projectDir: rootDir,
    repoRoot: process.cwd(),
    env,
    now: () => '2026-06-22T18:00:00.000Z',
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.run.model.tier, 'paid-reference');
  assert.equal(result.run.model.paidOptIn, false);
  assert.equal(result.run.model.operatorAckAt, null);
});
