/**
 * lib/extensions/manifest-schema.mjs — canonical extension manifest schema descriptor.
 *
 * Defines the vocabulary for extension manifests as per ADR-0052 (A2 architecture).
 * A plain JS descriptor, not JSON Schema — the validator in validate.mjs
 * consumes it directly. The schema is intentionally additive: new optional fields
 * may be added in a minor version bump; new required fields or kind removals are
 * breaking and require a COMPAT_VERSION increment.
 */

/**
 * All valid extension kind values. A manifest must declare exactly one.
 *
 * Taxonomy:
 *   model              — LLM or embedding model provider
 *   data-source        — read-only external data integration (GitHub, Jira, etc.)
 *   external-write     — write-capable integration (creates issues, PRs, etc.)
 *   embed-index        — vector index / retrieval surface
 *   mcp-tool           — MCP-protocol tool or server
 *   storage            — durable state backend (DB, blob store)
 *   queue              — async message bus or task queue
 *   telemetry          — observability sink (metrics, traces, logs)
 *   artifact-renderer  — renders Construct artifact types to output formats
 *   specialist-pack    — bundle of specialist persona definitions
 *   team-pack          — pre-wired team configuration
 *   profile-pack       — scope/profile bundle
 *   host-adapter       — IDE or host-surface integration
 */
export const MANIFEST_KINDS = [
  'model',
  'data-source',
  'external-write',
  'embed-index',
  'mcp-tool',
  'storage',
  'queue',
  'telemetry',
  'artifact-renderer',
  'specialist-pack',
  'team-pack',
  'profile-pack',
  'host-adapter',
];

/**
 * Fields every manifest must carry. Absence of any required field is a hard
 * validation error and the manifest is rejected.
 */
export const REQUIRED_FIELDS = ['id', 'version', 'kind'];

/**
 * Fields a manifest may carry. These are not validated for shape — the
 * validator checks only presence of required fields and semantic constraints.
 * Extensions that add fields outside this list are accepted but their extra
 * fields are ignored by core consumers.
 */
export const OPTIONAL_FIELDS = [
  'capabilities',
  'configSchema',
  'secretEnvKeys',
  'modes',
  'surfaces',
  'operations',
  'healthCheck',
  'dryRun',
  'idempotency',
  'rateLimit',
  'retry',
  'degradation',
  'securityClassification',
  'approvalRequirements',
  'tests',
  'docs',
  'owner',
  'compatVersion',
  'installSource',
  'removalStatus',
];

/**
 * Current schema version. A manifest with compatVersion > COMPAT_VERSION was
 * written for a newer schema than this runtime understands — load is refused
 * to prevent silent misinterpretation. Forward compatibility is not guaranteed.
 */
export const COMPAT_VERSION = 1;
