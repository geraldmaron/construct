/**
 * tests/cost-ledger-config.test.mjs — config-driven cost-budget precedence.
 *
 * Pins env > construct.config.json.costs.budgets > default for personaBudget
 * + totalBudget, and the corresponding enforce-flag precedence (env > config).
 * Tests run in a temp cwd so they don't disturb the real project config.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let projectRoot;
let originalCwd;
let originalEnv;

beforeEach(() => {
  originalCwd = process.cwd();
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('CONSTRUCT_BUDGET_')) delete process.env[k];
  }
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ledger-cfg-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
  process.chdir(projectRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, originalEnv);
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function writeCfg(costs) {
  fs.writeFileSync(path.join(projectRoot, 'construct.config.json'), JSON.stringify({ version: 1, costs }));
}

describe('config-driven persona + total budgets', () => {
  it('reads persona-specific budget from construct.config.json.costs.budgets', async () => {
    writeCfg({ budgets: { construct: { dailyUsd: 25 } } });
    const { personaBudget } = await import('../lib/cost-ledger.mjs');
    assert.equal(personaBudget('construct'), 25);
  });

  it('falls back to budgets.default.dailyUsd when persona has no specific entry', async () => {
    writeCfg({ budgets: { default: { dailyUsd: 7.5 } } });
    const { personaBudget } = await import('../lib/cost-ledger.mjs');
    assert.equal(personaBudget('unknown-persona'), 7.5);
  });

  it('env wins over config: CONSTRUCT_BUDGET_<PERSONA>', async () => {
    writeCfg({ budgets: { construct: { dailyUsd: 25 } } });
    process.env.CONSTRUCT_BUDGET_CONSTRUCT = '50';
    const { personaBudget } = await import('../lib/cost-ledger.mjs');
    assert.equal(personaBudget('construct'), 50);
  });

  it('reads totalBudget from costs.budgets.total.dailyUsd', async () => {
    writeCfg({ budgets: { total: { dailyUsd: 100 } } });
    const { totalBudget } = await import('../lib/cost-ledger.mjs');
    assert.equal(totalBudget(), 100);
  });

  it('env CONSTRUCT_BUDGET_TOTAL wins over config', async () => {
    writeCfg({ budgets: { total: { dailyUsd: 100 } } });
    process.env.CONSTRUCT_BUDGET_TOTAL = '500';
    const { totalBudget } = await import('../lib/cost-ledger.mjs');
    assert.equal(totalBudget(), 500);
  });
});

describe('enforcement precedence', () => {
  it('returns false by default with no env and no config', async () => {
    const { enforcementActive } = await import('../lib/cost-ledger.mjs');
    assert.equal(enforcementActive(), false);
  });

  it('returns true when construct.config.json.costs.enforce=true', async () => {
    writeCfg({ enforce: true });
    const { enforcementActive } = await import('../lib/cost-ledger.mjs');
    assert.equal(enforcementActive(), true);
  });

  it('env CONSTRUCT_BUDGET_ENFORCE=off wins over config enforce=true', async () => {
    writeCfg({ enforce: true });
    process.env.CONSTRUCT_BUDGET_ENFORCE = 'off';
    const { enforcementActive } = await import('../lib/cost-ledger.mjs');
    assert.equal(enforcementActive(), false);
  });

  it('env CONSTRUCT_BUDGET_ENFORCE=on wins over config enforce=false', async () => {
    writeCfg({ enforce: false });
    process.env.CONSTRUCT_BUDGET_ENFORCE = 'on';
    const { enforcementActive } = await import('../lib/cost-ledger.mjs');
    assert.equal(enforcementActive(), true);
  });
});
