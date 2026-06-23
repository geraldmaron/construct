/**
 * lib/contracts/construct-handoff.mjs — normalize construct→orchestrator handoffs.
 *
 * MCP callers often pass only `goal`; enrich from orchestration_policy before
 * validateHandoff so incomplete packets do not flood contract-violations.jsonl.
 */

import { buildConstructToOrchestratorPacket, routeRequest } from '../orchestration-policy.mjs';

export const CONSTRUCT_ORCHESTRATOR_REQUIRED = Object.freeze([
  'goal',
  'intent',
  'workCategory',
  'riskFlags',
  'acceptanceCriteria',
]);

export function needsConstructHandoffEnrichment(artifact) {
  if (!artifact || typeof artifact !== 'object') return false;
  return CONSTRUCT_ORCHESTRATOR_REQUIRED.some((field) => !Object.prototype.hasOwnProperty.call(artifact, field));
}

/**
 * @param {object} artifact — partial or full handoff packet
 * @param {object} [opts]
 * @param {string} [opts.request]
 * @param {number} [opts.fileCount]
 * @param {number} [opts.moduleCount]
 * @param {boolean} [opts.introducesContract]
 */
export function enrichConstructOrchestratorHandoff(artifact, opts = {}) {
  if (!needsConstructHandoffEnrichment(artifact)) return artifact;
  const request = String(opts.request || artifact.goal || artifact.request || '').trim();
  const routeOpts = {
    request,
    fileCount: opts.fileCount ?? artifact.fileCount ?? 0,
    moduleCount: opts.moduleCount ?? artifact.moduleCount ?? 0,
    introducesContract: opts.introducesContract ?? artifact.introducesContract ?? false,
  };
  const built = buildConstructToOrchestratorPacket({
    ...routeOpts,
    goal: artifact.goal,
    acceptanceCriteria: artifact.acceptanceCriteria,
  });
  if (built) return { ...built, ...artifact };

  const route = routeRequest(routeOpts);
  const goal = String(artifact.goal || request || 'User-requested work').trim();
  const acceptanceCriteria = Array.isArray(artifact.acceptanceCriteria) && artifact.acceptanceCriteria.length
    ? artifact.acceptanceCriteria
    : ['Dispatch plan emitted with specialists in sequence', 'Acceptance criteria verified before close'];
  return {
    goal,
    intent: route.intent,
    workCategory: route.workCategory,
    riskFlags: route.riskFlags || {},
    acceptanceCriteria,
    ...artifact,
  };
}
