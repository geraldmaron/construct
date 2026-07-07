#!/usr/bin/env node
/**
 * lib/hooks/beads-drift.mjs — beads hygiene drift detection.
 *
 * Three checks that surface stale tracker state before it accumulates:
 *
 *   1. Stale-open: open beads whose updatedAt is older than the staleness
 *      window (default 14 days). Stale-open isn't a bug by itself but
 *      means nobody has reviewed the bead in two weeks — likely irrelevant.
 *
 *   2. Stuck-in-progress: in_progress beads whose updatedAt is older than
 *      the stuck window (default 3 days). A bead in_progress is supposed
 *      to be claimed by an active session; 3+ days untouched means the
 *      session that claimed it didn't follow through.
 *
 *   3. Merge-drift: open beads whose title or description appears verbatim
 *      in a commit subject from the last N commits (default 50). Cross-
 *      checks tracker state against recently merged work to catch beads
 *      that should have been closed in the merge.
 *
 * The module exposes `detectBeadsDrift({...})` as a pure function so
 * `construct doctor` and the pre-push gate can both consume it. CLI
 * entry writes a human-readable report (and machine-readable JSON via
 * `--json`) and exits non-zero when any check exceeds its threshold.
 */

import { spawnSync } from 'node:child_process';
import { isMainModule } from '../roots.mjs';

const DEFAULT_STALE_OPEN_DAYS = 14;
const DEFAULT_STUCK_IN_PROGRESS_DAYS = 3;
const DEFAULT_MERGE_LOOKBACK = 50;

function daysAgo(value) {
  if (!value) return Infinity;
  const ts = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ts)) return Infinity;
  return (Date.now() - ts) / (24 * 60 * 60 * 1000);
}

function beadUpdatedAt(bead) {
  return bead?.updated || bead?.updatedAt || bead?.updated_at || bead?.created || bead?.createdAt || bead?.created_at || null;
}

function listBeadsJson({ status, runner = spawnSync } = {}) {
  const args = ['list', '--json'];
  if (status) args.push(`--status=${status}`);
  const result = runner('bd', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.issues)) return parsed.issues;
    return [];
  } catch {
    return [];
  }
}

function recentCommitSubjects(limit, { runner = spawnSync } = {}) {
  const result = runner('git', ['log', '-n', String(limit), '--pretty=format:%s'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) return [];
  return result.stdout.split('\n').filter(Boolean);
}

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
}

function titleAppearsInSubject(beadTitle, commitSubject) {
  // Normalize both sides, then check that the bead's first significant
  // tokens are present in the commit subject. Strict enough to avoid
  // false positives, lax enough to catch reasonable matches.
  const beadTokens = tokenize(beadTitle).slice(0, 5);
  if (beadTokens.length < 3) return false;
  const lowerSubject = String(commitSubject || '').toLowerCase();
  let hits = 0;
  for (const token of beadTokens) {
    if (lowerSubject.includes(token)) hits += 1;
  }
  return hits >= 3;
}

/**
 * Oracle auto-raised meta beads must not feed back into hygiene drift counts.
 */
export function isOracleMetaBead(bead) {
  const title = String(bead?.title ?? '');
  const labels = Array.isArray(bead?.labels) ? bead.labels : [];
  return title.startsWith('[oracle/') || labels.includes('oracle');
}

function filterOracleMeta(beads, excludeOracleMeta) {
  if (!excludeOracleMeta) return beads;
  return beads.filter((b) => !isOracleMetaBead(b));
}

/**
 * Run the three drift checks against the live tracker + git state.
 * Pure-ish — accepts a runner injection for tests.
 */
export function detectBeadsDrift({
  staleOpenDays = DEFAULT_STALE_OPEN_DAYS,
  stuckInProgressDays = DEFAULT_STUCK_IN_PROGRESS_DAYS,
  mergeLookback = DEFAULT_MERGE_LOOKBACK,
  excludeOracleMeta = true,
  runner = spawnSync,
} = {}) {
  const openRaw = listBeadsJson({ status: 'open', runner });
  const inProgressRaw = listBeadsJson({ status: 'in_progress', runner });
  const open = filterOracleMeta(openRaw, excludeOracleMeta);
  const inProgress = filterOracleMeta(inProgressRaw, excludeOracleMeta);
  const commits = recentCommitSubjects(mergeLookback, { runner });

  const staleOpen = open.filter((b) => daysAgo(beadUpdatedAt(b)) > staleOpenDays);
  const stuckInProgress = inProgress.filter((b) => daysAgo(beadUpdatedAt(b)) > stuckInProgressDays);

  const mergeDrift = [];
  for (const bead of open) {
    for (const subject of commits) {
      if (titleAppearsInSubject(bead.title, subject)) {
        mergeDrift.push({ id: bead.id, title: bead.title, matchedSubject: subject });
        break;
      }
    }
  }

  return {
    staleOpen: staleOpen.map((b) => ({ id: b.id, title: b.title, ageDays: Math.round(daysAgo(beadUpdatedAt(b))) })),
    stuckInProgress: stuckInProgress.map((b) => ({ id: b.id, title: b.title, ageDays: Math.round(daysAgo(beadUpdatedAt(b))) })),
    mergeDrift,
    thresholds: { staleOpenDays, stuckInProgressDays, mergeLookback },
    counts: {
      staleOpen: staleOpen.length,
      stuckInProgress: stuckInProgress.length,
      mergeDrift: mergeDrift.length,
    },
  };
}

export function formatDriftReport(report) {
  const lines = [];
  lines.push(`Beads hygiene drift report — checked against last ${report.thresholds.mergeLookback} commits`);
  lines.push('');
  if (report.counts.staleOpen === 0 && report.counts.stuckInProgress === 0 && report.counts.mergeDrift === 0) {
    lines.push('✓ no drift detected');
    return lines.join('\n') + '\n';
  }
  if (report.counts.stuckInProgress > 0) {
    lines.push(`Stuck in_progress (> ${report.thresholds.stuckInProgressDays}d untouched):`);
    for (const b of report.stuckInProgress) lines.push(`  ${b.id} · ${b.ageDays}d · ${b.title}`);
    lines.push('');
  }
  if (report.counts.staleOpen > 0) {
    lines.push(`Stale open (> ${report.thresholds.staleOpenDays}d untouched):`);
    for (const b of report.staleOpen) lines.push(`  ${b.id} · ${b.ageDays}d · ${b.title}`);
    lines.push('');
  }
  if (report.counts.mergeDrift > 0) {
    lines.push(`Possible merge drift (open bead title overlaps a recent commit subject):`);
    for (const b of report.mergeDrift) lines.push(`  ${b.id} · ${b.title}\n    matched: ${b.matchedSubject}`);
    lines.push('');
  }
  return lines.join('\n');
}

// CLI: print report, exit non-zero when thresholds breached unless --report-only.
const invokedDirectly = isMainModule(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const reportOnly = args.includes('--report-only');
  const opts = {};
  for (const arg of args) {
    const m = arg.match(/^--([a-z-]+)=(\d+)$/);
    if (!m) continue;
    if (m[1] === 'stale-open-days') opts.staleOpenDays = Number(m[2]);
    if (m[1] === 'stuck-in-progress-days') opts.stuckInProgressDays = Number(m[2]);
    if (m[1] === 'merge-lookback') opts.mergeLookback = Number(m[2]);
  }
  const report = detectBeadsDrift(opts);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatDriftReport(report));
  }
  if (!reportOnly && (report.counts.stuckInProgress > 0 || report.counts.mergeDrift > 0)) {
    process.exit(2);
  }
  process.exit(0);
}
