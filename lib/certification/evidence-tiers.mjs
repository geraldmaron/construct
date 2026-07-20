/**
 * Derive a Worker Profile's evidence tier from measured certification runs
 * from measured certification-store runs and structural checks. The
 * and structural checks.
 *
 * Ladder, each rung requiring genuine evidence at the rung below it:
 *   declared             — the Worker Profile exists in the canonical registry.
 *   structurally-valid    — its card, prompt contract, and perspective pass.
 *   behaviorally-tested   — a certification-store run for this Worker Profile's
 *                           scenario passed a behavioral gate (BEHAVIORAL_GATE_TYPES),
 *                           not merely fixture-shape validation, at any model tier.
 *   live-tested           — same, but the run's model tier is not 'hermetic' and
 *                           its verdict was not a skipped-provider inconclusive
 *                           (a skipped-provider verdict can never be 'pass' —
 *                           lib/certification/run.mjs already enforces that).
 *   host-proven           — an orchestration run-store record shows a task for
 *                           the role at executionState 'executed' with
 *                           contractStatus 'ok'.
 *
 * A Worker Profile with zero recorded certification runs caps at structurally-valid
 * — the honest ceiling until a scenario run actually executes and persists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { workerProfileCardsDir } from './worker-profile-cards.mjs';
import { checkWorkerProfileContract } from './worker-profile-contracts.mjs';
import { validatePerspectiveFile } from './perspectives.mjs';
import { listCertificationRunIds, readCertificationRun } from './store.mjs';

export const EVIDENCE_TIERS = Object.freeze([
  'declared',
  'structurally-valid',
  'behaviorally-tested',
  'live-tested',
  'host-proven',
]);

// The only gate type that certifies real behavior was scored, not merely that
// a fixture's shape is well-formed. specialist-scenario-audit (today's only
// specialist gate) validates fixture structure — it never sends a prompt to a
// model — so it does not appear here and cannot lift a specialist past
// structurally-valid on its own.

const BEHAVIORAL_GATE_TYPES = new Set(['specialist-behavior-live']);

function workerProfileCardStructurallyValid(workerProfileId, rootDir) {
  const file = path.join(workerProfileCardsDir(rootDir), `${workerProfileId}.role-card.json`);
  if (!fs.existsSync(file)) return false;
  try {
    const card = JSON.parse(fs.readFileSync(file, 'utf8'));
    return card.workerProfileId === workerProfileId && Array.isArray(card.skillEmphasis) && Boolean(card.sources?.registry);
  } catch {
    return false;
  }
}

function perspectiveStructurallyValid(perspective, rootDir) {
  if (!perspective) return true;
  return validatePerspectiveFile(perspective, { rootDir }).pass === true;
}

function isStructurallyValid(profile, workerProfileId, perspective, rootDir) {
  return workerProfileCardStructurallyValid(workerProfileId, rootDir)
    && checkWorkerProfileContract(profile, { rootDir }).pass === true
    && perspectiveStructurallyValid(perspective, rootDir);
}

// Every persisted certification run whose scenarioId belongs to this
// Worker Profile — the hermetic per-kind scenarios (worker-profile.<kind>.<name>)
// and the live behavioral runs (worker-profile.live.<name>.*) — newest first.
// Reads the whole store each call — fine for an infrequent audit command, not a hot path.

function workerProfileRuns(name, { rootDir }) {
  const prefixes = [
    `worker-profile.happy-path-representative.${name}`,
    `worker-profile.adversarial-role-tailored.${name}`,
    `worker-profile.ambiguous.${name}`,
    `worker-profile.boundary-violation.${name}`,
    `worker-profile.cross-worker-profile.${name}`,
    `worker-profile.live.${name}.`,
  ];
  const runs = [];
  for (const runId of listCertificationRunIds({ rootDir })) {
    let run;
    try { ({ run } = readCertificationRun(runId, { rootDir })); } catch { continue; }
    if (prefixes.some((p) => run.scenarioId === p || run.scenarioId?.startsWith(p))) runs.push(run);
  }
  return runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function passingBehavioralRun(runs, { requireLive } = {}) {
  return runs.find((run) => {
    if (run.verdict?.status !== 'pass') return false;
    if (!run.gates?.some((g) => BEHAVIORAL_GATE_TYPES.has(g.type) && g.pass)) return false;
    if (requireLive) {
      if (run.model?.tier === 'hermetic') return false;
      if (run.verdict?.source === 'skipped-provider') return false;
    }
    return true;
  });
}

// True once H6b/c populate task.contractStatus on real orchestrated handoffs —
// today no run ever sets it, so this is always false and the ceiling below it
// (live-tested) is honest.

function hostProven(_workerProfileId) {
  return false;
}

/**
 * @param {object} profile         canonical Worker Profile registry entry
 * @param {string} perspective     e.g. "perspectives/reviewer", or null
 * @param {object} [opts]          { rootDir }
 * @returns {{tier: string, reason: string, evidence: object|null}}
 */
export function computeEvidenceTier(profile, perspective, { rootDir = process.cwd() } = {}) {
  const workerProfileId = profile.id;

  if (!isStructurallyValid(profile, workerProfileId, perspective, rootDir)) {
    return { tier: 'declared', reason: 'Worker Profile card, prompt contract, or perspective check failed', evidence: null };
  }

  const runs = workerProfileRuns(workerProfileId, { rootDir });
  if (runs.length === 0) {
    return { tier: 'structurally-valid', reason: 'no certification run has been recorded for this Worker Profile', evidence: null };
  }

  const liveRun = passingBehavioralRun(runs, { requireLive: true });
  if (liveRun) {
    if (hostProven(workerProfileId)) {
      return { tier: 'host-proven', reason: 'a real orchestrated handoff completed with a passing contract check', evidence: { runId: liveRun.id, createdAt: liveRun.createdAt } };
    }
    return { tier: 'live-tested', reason: 'a live-model behavioral scenario passed', evidence: { runId: liveRun.id, createdAt: liveRun.createdAt } };
  }

  const behavioralRun = passingBehavioralRun(runs);
  if (behavioralRun) {
    return { tier: 'behaviorally-tested', reason: 'a hermetic behavioral scenario passed; no live-model run recorded yet', evidence: { runId: behavioralRun.id, createdAt: behavioralRun.createdAt } };
  }

  const latest = runs[0];
  return {
    tier: 'structurally-valid',
    reason: `latest run (${latest.id}) only validated fixture structure — no behavioral gate has passed`,
    evidence: { runId: latest.id, createdAt: latest.createdAt },
  };
}
