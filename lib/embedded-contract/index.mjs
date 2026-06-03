/**
 * lib/embedded-contract/index.mjs — SDK entrypoint for the Embedded Contract Layer.
 *
 * In-process applications import these functions to use Construct's app-facing
 * contracts directly. Each returns the same versioned envelope the CLI-JSON and
 * MCP surfaces emit, so a host can switch transports without reshaping its code.
 * Published to package consumers via the package.json "exports" map.
 */

import { wrapContractResult } from './envelope.mjs';
import { resolveEmbeddedModel as resolveModelCore } from './model-resolve.mjs';
import { recommendPlan as recommendPlanCore } from './triage.mjs';
import { invokeWorkflow as invokeWorkflowCore } from './workflow-invoke.mjs';
import { buildCapabilityContract } from './capability.mjs';
import { resolveExecution as resolveExecutionCore } from './execution.mjs';

export { CONTRACT_VERSION, MIN_CLIENT_CONTRACT_VERSION, isClientCompatible } from './contract-version.mjs';
export { APPROVAL_MODES } from './audit.mjs';
export { EXECUTION_MODES, CONSTRUCT_STRATEGIES, CONSTRUCT_CAPABILITIES } from './execution.mjs';

// File→text resolution for SDK callers: extract a path through the real
// pipeline (docling/whisper/transcript), then pass { text, ingestion } to
// recommendPlan/invokeWorkflow. Keeps the plan/invoke cores synchronous.

export { resolveInput as extractFileForContract } from './ingest.mjs';

/**
 * Resolve which model an embedded workflow should use. Returns a versioned
 * envelope; the resolution result is under `.data`.
 *
 * @param {object} request   See model-resolve.mjs resolveEmbeddedModel.
 * @param {object} [opts]     { env, cwd, registryPath }
 * @returns {object}
 */
export function resolveEmbeddedModel(request = {}, { env, cwd, registryPath } = {}) {
  return wrapContractResult(resolveModelCore(request, { env, registryPath }), { surface: 'sdk', env, cwd });
}

/**
 * Classify an artifact and return a role-aware plan without enqueuing or
 * executing. Returns a versioned envelope; the plan is under `.data`.
 *
 * @param {object} request   See triage.mjs recommendPlan.
 * @param {object} [opts]     { env, cwd }
 * @returns {object}
 */
export function recommendPlan(request = {}, { env, cwd } = {}) {
  return wrapContractResult(recommendPlanCore(request, { env, cwd }), { surface: 'sdk', env, cwd });
}

/**
 * Invoke an embedded workflow (roles/skills) with approval gating and
 * provenance. Async; returns a versioned envelope with the execution plan under
 * `.data`. Durable writes occur only when approvalMode is allow-durable-write.
 *
 * @param {object} request   See workflow-invoke.mjs invokeWorkflow.
 * @param {object} [opts]     { env, cwd }
 * @returns {Promise<object>}
 */
export async function invokeWorkflow(request = {}, { env, cwd } = {}) {
  return wrapContractResult(await invokeWorkflowCore(request, { env, cwd }), { surface: 'sdk', env, cwd });
}

/**
 * Describe what this Construct install can do (read-only, secret-free). Returns
 * a versioned envelope; the capability contract is under `.data`.
 *
 * @param {object} [opts]   { env, cwd, rootDir }
 * @returns {object}
 */
export function describeCapabilities({ env, cwd, rootDir } = {}) {
  return wrapContractResult(buildCapabilityContract({ env, rootDir }), { surface: 'sdk', env, cwd });
}

/**
 * Resolve the execution-capability contract for an embedded workflow: the
 * executionMode, the contributed Construct capabilities, and any degradation
 * with a reason. Returns a versioned envelope; the resolution is under `.data`.
 * Read-only; performs no model call beyond model resolution.
 *
 * @param {object} request   See execution.mjs resolveExecution.
 * @param {object} [opts]     { env, cwd, registryPath }
 * @returns {object}
 */
export function resolveExecution(request = {}, { env, cwd, registryPath } = {}) {
  return wrapContractResult(resolveExecutionCore(request, { env, cwd, registryPath }), { surface: 'sdk', env, cwd });
}
