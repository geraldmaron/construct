/**
 * tests/beads-drift.test.mjs — beads hygiene drift detection.
 *
 * Pins detectBeadsDrift's three checks (stale-open, stuck-in-progress,
 * merge-drift) via an injected runner that fakes `bd list --json` and
 * `git log`. The merge-drift token-matching threshold (3+ significant
 * tokens shared with a commit subject) gets both a positive and a
 * negative case so the heuristic stays calibrated.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { detectBeadsDrift, formatDriftReport, isOracleMetaBead } from '../lib/beads/drift.mjs';

function days(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function makeRunner({ open = [], inProgress = [], commits = [] }) {
  return (cmd, args) => {
    if (cmd === 'bd' && args[0] === 'list' && args.includes('--status=open')) {
      return { status: 0, stdout: JSON.stringify(open), stderr: '' };
    }
    if (cmd === 'bd' && args[0] === 'list' && args.includes('--status=in_progress')) {
      return { status: 0, stdout: JSON.stringify(inProgress), stderr: '' };
    }
    if (cmd === 'git' && args[0] === 'log') {
      return { status: 0, stdout: commits.join('\n'), stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

describe('detectBeadsDrift', () => {
  it('returns zero-counts when everything is fresh and unrelated to recent commits', () => {
    const runner = makeRunner({
      open: [{ id: 'construct-a', title: 'something niche', updated: days(1) }],
      inProgress: [{ id: 'construct-b', title: 'in flight', updated: days(0.5) }],
      commits: ['feat: unrelated stuff'],
    });
    const r = detectBeadsDrift({ runner });
    assert.equal(r.counts.staleOpen, 0);
    assert.equal(r.counts.stuckInProgress, 0);
    assert.equal(r.counts.mergeDrift, 0);
  });

  it('flags stale-open beads past the threshold', () => {
    const runner = makeRunner({
      open: [
        { id: 'construct-old', title: 'old thing', updated: days(30) },
        { id: 'construct-fresh', title: 'recent', updated: days(2) },
      ],
    });
    const r = detectBeadsDrift({ runner, staleOpenDays: 14 });
    assert.equal(r.counts.staleOpen, 1);
    assert.equal(r.staleOpen[0].id, 'construct-old');
  });

  it('flags stuck-in-progress beads past the threshold', () => {
    const runner = makeRunner({
      inProgress: [
        { id: 'construct-stuck', title: 'stuck for days', updated: days(5) },
        { id: 'construct-active', title: 'active now', updated: days(0.5) },
      ],
    });
    const r = detectBeadsDrift({ runner, stuckInProgressDays: 3 });
    assert.equal(r.counts.stuckInProgress, 1);
    assert.equal(r.stuckInProgress[0].id, 'construct-stuck');
  });

  it('excludes oracle meta beads from stuck and stale counts by default', () => {
    assert.equal(isOracleMetaBead({ title: '[oracle/beads-hygiene] stuck' }), true);
    assert.equal(isOracleMetaBead({ title: 'normal bead', labels: ['oracle'] }), true);
    const runner = makeRunner({
      open: [
        { id: 'construct-stale', title: 'stale human work', updated: days(30) },
        { id: 'construct-oracle', title: '[oracle/beads-hygiene] hygiene', updated: days(30) },
      ],
      inProgress: [
        { id: 'construct-stuck', title: 'stuck human work', updated: days(5) },
        { id: 'construct-oracle-ip', title: '[oracle/workflow-misaligned] wf', updated: days(5) },
      ],
    });
    const r = detectBeadsDrift({ runner, staleOpenDays: 14, stuckInProgressDays: 3 });
    assert.equal(r.counts.staleOpen, 1);
    assert.equal(r.counts.stuckInProgress, 1);
    assert.equal(r.staleOpen[0].id, 'construct-stale');
    assert.equal(r.stuckInProgress[0].id, 'construct-stuck');
  });

  it('includes oracle meta beads when excludeOracleMeta is false', () => {
    const runner = makeRunner({
      inProgress: [
        { id: 'construct-oracle-ip', title: '[oracle/workflow-misaligned] wf', updated: days(5) },
      ],
    });
    const r = detectBeadsDrift({ runner, stuckInProgressDays: 3, excludeOracleMeta: false });
    assert.equal(r.counts.stuckInProgress, 1);
  });

  it('flags merge-drift when an open bead title shares 3+ significant tokens with a commit subject', () => {
    const runner = makeRunner({
      open: [
        { id: 'construct-router', title: 'wire context router into specialist dispatch', updated: days(1) },
      ],
      commits: ['feat(routing): wire context router into specialist dispatch'],
    });
    const r = detectBeadsDrift({ runner });
    assert.equal(r.counts.mergeDrift, 1);
    assert.equal(r.mergeDrift[0].id, 'construct-router');
    assert.match(r.mergeDrift[0].matchedSubject, /context router/);
  });

  it('does NOT flag merge-drift on minimal overlap', () => {
    const runner = makeRunner({
      open: [{ id: 'construct-x', title: 'minor cosmetic typo', updated: days(1) }],
      commits: ['feat(routing): wire context router into specialist dispatch'],
    });
    const r = detectBeadsDrift({ runner });
    assert.equal(r.counts.mergeDrift, 0);
  });
});

describe('formatDriftReport', () => {
  it('reports "no drift detected" when all counts are zero', () => {
    const report = {
      staleOpen: [], stuckInProgress: [], mergeDrift: [],
      counts: { staleOpen: 0, stuckInProgress: 0, mergeDrift: 0 },
      thresholds: { staleOpenDays: 14, stuckInProgressDays: 3, mergeLookback: 50 },
    };
    assert.match(formatDriftReport(report), /no drift detected/);
  });

  it('renders each category when drift is present', () => {
    const report = {
      staleOpen: [{ id: 'construct-a', title: 'stale', ageDays: 30 }],
      stuckInProgress: [{ id: 'construct-b', title: 'stuck', ageDays: 5 }],
      mergeDrift: [{ id: 'construct-c', title: 'merged?', matchedSubject: 'feat: merged thing' }],
      counts: { staleOpen: 1, stuckInProgress: 1, mergeDrift: 1 },
      thresholds: { staleOpenDays: 14, stuckInProgressDays: 3, mergeLookback: 50 },
    };
    const text = formatDriftReport(report);
    assert.match(text, /Stuck in_progress/);
    assert.match(text, /Stale open/);
    assert.match(text, /Possible merge drift/);
    assert.match(text, /construct-a/);
    assert.match(text, /construct-b/);
    assert.match(text, /construct-c/);
  });
});
