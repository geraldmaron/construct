/**
 * lib/oracle/issues.mjs — idempotent beads issue raising from Oracle gaps.
 *
 * Fingerprints gap id + calendar day to avoid duplicate spam. Records raised
 * ids in .cx/oracle/raised-issues.jsonl for traceability.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runBd } from '../beads-client.mjs';
import { routeGap } from './routing.mjs';

const RAISED_FILE = 'raised-issues.jsonl';
const MAX_AUTO_RAISE_PER_TICK = 5;

function raisedPath(projectDir) {
  return path.join(projectDir, '.cx', 'oracle', RAISED_FILE);
}

export function gapFingerprint(gap, date = new Date()) {
  const day = date.toISOString().slice(0, 10);
  return `${gap.id}:${day}`;
}

function readRaised(projectDir) {
  const file = raisedPath(projectDir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function appendRaised(projectDir, record) {
  const dir = path.join(projectDir, '.cx', 'oracle');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(raisedPath(projectDir), JSON.stringify(record) + '\n', 'utf8');
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
  const fingerprint = gapFingerprint(gap);
  if (alreadyRaised(projectDir, fingerprint)) {
    return { ok: true, skipped: true, reason: 'already-raised', fingerprint };
  }

  const route = routeGap(gap);
  const title = `[oracle/${gap.id}] ${String(gap.detail).slice(0, 100)}`;
  const body = JSON.stringify({
    gapId: gap.id,
    severity: gap.severity,
    signal: gap.signal ?? null,
    detail: gap.detail,
    route: route.primary,
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
 * Auto-raise beads for high-severity gaps with idempotency and rate limit.
 *
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {object[]} opts.gaps
 * @param {boolean} [opts.dryRun]
 */
export async function raiseIssuesForGaps({ projectDir, gaps, dryRun = false }) {
  const high = gaps.filter((g) => g.severity === 'high');
  const raised = [];
  for (const gap of high.slice(0, MAX_AUTO_RAISE_PER_TICK)) {
    const result = await raiseIssueForGap({ projectDir, gap, dryRun });
    raised.push({ gapId: gap.id, ...result });
  }
  return raised;
}
