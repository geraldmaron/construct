/**
 * tests/workplace-loop/align.test.mjs — unit coverage for
 * lib/workplace-loop/align.mjs (construct-b0nny.25), including the
 * no-fabrication guarantee: no configured strategy means no asserted
 * alignment verdict, ever.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkAlignment, alignSignals, loadStrategyPillars } from '../../lib/workplace-loop/align.mjs';
import { ensureWorkspace, setSetting } from '../../lib/workspace/store.mjs';
import { sqliteAvailable } from '../../lib/workspace/sqlite-db.mjs';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-align-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-align-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

const SIGNAL = { id: 'SIG-1', type: 'stale_issue', summary: 'GH-1 has been stale for a while and blocks SSO rollout.', sources: [{ kind: 'github', repo: 'o/r', ref: '#1' }] };

test('checkAlignment returns no_strategy_configured for an empty pillar list — never a fabricated verdict', () => {
  const result = checkAlignment(SIGNAL, []);
  assert.equal(result.verdict, 'no_strategy_configured');
});

test('checkAlignment returns conflict when a pillar keyword matches the signal text', () => {
  const pillars = [{ name: 'Enterprise SSO', keywords: ['sso'] }];
  const result = checkAlignment(SIGNAL, pillars);
  assert.equal(result.verdict, 'conflict');
  assert.equal(result.pillar, 'Enterprise SSO');
});

test('checkAlignment returns aligned when pillars are configured but none match', () => {
  const pillars = [{ name: 'Dark mode', keywords: ['dark mode', 'theming'] }];
  const result = checkAlignment(SIGNAL, pillars);
  assert.equal(result.verdict, 'aligned');
});

if (!sqliteAvailable()) {
  test('workplace-loop align skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  test('loadStrategyPillars returns [] when no workspace/setting exists — no fabrication', () => {
    const root = project();
    assert.deepEqual(loadStrategyPillars(root), []);
  });

  test('loadStrategyPillars reads real pillars from the Workspace settings store (E2)', () => {
    const root = project();
    ensureWorkspace(root, { name: 'align-test' });
    setSetting(root, 'workplaceLoop.strategyPillars', [{ name: 'Reliability', keywords: ['flaky', 'outage'] }]);
    const pillars = loadStrategyPillars(root);
    assert.equal(pillars.length, 1);
    assert.equal(pillars[0].name, 'Reliability');
  });

  test('alignSignals annotates every signal using the real Workspace-backed pillars', () => {
    const root = project();
    ensureWorkspace(root, { name: 'align-test-2' });
    setSetting(root, 'workplaceLoop.strategyPillars', [{ name: 'Enterprise SSO', keywords: ['sso'] }]);
    const [annotated] = alignSignals(root, [SIGNAL]);
    assert.equal(annotated.alignment.verdict, 'conflict');
    assert.equal(annotated.id, SIGNAL.id, 'the original signal fields must survive annotation');
  });
}
