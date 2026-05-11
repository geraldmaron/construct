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

test('recordSpend accumulates totals per persona-day', () => {
  ledger.recordSpend({ personaId: 'sre', tokens: 1000, costUsd: 0.01 });
  ledger.recordSpend({ personaId: 'sre', tokens: 500, costUsd: 0.005 });
  const spend = ledger.getDailySpend({ personaId: 'sre' });
  assert.equal(spend.tokens, 1500);
  assert.equal(spend.costUsd, 0.015);
  assert.equal(spend.invocations, 2);
});

test('getTotalDailySpend sums across personas', () => {
  ledger.recordSpend({ personaId: 'sre', costUsd: 0.5 });
  ledger.recordSpend({ personaId: 'qa', costUsd: 0.3 });
  const total = ledger.getTotalDailySpend();
  assert.ok(total.costUsd >= 0.79 && total.costUsd <= 0.81, `got ${total.costUsd}`);
  assert.equal(total.invocations, 2);
});

test('checkBudget allows when under cap and warns at 80%', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '1.00';
  ledger.recordSpend({ personaId: 'sre', costUsd: 0.85 });
  const r = ledger.checkBudget({ personaId: 'sre' });
  assert.equal(r.allowed, true);
  assert.ok(r.warning, 'expected warning at 85%');
});

test('checkBudget denies when persona cap exhausted', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '0.50';
  ledger.recordSpend({ personaId: 'sre', costUsd: 0.55 });
  const r = ledger.checkBudget({ personaId: 'sre' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'persona-budget-exhausted');
});

test('checkBudget denies when total cap exhausted', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '10.00';
  process.env.CONSTRUCT_BUDGET_TOTAL = '1.00';
  ledger.recordSpend({ personaId: 'sre', costUsd: 0.6 });
  ledger.recordSpend({ personaId: 'qa', costUsd: 0.5 });
  const r = ledger.checkBudget({ personaId: 'sre' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'total-budget-exhausted');
});

test('per-persona budget override beats default', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '1.00';
  process.env.CONSTRUCT_BUDGET_SRE = '0.10';
  assert.equal(ledger.personaBudget('sre'), 0.10);
  assert.equal(ledger.personaBudget('qa'), 1.00);
});

test('enforcement kill switch lets traffic through', () => {
  process.env.CONSTRUCT_BUDGET_DEFAULT = '0.01';
  process.env.CONSTRUCT_BUDGET_ENFORCE = 'off';
  ledger.recordSpend({ personaId: 'sre', costUsd: 1.0 });
  const r = ledger.checkBudget({ personaId: 'sre' });
  assert.equal(r.allowed, true);
  assert.equal(r.reason, 'enforcement-off');
});
