/**
 * tests/workplace-loop/detect.test.mjs — unit coverage for
 * lib/workplace-loop/detect.mjs (construct-b0nny.25), including the
 * no-fabrication proof (requirement: "a no-op run reports 'nothing new,'
 * never invents activity") against an injected, real-shaped fake source —
 * not spike D's static fixture file, a live-call-shaped provider double
 * that this module's own fingerprinting logic must still gate correctly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runDetect } from '../../lib/workplace-loop/detect.mjs';
import { loadProposal } from '../../lib/workplace-loop/state-store.mjs';
import { setSetting, ensureWorkspace } from '../../lib/workspace/store.mjs';
import { sqliteAvailable } from '../../lib/workspace/sqlite-db.mjs';

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-detect-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-workplace-detect-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const RISK_ISSUE = {
  number: 101, title: 'SSO group-claims blocker', body: 'blocks the top enterprise deal',
  state: 'open', labels: [{ name: 'enterprise-blocker' }], assignee: null,
  updated_at: '2026-06-05T00:00:00Z', created_at: '2026-01-01T00:00:00Z',
  html_url: 'https://github.com/o/r/issues/101',
};

function fakeProviderReturning(issues) {
  return () => ({ search: async () => issues });
}

test('runDetect returns NO_SOURCE_CONFIGURED when no repo and no origin remote resolve — no fabricated repo', async () => {
  const root = project();
  const report = await runDetect(root, { providerFactory: fakeProviderReturning([]) });
  assert.equal(report.result, 'NO_SOURCE_CONFIGURED');
});

if (!sqliteAvailable()) {
  test('workplace-loop detect skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  test('runDetect finds a real-shaped signal and produces a gated proposal on the first run', async () => {
    const root = project();
    ensureWorkspace(root, { name: 'detect-test' });
    setSetting(root, 'workplaceLoop.strategyPillars', [{ name: 'Enterprise SSO', keywords: ['sso'] }]);

    const report = await runDetect(root, { repo: 'o/r', providerFactory: fakeProviderReturning([RISK_ISSUE]) });
    assert.equal(report.result, 'NEW_FINDINGS');
    assert.equal(report.runNumber, 1);
    assert.ok(report.meaningfulSignals.length >= 1);
    assert.ok(report.proposalId, 'an actionable signal must produce a gated proposal');

    const proposal = loadProposal(root, report.proposalId);
    assert.equal(proposal.status, 'pending_approval');
  });

  test('runDetect reports NOTHING_NEW on a second run with an unchanged source — the no-fabrication proof', async () => {
    const root = project();
    ensureWorkspace(root, { name: 'detect-test-2' });

    const first = await runDetect(root, { repo: 'o/r', providerFactory: fakeProviderReturning([RISK_ISSUE]) });
    assert.equal(first.result, 'NEW_FINDINGS');

    const second = await runDetect(root, { repo: 'o/r', providerFactory: fakeProviderReturning([RISK_ISSUE]) });
    assert.equal(second.result, 'NOTHING_NEW');
    assert.equal(second.fingerprint, first.fingerprint);
    assert.deepEqual(second.previousRun.signalIds, first.meaningfulSignals.map((s) => s.id));
  });

  test('runDetect detects fresh activity again once the source actually changes', async () => {
    const root = project();
    ensureWorkspace(root, { name: 'detect-test-3' });

    const first = await runDetect(root, { repo: 'o/r', providerFactory: fakeProviderReturning([RISK_ISSUE]) });
    assert.equal(first.result, 'NEW_FINDINGS');

    const changedIssue = { ...RISK_ISSUE, assignee: { login: 'someone' } };
    const second = await runDetect(root, { repo: 'o/r', providerFactory: fakeProviderReturning([changedIssue]) });
    assert.equal(second.result, 'NEW_FINDINGS', 'assigning the issue changes the source content, so this must not be reported as nothing new');
    assert.equal(second.runNumber, 2);
  });
}
