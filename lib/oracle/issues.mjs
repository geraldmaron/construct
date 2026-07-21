/**
 * lib/oracle/issues.mjs — idempotent beads issue raising from Oracle gaps.
 *
 * Persistent gapId fingerprints and open-bead lookup prevent duplicate tracker
 * spam. Verdict-only hygiene gaps never reach bd create — see policy.mjs.
 */

import fs from 'node:fs';

import { runBd } from '../beads-client.mjs';
import { autoRaiseEnabledForGap } from './policy.mjs';
import { routeGap } from './routing.mjs';
import { configPath } from '../config-dir.mjs';

const RAISED_FILE = 'raised-issues.jsonl';
const MAX_AUTO_RAISE_PER_TICK = 5;
const OPEN_STATUSES = new Set(['open', 'in_progress']);

function raisedPath(projectDir) {
  return configPath(projectDir, 'oracle', RAISED_FILE);
}

export function gapFingerprint(gap) {
  return String(gap?.id ?? 'unknown');
}

export function oracleBeadTitlePrefix(gapId) {
  return `[oracle/${gapId}]`;
}

function readRaised(projectDir) {
  const file = raisedPath(projectDir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function appendRaised(projectDir, record) {
  const dir = configPath(projectDir, 'oracle');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(raisedPath(projectDir), JSON.stringify(record) + '\n', 'utf8');
}

function parseBdList(output) {
  try {
    const parsed = JSON.parse(String(output ?? ''));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.issues)) return parsed.issues;
  } catch { /* empty */ }
  return [];
}

/**
 * @param {string} projectDir
 * @param {string} gapId
 * @returns {Promise<{ id: string, title: string }|null>}
 */
export async function findOpenOracleBeadForGap(projectDir, gapId) {
  const prefix = oracleBeadTitlePrefix(gapId);
  const matches = [];
  for (const status of OPEN_STATUSES) {
    const result = await runBd(['list', '--json', `--status=${status}`], {
      actor: 'oracle',
      silent: true,
      timeoutSeconds: 15,
      commandTimeoutSeconds: 30,
    });
    if (!result.success) continue;
    for (const bead of parseBdList(result.output)) {
      const title = String(bead?.title ?? '');
      if (title.startsWith(prefix)) {
        matches.push({ id: bead.id, title });
      }
    }
  }
  if (!matches.length) return null;
  return matches[0];
}

export function alreadyRaised(projectDir, fingerprint) {
  return readRaised(projectDir).some((r) => r.fingerprint === fingerprint && r.beadId);
}

/**
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {{ id: string, severity: string, detail: string, signal?: string }} opts.gap
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string, beadId?: string|null, fingerprint?: string }>}
 */
export async function raiseIssueForGap({ projectDir, gap, dryRun = false }) {
  if (!autoRaiseEnabledForGap(gap)) {
    return { ok: true, skipped: true, reason: 'verdict-only', fingerprint: gapFingerprint(gap) };
  }

  const fingerprint = gapFingerprint(gap);
  if (alreadyRaised(projectDir, fingerprint)) {
    return { ok: true, skipped: true, reason: 'already-raised', fingerprint };
  }

  const openBead = await findOpenOracleBeadForGap(projectDir, gap.id);
  if (openBead) {
    return { ok: true, skipped: true, reason: 'open-bead-exists', beadId: openBead.id, fingerprint };
  }

  const route = routeGap(gap);
  const title = `${oracleBeadTitlePrefix(gap.id)} ${String(gap.detail).slice(0, 100)}`;
  const body = JSON.stringify({
    gapId: gap.id,
    severity: gap.severity,
    signal: gap.signal ?? null,
    detail: gap.detail,
    workerProfileId: route.workerProfileId,
    fallbackWorkerProfileId: route.fallbackWorkerProfileId,
    policyId: route.policyId,
    fingerprint,
    raisedAt: new Date().toISOString(),
  }, null, 2);

  if (dryRun) {
    return { ok: true, dryRun: true, fingerprint, beadId: null };
  }

  const labels = ['oracle', 'construct-hygiene', gap.severity].join(',');
  const result = await runBd(
    ['create', title, '-t', 'task', '-l', labels, '-d', body],
    { actor: 'oracle', silent: true, timeoutSeconds: 15, commandTimeoutSeconds: 30 },
  );

  if (!result.success) {
    return { ok: false, reason: result.error || 'bd-create-failed', fingerprint };
  }

  const match = String(result.output || '').match(/Created issue:\s*([\w-]+)/);
  const beadId = match ? match[1] : null;
  appendRaised(projectDir, {
    fingerprint,
    gapId: gap.id,
    beadId,
    raisedAt: new Date().toISOString(),
    title,
  });
  return { ok: true, beadId, fingerprint };
}

/**
 * Auto-raise beads for actionable high-severity gaps with idempotency and rate limit.
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {object[]} opts.gaps
 * @param {boolean} [opts.dryRun]
 */
export async function raiseIssuesForGaps({ projectDir, gaps, dryRun = false }) {
  const actionable = gaps.filter((g) => autoRaiseEnabledForGap(g));
  const raised = [];
  for (const gap of actionable.slice(0, MAX_AUTO_RAISE_PER_TICK)) {
    const result = await raiseIssueForGap({ projectDir, gap, dryRun });
    raised.push({ gapId: gap.id, ...result });
  }
  for (const gap of gaps.filter((g) => g.severity === 'high' && !autoRaiseEnabledForGap(g))) {
    raised.push({ gapId: gap.id, ok: true, skipped: true, reason: 'verdict-only', fingerprint: gapFingerprint(gap) });
  }
  return raised;
}
