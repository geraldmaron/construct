/**
 * tests/functional/workplace-loop-signal-quality.functional.test.mjs —
 * fixture-backed authenticated replay validating workplace-loop detection
 * quality against messy real-shaped data (construct-b0nny.31).
 *
 * construct-b0nny.25's honest gap: the one live connected source (this
 * checkout's own GitHub origin) has 0 open issues, so the "produces a
 * correctly-gated proposal" acceptance half was proven only against a
 * single curated fixture (tests/functional/workplace-loop.functional.test.mjs's
 * RISK_ISSUE) — mechanics-complete, but not a stress test of the detection
 * RULES (lib/workplace-loop/signals.mjs) against a realistically messy,
 * ambiguous issue corpus, via a fixture-backed authenticated replay rather
 * than a live external source: the `repo` string below
 * (`fixture-replay/messy-issue-corpus`) is deliberately
 * self-documenting as a replay, and every source citation this test asserts
 * on carries that same label — no result here is presented as having come
 * from a real external repository.
 *
 * Drives lib/workplace-loop/detect.mjs's real runDetect() directly (the
 * exact function lib/workplace-loop/cli.mjs's `detect` subcommand calls),
 * with an injected providerFactory standing in only for the network boundary
 * (sources/github-source.mjs's provider) and replaying a captured-shaped
 * GitHub REST issues payload — every downstream stage (signals, align,
 * propose) is the real, unmodified production code. Then drives the resulting proposal
 * through the real gate.mjs/ApprovalQueue/control-plane chokepoint via the
 * CLI, matching the established isolation pattern in
 * workplace-loop.functional.test.mjs.
 *
 * The corpus is built to make detectSignals/classifyNoiseIssues either
 * correctly fire or correctly stay silent on each issue for a structural
 * reason (date math, label pattern, assignee presence, body length) — not a
 * ground-truth flag baked into the fixture, matching signals.mjs's own
 * documented non-fabrication discipline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';
import { runDetect } from '../../lib/workplace-loop/detect.mjs';
import { runWorkplaceLoopCli } from '../../lib/workplace-loop/cli.mjs';
import { ApprovalQueue } from '../../lib/embed/approval-queue.mjs';
import { listProposals } from '../../lib/workplace-loop/state-store.mjs';
import { sqliteAvailable } from '../../lib/workspace/sqlite-db.mjs';

const REPLAY_REPO = 'fixture-replay/messy-issue-corpus';

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-loop-b0nny31-home-'));
const REPO = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-loop-b0nny31-repo-')));
execFileSync('git', ['init', '-q'], { cwd: REPO });

const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = SANDBOX_HOME;

test.after(() => {
  rmTmpDir(SANDBOX_HOME);
  rmTmpDir(REPO);
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function fakeProviderReturning(issues) {
  return () => ({ search: async () => issues });
}

// Deliberately messy: stale/fresh, owned/unowned, real-world label
// conventions (mixed case, hyphenated compounds), noise labels, boundary
// dates either side of the 30/60-day thresholds, and a stray PR that
// fetchGithubOpenIssues must filter before signals.mjs ever sees it.

const CORPUS = [
  {
    // High-severity stale: 75 days idle, well past staleDays*2 (60).
    number: 101, title: 'Ingest pipeline silently drops malformed rows',
    body: 'Confirmed with a 200-row sample; no error surfaces anywhere in logs.',
    state: 'open', labels: [{ name: 'data-quality' }], assignee: { login: 'amara' },
    updated_at: daysAgo(75), created_at: daysAgo(90),
    html_url: 'https://example.invalid/fixture/101',
  },
  {
    // Medium-severity stale: 45 days idle, between staleDays (30) and staleDays*2 (60).
    // Owned — proves detectStaleIssues fires regardless of assignee.
    number: 102, title: 'Docs search returns stale results after reindex',
    body: 'Reproduced on prod; index refresh does not invalidate the query cache.',
    state: 'open', labels: [{ name: 'search' }], assignee: { login: 'dmitri' },
    updated_at: daysAgo(45), created_at: daysAgo(50),
    html_url: 'https://example.invalid/fixture/102',
  },
  {
    // Boundary: exactly at the 30-day threshold — must NOT fire (detectStaleIssues
    // uses daysSince <= staleDays as the "not yet stale" branch).
    number: 103, title: 'Export job leaves a partial file on interrupt',
    body: 'Only reproduces under SIGTERM mid-write; low priority for now.',
    state: 'open', labels: [], assignee: { login: 'priya' },
    updated_at: daysAgo(30), created_at: daysAgo(40),
    html_url: 'https://example.invalid/fixture/103',
  },
  {
    // Unowned risk, uppercase label convention.
    number: 104, title: 'Auth token refresh race under concurrent tabs',
    body: 'Two tabs racing token refresh occasionally invalidates the good one.',
    state: 'open', labels: [{ name: 'P0' }], assignee: null,
    updated_at: daysAgo(2), created_at: daysAgo(3),
    html_url: 'https://example.invalid/fixture/104',
  },
  {
    // Unowned risk, hyphenated compound label — proves \b word-boundary matching
    // on a real-world label convention, not just a bare "blocker" token.
    number: 105, title: 'Release pipeline halts on flaky integration test',
    body: 'Blocks every release cut until manually restarted; happens ~1 in 5 runs.',
    state: 'open', labels: [{ name: 'release-blocker' }], assignee: null,
    updated_at: daysAgo(1), created_at: daysAgo(4),
    html_url: 'https://example.invalid/fixture/105',
  },
  {
    // Risk label, mixed case, but OWNED — must NOT fire unowned-risk.
    number: 106, title: 'Security header missing on one legacy redirect path',
    body: 'CSP header absent on /legacy/export; tracked, already assigned.',
    state: 'open', labels: [{ name: 'Security' }], assignee: { login: 'nakamura' },
    updated_at: daysAgo(3), created_at: daysAgo(5),
    html_url: 'https://example.invalid/fixture/106',
  },
  {
    // Noise via explicit noise label, despite an urgent-sounding title.
    number: 107, title: 'URGENT: dashboard flickers on load',
    body: 'Confirmed cosmetic only; closing as not a real defect.',
    state: 'open', labels: [{ name: 'wontfix' }], assignee: null,
    updated_at: daysAgo(1), created_at: daysAgo(1),
    html_url: 'https://example.invalid/fixture/107',
  },
  {
    // Noise via no-signal: no labels, no assignee, short body.
    number: 108, title: 'question about setup',
    body: 'does this work with node 18',
    state: 'open', labels: [], assignee: null,
    updated_at: daysAgo(1), created_at: daysAgo(1),
    html_url: 'https://example.invalid/fixture/108',
  },
  {
    // Not noise (long body clears the 40-char floor) but also not stale or
    // risk-labeled — correctly absent from BOTH meaningful and noise.
    number: 109, title: 'Question about the plugin loading order at startup',
    body: 'Wondering if plugins load in declaration order or alphabetically — '
      + 'asking because two of mine seem to race on the same hook.',
    state: 'open', labels: [], assignee: null,
    updated_at: daysAgo(1), created_at: daysAgo(1),
    html_url: 'https://example.invalid/fixture/109',
  },
  {
    // A pull request shaped like an issue (GitHub's issues-search API returns
    // both) — must be filtered by fetchGithubOpenIssues before signals ever run.
    number: 110, title: 'Bump lockfile', body: 'Routine dependency bump.',
    state: 'open', labels: [{ name: 'p0' }], assignee: null,
    updated_at: daysAgo(90), created_at: daysAgo(90),
    html_url: 'https://example.invalid/fixture/110',
    pull_request: { url: 'https://example.invalid/fixture/pulls/110' },
  },
];

if (!sqliteAvailable()) {
  test('workplace-loop signal-quality suite skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  let report;

  test('runDetect over a messy real-shaped corpus classifies every issue for a structural reason', async () => {
    report = await runDetect(REPO, { repo: REPLAY_REPO, providerFactory: fakeProviderReturning(CORPUS) });
    assert.equal(report.result, 'NEW_FINDINGS');
    assert.equal(report.issuesScanned, CORPUS.length - 1, 'the PR-shaped record (#110) must be filtered before signal detection');

    const meaningfulIds = new Set(report.meaningfulSignals.map((s) => s.issueRef));
    const noiseIds = new Set(report.noiseFilteredOut.map((n) => n.ref));

    assert.ok(meaningfulIds.has('GH-101'), '#101: 75 days idle — stale, high severity');
    const sig101 = report.meaningfulSignals.find((s) => s.issueRef === 'GH-101');
    assert.equal(sig101.type, 'stale_issue');
    assert.equal(sig101.severity, 'high');

    assert.ok(meaningfulIds.has('GH-102'), '#102: 45 days idle and owned — stale still fires regardless of assignee');
    const sig102 = report.meaningfulSignals.find((s) => s.issueRef === 'GH-102');
    assert.equal(sig102.type, 'stale_issue');
    assert.equal(sig102.severity, 'medium');

    assert.ok(!meaningfulIds.has('GH-103'), '#103: exactly 30 days — at the threshold, must not fire yet');
    assert.ok(!noiseIds.has('GH-103'), '#103 has a body and an assignee — not noise either, simply unremarkable');

    assert.ok(meaningfulIds.has('GH-104'), '#104: unowned + "P0" label (uppercase)');
    assert.equal(report.meaningfulSignals.find((s) => s.issueRef === 'GH-104').type, 'unowned_risk_issue');

    assert.ok(meaningfulIds.has('GH-105'), '#105: unowned + "release-blocker" (hyphenated compound, word-boundary match)');
    assert.equal(report.meaningfulSignals.find((s) => s.issueRef === 'GH-105').type, 'unowned_risk_issue');

    assert.ok(!meaningfulIds.has('GH-106'), '#106: "Security" label but owned — must not fire unowned-risk');

    assert.ok(noiseIds.has('GH-107'), '#107: "wontfix" label overrides an urgent-sounding title');
    assert.ok(noiseIds.has('GH-108'), '#108: no labels, no assignee, body under 40 chars');
    assert.ok(!noiseIds.has('GH-109'), '#109: no labels/assignee but body clears the 40-char floor — not noise');
    assert.ok(!meaningfulIds.has('GH-109'), '#109: not stale, no risk label — also not meaningful');

    for (const s of report.meaningfulSignals) {
      assert.equal(s.sources[0].repo, REPLAY_REPO, 'every cited source must carry the fixture-replay label, never an implied live repo');
    }
  });

  test('the two unconditionally-actionable signals produce a correctly-gated proposal', async () => {
    const proposals = listProposals(REPO);
    assert.equal(proposals.length, 1);
    const proposal = proposals[0];
    assert.equal(proposal.proposalId, report.proposalId);
    assert.equal(proposal.status, 'pending_approval');

    const effectIssueNumbers = proposal.proposedExternalEffects.map((e) => e.payload.issue_number).sort((a, b) => a - b);
    assert.deepEqual(effectIssueNumbers, [104, 105], 'only the unowned-risk signals are unconditionally actionable with no strategy configured');
    assert.equal(proposal.basedOnSignals.length, 2);
  });

  test('the proposal requires real approval before any effect executes (gate.mjs / ApprovalQueue)', async () => {
    const requestCode = await runWorkplaceLoopCli(['request-approval', '--proposal', report.proposalId, '--json'], { projectDir: REPO });
    assert.equal(requestCode, 0);

    const persistPath = ApprovalQueue.resolvePersistPath(REPO);
    const queue = new ApprovalQueue({ persistPath });
    const records = queue.list();
    assert.equal(records.length, 2);
    assert.ok(records.every((r) => r.state === 'awaiting_approval'));

    const refusedApplyCode = await runWorkplaceLoopCli(['apply', '--proposal', report.proposalId], { projectDir: REPO });
    assert.equal(refusedApplyCode, 1, 'apply must refuse before approval — this is the same gate every other workplace-loop proposal goes through');
  });
}
