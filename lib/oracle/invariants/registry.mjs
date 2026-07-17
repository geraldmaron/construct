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
 * and is added to INVARIANTS below. construct-4uxq0.12.4 added the 8 Layer 1 seeds
 * below that hold up against the current codebase (1 of the report's 9 named Layer 1
 * seeds, due-detection-does-not-equal-completion, was skipped — see that bead's notes);
 * its 3 Layer-2 edge types are a separate layer, deferred to construct-4uxq0.12.5.
 */

import * as closedBeadShaReachable from './closed-bead-sha-reachable.mjs';
import * as testsNeverWriteRealUserState from './tests-never-write-real-user-state.mjs';
import * as deploymentWorkflowTargetsRealArtifacts from './deployment-workflow-targets-real-artifacts.mjs';
import * as configSchemaHasNoShadowedProperties from './config-schema-has-no-shadowed-properties.mjs';
import * as configRoundtripPreservesDeclaredFields from './config-roundtrip-preserves-declared-fields.mjs';
import * as cliReferencesResolveToRealHandlers from './cli-references-resolve-to-real-handlers.mjs';
import * as analysisSuccessRequiresExecutionEvidence from './analysis-success-requires-execution-evidence.mjs';
import * as externalWriteHasIdempotencyAndReconciliation from './external-write-has-idempotency-and-reconciliation.mjs';
import * as crossProcessStateHasOneAuthoritativeLocation from './cross-process-state-has-one-authoritative-location.mjs';

export const INVARIANTS = Object.freeze([
  closedBeadShaReachable,
  testsNeverWriteRealUserState,
  deploymentWorkflowTargetsRealArtifacts,
  configSchemaHasNoShadowedProperties,
  configRoundtripPreservesDeclaredFields,
  cliReferencesResolveToRealHandlers,
  analysisSuccessRequiresExecutionEvidence,
  externalWriteHasIdempotencyAndReconciliation,
  crossProcessStateHasOneAuthoritativeLocation,
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
