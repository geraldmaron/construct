/**
 * lib/workflows/manifest-schema.mjs — canonical workflow manifest schema descriptor.
 *
 * Defines the vocabulary for workflow manifests as per ADR-0054 (LMCP-A4).
 * A plain JS descriptor, not JSON Schema — the validator in validate.mjs
 * consumes it directly. The schema is intentionally additive: new optional fields
 * may be added in a minor version bump; new required fields or type removals are
 * breaking and require a COMPAT_VERSION increment.
 */

/**
 * All valid workflow type values. These correspond to the execution topologies
 * the orchestration runtime can dispatch.
 */
export const WORKFLOW_TYPES = ['linear', 'routing', 'orchestrator-worker', 'evaluator-loop', 'pipeline'];

/**
 * Fields every workflow manifest must carry. Absence of any required field is a
 * hard validation error and the manifest is rejected.
 */
export const WORKFLOW_REQUIRED_FIELDS = ['id', 'version', 'type', 'defaultApprovalMode'];

/**
 * Fields a workflow manifest may carry. These are not validated for shape — the
 * validator checks only presence of required fields and semantic constraints.
 * Manifests that add fields outside this list are accepted but their extra
 * fields are ignored by core consumers.
 */
export const WORKFLOW_OPTIONAL_FIELDS = [
  'modes', 'surfaces', 'inputSchema', 'outputSchema',
  'roleChain', 'packRequirements', 'providerRequirements',
  'toolGrants', 'policyGates', 'durableStateModel',
  'telemetryEvents', 'tests', 'docs', 'examples',
  'degradation', 'owner', 'compatVersion', 'description', 'tier',
];

/**
 * Current schema version. A manifest with compatVersion > WORKFLOW_COMPAT_VERSION
 * was written for a newer schema than this runtime understands — load is refused
 * to prevent silent misinterpretation. Forward compatibility is not guaranteed.
 */
export const WORKFLOW_COMPAT_VERSION = 1;

/**
 * All valid approval mode values. These govern whether a workflow run proceeds
 * without human intervention or requires explicit approval at one or more gates.
 */
export const APPROVAL_MODES = ['proposal-only', 'requires-human-approval', 'allow-durable-write'];

/**
 * All valid durable state model values. These describe how the workflow runtime
 * persists intermediate state across invocations for resumability and audit.
 */
export const DURABLE_STATE_MODELS = ['none', 'git-queue', 'in-process'];

/**
 * All valid model tier values. These hint at the minimum model capability the
 * orchestrator should assign to the workflow, from fastest/cheapest to most
 * capable/expensive.
 */
export const TIERS = ['fast', 'standard', 'reasoning'];