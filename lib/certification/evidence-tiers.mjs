/**
 * lib/certification/evidence-tiers.mjs — a specialist's evidence tier, derived
 * from measured certification-store runs and structural checks. The
 * authoritative alternative to a static `grade` field copied verbatim from
 * specialists/audit-enrichments.json.
 *
 * Ladder, each rung requiring genuine evidence at the rung below it:
 *   declared             — the specialist exists in the live registry (the floor).
 *   structurally-valid    — its role card, prompt/specialist-contract audit, and
 *                           role overlay (if any) all pass their static checks.
 *   behaviorally-tested   — a certification-store run for this specialist's own
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
 * A specialist with zero recorded certification runs caps at structurally-valid
 * — the honest ceiling until a scenario run actually executes and persists.
 */

import fs from 'node:fs';
import path from 'node:path';
import { roleCardsDir } from './role-cards.mjs';
import { checkSpecialistContract } from './specialist-contracts.mjs';
import { validateRoleOverlayFile } from './role-overlays.mjs';
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

function roleCardStructurallyValid(specialistId, rootDir) {
  const file = path.join(roleCardsDir(rootDir), `${specialistId}.role-card.json`);
  if (!fs.existsSync(file)) return false;
  try {
    const card = JSON.parse(fs.readFileSync(file, 'utf8'));
    return card.specialistId === specialistId && Array.isArray(card.skills) && Boolean(card.sources?.registry);
  } catch {
    return false;
  }
}

function roleOverlayStructurallyValid(roleOverlay, rootDir) {
  if (!roleOverlay) return true;
  return validateRoleOverlayFile(roleOverlay, { rootDir }).pass === true;
}

function isStructurallyValid(agent, specialistId, roleOverlay, rootDir) {
  return roleCardStructurallyValid(specialistId, rootDir)
    && checkSpecialistContract(agent, { rootDir }).pass === true
    && roleOverlayStructurallyValid(roleOverlay, rootDir);
}

// Every persisted certification run whose scenarioId belongs to this
// specialist (specialist.normal.<name>, specialist.adversarial.<name>, or
// specialist.live.<name>.* once H2 lands), newest first. Reads the whole
// store each call — fine for an infrequent audit command, not a hot path.

function specialistRuns(name, { rootDir }) {
  const prefixes = [`specialist.normal.${name}`, `specialist.adversarial.${name}`, `specialist.live.${name}.`];
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

function hostProven(_specialistId) {
  return false;
}

/**
 * @param {object} agent           the registry entry (agent.name, agent.promptFile, ...)
 * @param {string} roleOverlay     e.g. "roles/reviewer", or null
 * @param {object} [opts]          { rootDir }
 * @returns {{tier: string, reason: string, evidence: object|null}}
 */
export function computeEvidenceTier(agent, roleOverlay, { rootDir = process.cwd() } = {}) {
  const specialistId = `cx-${agent.name}`;

  if (!isStructurallyValid(agent, specialistId, roleOverlay, rootDir)) {
    return { tier: 'declared', reason: 'role card, prompt/contract audit, or role overlay check failed', evidence: null };
  }

  const runs = specialistRuns(agent.name, { rootDir });
  if (runs.length === 0) {
    return { tier: 'structurally-valid', reason: 'no certification run has ever been recorded for this specialist', evidence: null };
  }

  const liveRun = passingBehavioralRun(runs, { requireLive: true });
  if (liveRun) {
    if (hostProven(specialistId)) {
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
