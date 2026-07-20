/**
 * tests/doctor/cost-ledger.test.mjs — daily budget tracking and enforcement.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { tempDir } from '../helpers.mjs';

let ledger;
test.before(async () => {
  process.env.CONSTRUCT_DOCTOR_ROOT = tempDir('construct-cost-ledger-');
  ledger = await import('../../lib/cost-ledger.mjs');
});

test.beforeEach(() => {
  const p = ledger._paths.ledgerPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('CONSTRUCT_BUDGET_')) delete process.env[k];
  }
  delete process.env.CONSTRUCT_ROLES;
});

test('recordSpend accumulates totals per worker-profile-day', () => {
  ledger.recordSpend({ workerProfileId: 'sre', tokens: 1000, costUsd: 0.01 });
  ledger.recordSpend({ workerProfileId: 'sre', tokens: 500, costUsd: 0.005 });
  const spend = ledger.getDailySpend({ workerProfileId: 'sre' });
  assert.equal(spend.tokens, 1500);
  assert.equal(spend.costUsd, 0.015);
  assert.equal(spend.invocations, 2);
});

test('getTotalDailySpend sums across worker profiles', () => {
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 0.5 });
  ledger.recordSpend({ workerProfileId: 'qa', costUsd: 0.3 });
  const total = ledger.getTotalDailySpend();
  assert.ok(total.costUsd >= 0.79 && total.costUsd <= 0.81, `got ${total.costUsd}`);
  assert.equal(total.invocations, 2);
});

test('checkBudget allows when under cap and warns at 80%', () => {
  process.env.CONSTRUCT_BUDGET_ENFORCE = 'on';
  process.env.CONSTRUCT_BUDGET_DEFAULT = '1.00';
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 0.85 });
  const r = ledger.checkBudget({ workerProfileId: 'sre' });
  assert.equal(r.allowed, true);
  assert.ok(r.warning, 'expected warning at 85%');
});

test('checkBudget denies when worker profile cap exhausted (enforcement on)', () => {
  process.env.CONSTRUCT_BUDGET_ENFORCE = 'on';
  process.env.CONSTRUCT_BUDGET_DEFAULT = '0.50';
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 0.55 });
  const r = ledger.checkBudget({ workerProfileId: 'sre' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'worker-profile-budget-exhausted');
});

test('checkBudget denies when total cap exhausted (enforcement on)', () => {
  process.env.CONSTRUCT_BUDGET_ENFORCE = 'on';
  process.env.CONSTRUCT_BUDGET_DEFAULT = '10.00';
  process.env.CONSTRUCT_BUDGET_TOTAL = '1.00';
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 0.6 });
  ledger.recordSpend({ workerProfileId: 'qa', costUsd: 0.5 });
  const r = ledger.checkBudget({ workerProfileId: 'sre' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'total-budget-exhausted');
});

test('per-worker-profile budget override beats default', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '1.00';
  process.env.CONSTRUCT_BUDGET_SRE = '0.10';
  assert.equal(ledger.workerProfileBudget('sre'), 0.10);
  assert.equal(ledger.workerProfileBudget('qa'), 1.00);
});

test('default enforcement is advisory — over-cap still allowed', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '0.01';
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 1.0 });
  const r = ledger.checkBudget({ workerProfileId: 'sre' });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'enforcement-advisory');
});

test('enforcement on does block when caps blown', () => {
  process.env.CONSTRUCT_BUDGET_ENFORCE = 'on';
  process.env.CONSTRUCT_BUDGET_DEFAULT = '0.01';
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 1.0 });
  const r = ledger.checkBudget({ workerProfileId: 'sre' });
  assert.equal(r.allowed, false);
});

test('recordSpend buckets by the entry timestamp, not Date.now()', () => {
  const yesterdayMs = Date.now() - 24 * 60 * 60 * 1000;
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 1.5, ts: yesterdayMs });
  ledger.recordSpend({ workerProfileId: 'sre', costUsd: 2.5, ts: Date.now() });
  const yesterdayKey = ledger.dayKey(yesterdayMs);
  const todayKey = ledger.dayKey(Date.now());
  assert.notEqual(yesterdayKey, todayKey, 'sanity: keys differ across days');
  const yesterdaySpend = ledger.getDailySpend({ workerProfileId: 'sre', ts: yesterdayMs });
  const todaySpend = ledger.getDailySpend({ workerProfileId: 'sre' });
  assert.equal(yesterdaySpend.costUsd, 1.5);
  assert.equal(todaySpend.costUsd, 2.5);
});

test('recordSpend accepts ISO-string timestamps', () => {
  const iso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const isoMs = Date.parse(iso);
  ledger.recordSpend({ workerProfileId: 'qa', costUsd: 3.0, ts: iso });
  const spend = ledger.getDailySpend({ workerProfileId: 'qa', ts: isoMs });
  assert.equal(spend.costUsd, 3.0);
});
