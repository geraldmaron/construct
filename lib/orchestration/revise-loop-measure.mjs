/**
 * lib/orchestration/revise-loop-measure.mjs — measured go/no-go for the D10
 * critic/reviser loop (construct-72gqn.30).
 *
 * The loop is opt-in and must be measured before adoption. This scores the
 * base-chain outcome against the revise-loop outcome on the shared role-concern
 * rubric (lib/certification/comparisons.mjs — the same rubric the L5 team-vs-solo
 * comparison uses) and emits an adopt/no-adopt verdict with the coverage delta,
 * so the loop is turned on for a workload only where the revised artifact
 * demonstrably improves on the base chain rather than merely adding revision
 * rounds and provider cost. The final producer artifact — the last executed
 * non-critic output — is what a consumer actually ships, so it is what is scored,
 * not the critic's commentary.
 */

import { scoreRoleConcernCoverage } from '../certification/comparisons.mjs';

const CRITIC_ROLES = new Set(['reviewer', 'qa']);

function finalProducerOutput(run) {
  const tasks = Array.isArray(run?.tasks) ? run.tasks : [];
  const produced = tasks.filter((t) => (t.status === 'done' || t.status === 'executed')
    && t.output && !CRITIC_ROLES.has(String(t.role).replace(/^cx-/, '')));
  return produced.length ? String(produced[produced.length - 1].output) : '';
}

/**
 * @param {object} opts
 * @param {object} opts.baseRun  a run executed with the base chain (no loop)
 * @param {object} opts.loopRun  the same request executed with reviseLoop enabled
 * @returns {{ base, loop, coverageDelta, verdict, adopt, rationale }}
 */
export function scoreReviseLoop({ baseRun, loopRun } = {}) {
  const baseOut = finalProducerOutput(baseRun);
  const loopOut = finalProducerOutput(loopRun);
  const base = scoreRoleConcernCoverage(baseOut);
  const loop = scoreRoleConcernCoverage(loopOut);
  const rounds = loopRun?.revisionRounds || 0;
  const coverageDelta = loop.count - base.count;
  const adopt = coverageDelta > 0;
  return {
    base: { coverage: base, outputChars: baseOut.length },
    loop: { coverage: loop, outputChars: loopOut.length, revisionRounds: rounds },
    coverageDelta,
    adopt,
    verdict: adopt ? 'adopt-revise-loop' : 'no-adopt-revise-loop-no-measured-gain',
    rationale: adopt
      ? `The revised artifact covers ${loop.count}/${loop.total} role concerns vs ${base.count} for the base chain (+${coverageDelta}) over ${rounds} revision round(s).`
      : `The revise loop added ${rounds} round(s) with no role-concern gain (${loop.count} vs ${base.count}); not worth the extra cost for this workload.`,
  };
}
