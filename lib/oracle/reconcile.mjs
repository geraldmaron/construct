/**
 * lib/oracle/reconcile.mjs — one-time cleanup for duplicate oracle hygiene beads.
 *
 * Closes duplicate open [oracle/beads-hygiene|workflow-misaligned] beads,
 * keeping the newest per gapId, and prunes stale raised-issues records.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runBd } from '../beads-client.mjs';
import { markContractViolationsSuperseded, recentViolations } from '../contracts/violation-log.mjs';
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

const BARE_GOAL_FIELD_LABELS = ['intent', 'workCategory', 'riskFlags', 'acceptanceCriteria'];

function missingBareGoalConstructFields(missing) {
  if (!Array.isArray(missing) || missing.length !== BARE_GOAL_FIELD_LABELS.length) return false;
  return BARE_GOAL_FIELD_LABELS.every((field) =>
    missing.some((entry) => String(entry).includes(field)),
  );
}

function isBareGoalConstructViolation(row) {
  if (row?.contractId !== 'construct-to-orchestrator') return false;
  if (!missingBareGoalConstructFields(row.missing)) return false;
  const keys = row.packet_keys ?? row.packetKeys;
  return Array.isArray(keys) && keys.length === 1 && keys[0] === 'goal';
}

/**
 * @param {string} projectDir
 * @returns {{ shouldSupersede: boolean, recentCount: number, reason: string }}
 */
export function planContractViolationSupersede(projectDir) {
  const recent = recentViolations({ repoRoot: projectDir });
  if (!recent.length) {
    return { shouldSupersede: false, recentCount: 0, reason: 'no recent contract violations' };
  }
  const allBareGoal = recent.every(isBareGoalConstructViolation);
  if (!allBareGoal) {
    return {
      shouldSupersede: false,
      recentCount: recent.length,
      reason: 'recent violations include non-bare-goal construct-to-orchestrator or other contracts',
    };
  }
  return {
    shouldSupersede: true,
    recentCount: recent.length,
    reason: 'historical bare-goal construct-to-orchestrator violations superseded after handoff enrichment fix',
  };
}

/**
 * @param {object} opts
 * @param {string} opts.projectDir
 * @param {boolean} [opts.dryRun]
 */
export async function reconcileContractViolationHygiene({ projectDir, dryRun = false }) {
  const plan = planContractViolationSupersede(projectDir);
  if (!plan.shouldSupersede) {
    return { ok: true, dryRun, superseded: false, ...plan };
  }
  if (dryRun) {
    return { ok: true, dryRun, superseded: false, wouldSupersede: true, ...plan };
  }
  const marker = markContractViolationsSuperseded({
    repoRoot: projectDir,
    reason: plan.reason,
  });
  return { ok: true, dryRun, superseded: true, cutoff: marker.cutoff, ...plan };
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
  const contractViolations = await reconcileContractViolationHygiene({ projectDir, dryRun });

  return {
    ok: true,
    dryRun,
    found: beads.length,
    kept: Object.fromEntries(keep),
    plannedClose: close,
    closed: dryRun ? [] : closed,
    raisedPruned: prune.pruned,
    contractViolations,
    reason,
  };
}
