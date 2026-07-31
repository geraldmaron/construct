/**
 * tests/functional/workplace-loop.functional.test.mjs — day-one proof for
 * the production sources/directives/workplace loop.
 *
 * Imports the real lib/workplace-loop/cli.mjs dispatch (`runWorkplaceLoopCli`,
 * the exact function bin/construct's `workplace-loop` handler calls) in one
 * isolated sandbox (CONSTRUCT_HOME_OVERRIDE redirected to a tmpdir, a real git
 * fixture repo, rmTmpDir teardown) — CLAUDE.md's multi-component-feature
 * rule ("CLI + durable state") applies since this bead touches directive
 * execution, the Workspace domain store, and the governed-write chokepoint
 * at once, mirroring tests/functional/workspace-domain.functional.test.mjs's
 * isolation pattern.
 *
 * Signal detection is driven by an injected providerFactory rather than a
 * live network call — the CLI's `ctx.providerFactory` seam (lib/workplace-
 * loop/cli.mjs's header comment explains why this is dependency injection,
 * not a policy-skip env var) — so this suite's pass/fail never depends on
 * live GitHub state. Apply is driven by an injected adapterFactories double
 * for the same reason: a functional test must never perform a real external
 * write with real credentials. Real-network detection against this repo's
 * own GitHub source, and a real (dry-run) exercise of the governed-write
 * chokepoint, are captured separately as this bead's real-source evidence
 * run — see the bead's completion-evidence report.
 *
 * Proves, against durable on-disk artifacts (not just in-memory return
 * values): a first detect run produces a gated, approval-required proposal;
 * apply REFUSES before approval (mirrors spike D's own refusal proof); once
 * approved, apply drains through the real control-plane chokepoint and
 * stamps `executedAt` on the real ApprovalQueue file; verify reports MATCH;
 * a second detect run over unchanged source data reports NOTHING_NEW (the
 * no-fabrication proof); a third run over changed data detects fresh
 * activity again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';
import { runWorkplaceLoopCli } from '../../lib/workplace-loop/cli.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { sqliteAvailable } from '../../lib/workspace/sqlite-db.mjs';

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-loop-b0nny25-home-'));
const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-loop-b0nny25-repo-')));
execFileSync('git', ['init', '-q'], { cwd: REPO });
execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/workplace-loop-demo.git'], { cwd: REPO });

const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;

test.after(() => {
  rmTmpDir(SANDBOX_HOME);
  rmTmpDir(REPO);
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const RISK_ISSUE = {
  number: 55, title: 'SSO regression blocks enterprise pilot',
  body: 'Group-claims mapping fails intermittently; blocking the top enterprise deal.',
  state: 'open', labels: [{ name: 'enterprise-blocker' }], assignee: null,
  updated_at: '2026-07-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
  html_url: 'https://github.com/example/workplace-loop-demo/issues/55',
};

function fakeProviderReturning(issues) {
  return () => ({ search: async () => issues });
}

function queueRecords() {
  const persistPath = ApprovalQueue.resolvePersistPath(REPO);
  const queue = new ApprovalQueue({ persistPath });
  return queue.list();
}

if (!sqliteAvailable()) {
  test('workplace loop functional suite skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  let proposalId;

  test('detect produces a gated, approval-required proposal from a real-shaped source', async () => {
    const code = await runWorkplaceLoopCli(['detect', '--json'], { projectDir: REPO, providerFactory: fakeProviderReturning([RISK_ISSUE]) });
    assert.equal(code, 0);
  });

  test('the proposal is a durable artifact on disk with proposedExternalEffects', async () => {
    const { loadLoopState, listProposals } = await import('../../lib/workplace-loop/state-store.mjs');
    const state = loadLoopState(REPO);
    assert.ok(state, 'loop state must be persisted after a detect run');
    assert.equal(state.runNumber, 1);
    const proposals = listProposals(REPO);
    assert.equal(proposals.length, 1);
    proposalId = proposals[0].proposalId;
    assert.equal(proposals[0].status, 'pending_approval');
    assert.equal(proposals[0].proposedExternalEffects.length, 1);
    assert.equal(proposals[0].proposedExternalEffects[0].payload.issue_number, 55);
  });

  test('apply REFUSES before any approval exists', async () => {
    const code = await runWorkplaceLoopCli(['request-approval', '--proposal', proposalId, '--json'], { projectDir: REPO });
    assert.equal(code, 0);

    const records = queueRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'awaiting_approval');

    const applyCode = await runWorkplaceLoopCli(['apply', '--proposal', proposalId], { projectDir: REPO });
    assert.equal(applyCode, 1, 'apply must refuse an unapproved proposal');
  });

  test('approve, then apply drains through the real control-plane chokepoint (durable executedAt stamp)', async () => {
    const approveCode = await runWorkplaceLoopCli(['approve', '--proposal', proposalId, '--by', 'priya-nair'], { projectDir: REPO });
    assert.equal(approveCode, 0);
    assert.equal(queueRecords()[0].state, 'approved');

    let writeCalls = 0;
    const applyCode = await runWorkplaceLoopCli(['apply', '--proposal', proposalId], {
      projectDir: REPO,
      adapterFactories: {
        github: () => ({
          meta: { id: 'github' },
          write: async (_config, payload) => { writeCalls += 1; return { type: 'comment-created', issue_number: payload.issue_number }; },
        }),
      },
    });
    assert.equal(applyCode, 0);
    assert.equal(writeCalls, 1, 'the injected adapter must be the only thing that "sent" the effect');

    const record = queueRecords()[0];
    assert.ok(record.executedAt, 'the real ApprovalQueue file on disk must carry executedAt after a real control-plane drain');
    assert.equal(record.executionError ?? null, null);
  });

  test('verify reports MATCH once the proposal has executed', async () => {
    const code = await runWorkplaceLoopCli(['verify', '--proposal', proposalId], { projectDir: REPO });
    assert.equal(code, 0);
  });

  test('a second detect run over unchanged source data reports NOTHING_NEW — the no-fabrication proof', async () => {
    const code = await runWorkplaceLoopCli(['detect', '--json'], { projectDir: REPO, providerFactory: fakeProviderReturning([RISK_ISSUE]) });
    assert.equal(code, 0);
    const { loadLoopState, listProposals } = await import('../../lib/workplace-loop/state-store.mjs');
    const state = loadLoopState(REPO);
    assert.equal(state.runNumber, 1, 'an unchanged source must not advance the run counter or mint a second proposal');
    assert.equal(listProposals(REPO).length, 1);
  });

  test('a third run over genuinely changed source data detects fresh activity', async () => {
    const changed = { ...RISK_ISSUE, updated_at: '2026-07-15T00:00:00Z', body: `${RISK_ISSUE.body} Escalated again.` };
    const code = await runWorkplaceLoopCli(['detect', '--json'], { projectDir: REPO, providerFactory: fakeProviderReturning([changed]) });
    assert.equal(code, 0);
    const { loadLoopState } = await import('../../lib/workplace-loop/state-store.mjs');
    const state = loadLoopState(REPO);
    assert.equal(state.runNumber, 2, 'genuinely changed source content must produce a new run, not another NOTHING_NEW');
  });
}
