/**
 * lib/oracle/invariants/registry.mjs — Layer 1 deterministic-invariant registry + runner.
 *
 * Per ADR-0091's 3-layer assurance model, a Layer 1 invariant is a named,
 * independently-runnable, mechanically-cheap check that returns a structured
 * evidence-status verdict rather than a boolean — the same shape lib/doctor/
 * watchers/*.mjs use for periodic checks ({name/id, tick/check()}), combined with
 * the frozen-array + single-entry-point shape lib/certification/evidence-tiers.mjs
 * uses for a fixed ladder of derived facts.
 *
 * Extension point: a new invariant module exports {id, layer, description, check}
 * and is added to INVARIANTS below. construct-4uxq0.12.4 (the remaining eleven
 * invariant-registry seeds from the oracle-miss-report) adds entries here; nothing
 * else in this file should need to change for that.
 */

import * as closedBeadShaReachable from './closed-bead-sha-reachable.mjs';

export const INVARIANTS = Object.freeze([
  closedBeadShaReachable,
]);

// worst-status-wins rollup, matching the rollup semantics ADR-0091 carries forward
// from the existing 3-state verdict: failed > collection-error > unknown > passed.

function worstStatus(statuses) {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('collection-error')) return 'collection-error';
  if (statuses.includes('unknown')) return 'unknown';
  return 'passed';
}

/**
 * Runs every registered invariant and rolls up their statuses. A throwing
 * invariant is caught per-invariant so one broken check cannot mask the results
 * of the others.
 *
 * @param {object} [opts] passed through to each invariant's check(opts)
 * @param {readonly {id: string, layer: number, description: string, check: Function}[]} [invariants]
 *   override for testing; defaults to the real INVARIANTS registry
 */
export async function runInvariants(opts = {}, invariants = INVARIANTS) {
  const results = [];
  for (const invariant of invariants) {
    let outcome;
    try {
      outcome = await invariant.check(opts);
    } catch (err) {
      outcome = { status: 'collection-error', detail: `invariant threw: ${err.message || err}` };
    }
    results.push({ id: invariant.id, layer: invariant.layer, description: invariant.description, ...outcome });
  }

  return { overall: worstStatus(results.map((r) => r.status)), invariants: results };
}
