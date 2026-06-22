/**
 * lib/oracle/reconcile.mjs — one-time cleanup for duplicate oracle hygiene beads.
 *
 * Closes duplicate open [oracle/beads-hygiene|workflow-misaligned] beads,
 * keeping the newest per gapId, and prunes stale raised-issues records.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runBd } from '../beads-client.mjs';
import { VERDICT_ONLY_GAP_IDS } from './policy.mjs';
import { oracleBeadTitlePrefix } from './issues.mjs';

const RAISED_FILE = 'raised-issues.jsonl';
const RECONCILE_GAP_IDS = [...VERDICT_ONLY_GAP_IDS].filter((id) =>
  id === 'beads-hygiene' || id === 'workflow-misaligned',
);
const OPEN_STATUSES = ['open', 'in_progress'];

function parseBdList(output) {
  try {
    const parsed = JSON.parse(String(output ?? ''));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.issues)) return parsed.issues;
  } catch { /* empty */ }
  return [];
}

function beadUpdatedAt(bead) {
  const raw = bead?.updated || bead?.updatedAt || bead?.created || bead?.createdAt;
  const ts = Date.parse(String(raw ?? ''));
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * @returns {Promise<Array<{ id: string, title: string, gapId: string, status: string, updatedAt: number }>>}
 */
export async function listOpenOracleHygieneBeads() {
  const found = [];
  for (const status of OPEN_STATUSES) {
    const result = await runBd(['list', '--json', `--status=${status}`], {
      actor: 'oracle-reconcile',
      silent: true,
      timeoutSeconds: 20,
      commandTimeoutSeconds: 40,
    });
    if (!result.success) continue;
    for (const bead of parseBdList(result.output)) {
      const title = String(bead?.title ?? '');
      for (const gapId of RECONCILE_GAP_IDS) {
        if (title.startsWith(oracleBeadTitlePrefix(gapId))) {
          found.push({
            id: bead.id,
            title,
            gapId,
            status,
            updatedAt: beadUpdatedAt(bead),
          });
        }
      }
    }
  }
  return found;
}

/**
 * @param {Array<{ id: string, gapId: string, updatedAt: number }>} beads
 * @returns {{ keep: Map<string, string>, close: string[] }}
 */
export function planHygieneReconcile(beads) {
  if (!beads.length) return { keep: new Map(), close: [] };
  return {
    keep: new Map(),
    close: beads.map((bead) => bead.id),
  };
}

function pruneRaisedIssues(projectDir, { dryRun = false } = {}) {
  const file = path.join(projectDir, '.cx', 'oracle', RAISED_FILE);
  if (!fs.existsSync(file)) return { pruned: 0 };
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const kept = rows.filter((r) => !RECONCILE_GAP_IDS.includes(r.gapId));
  const pruned = rows.length - kept.length;
  if (!dryRun && pruned > 0) {
    fs.writeFileSync(file, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
  }
  return { pruned };
}

/**
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {boolean} [opts.dryRun]
 */
export async function reconcileOracleHygieneBeads({ projectDir, dryRun = false }) {
  const beads = await listOpenOracleHygieneBeads();
  const { keep, close } = planHygieneReconcile(beads);
  const closed = [];
  const reason = 'Oracle verdict-only policy: hygiene gaps no longer auto-raise beads; duplicate closed by reconcile.';

  if (!dryRun) {
    for (const beadId of close) {
      const result = await runBd(['close', beadId, '--reason', reason], {
        actor: 'oracle-reconcile',
        silent: true,
        timeoutSeconds: 15,
        commandTimeoutSeconds: 30,
      });
      if (result.success) closed.push(beadId);
    }
  }

  const prune = pruneRaisedIssues(projectDir, { dryRun });

  return {
    ok: true,
    dryRun,
    found: beads.length,
    kept: Object.fromEntries(keep),
    plannedClose: close,
    closed: dryRun ? [] : closed,
    raisedPruned: prune.pruned,
    reason,
  };
}
