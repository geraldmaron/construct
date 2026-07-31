/**
 * Canonical Procedure record schema descriptor.
 *
 * Defines the vocabulary for Procedure records.
 * A plain JS descriptor, not JSON Schema — the validator in validate.mjs
 * consumes it directly. The schema is intentionally additive: new optional fields
 * may be added in a minor version bump; new required fields or type removals are
 * breaking and require a COMPAT_VERSION increment.
 */

/**
 * All valid workflow type values. These correspond to the execution topologies
 * the orchestration runtime can dispatch. `embed` is a
 * workflow-manifest specialization carrying an `embed` block rather than a
 * dispatchable topology — it reuses this schema's id/version/tiering rules
 * instead of forking a second manifest system.
 */
export const PROCEDURE_TYPES = ['linear', 'routing', 'orchestrator-worker', 'evaluator-loop', 'pipeline', 'embed'];

/**
 * Fields every workflow manifest must carry. Absence of any required field is a
 * hard validation error and the manifest is rejected.
 */
export const PROCEDURE_REQUIRED_FIELDS = [
  'id', 'version', 'type', 'workerProfiles', 'approvalMode', 'modelTier', 'state',
];

/**
 * Fields a workflow manifest may carry. These are not validated for shape — the
 * validator checks only presence of required fields and semantic constraints.
 * Manifests that add fields outside this list are accepted but their extra
 * fields are ignored by core consumers.
 *
 * `intakeType` lets a pack or project manifest claim a triage
 * classifier label without editing the hardcoded INTAKE_TO_WORKFLOW table in
 * lib/embedded-contract/procedure-definitions.mjs rebuilds that table from
 * every loaded manifest's `intakeType` field, project/pack entries applied
 * after builtins so a contributed manifest can add or remap a label.
 */
export const PROCEDURE_OPTIONAL_FIELDS = [
  'modes', 'surfaces', 'inputSchema', 'outputSchema',
  'workerProfiles', 'packRequirements', 'providerRequirements',
  'toolGrants', 'policyGates', 'durableStateModel',
  'telemetryEvents', 'tests', 'docs', 'examples',
  'degradation', 'owner', 'schemaVersion', 'description', 'intakeType', 'embed',
];

/**
 * Current schema version. A manifest with compatVersion > PROCEDURE_SCHEMA_VERSION
 * was written for a newer schema than this runtime understands — load is refused
 * to prevent silent misinterpretation. Forward compatibility is not guaranteed.
 */
export const PROCEDURE_SCHEMA_VERSION = 1;

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
export const MODEL_TIERS = ['cheap', 'standard', 'strong'];

export const PROCEDURE_STATES = ['defined', 'active', 'retired', 'removed'];
