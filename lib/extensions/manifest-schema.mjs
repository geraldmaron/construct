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
 *   ingestion-provider — local document/audio ingestion sidecar (docling, whisper)
 *                        provisioned outside npm; declares an install probe, a
 *                        health check, and a degradation chain (LMCP-K2).
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
  'ingestion-provider',
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
  'installDependencies',
  'installProbe',
  'removalStatus',
  'prompts',
  'toolGrantsRequested',
  'sourceTarget',
  'certification',
  'writeNotes',
  'certification',
];

/**
 * Valid certification.tier values for provider manifests. Matches the ladder in
 * lib/certification/provider-evidence-tiers.mjs (kept in sync manually).
 */
export const PROVIDER_CERTIFICATION_TIER_VALUES = [
  'declared',
  'structurally-validated',
  'contract-tested',
  'process-boundary-tested',
  'live-sandbox-tested',
  'production-proven',
];

/**
 * Current schema version. A manifest with compatVersion > COMPAT_VERSION was
 * written for a newer schema than this runtime understands — load is refused
 * to prevent silent misinterpretation. Forward compatibility is not guaranteed.
 */
export const COMPAT_VERSION = 1;

/**
 * Environment variable prefixes that extension manifests are allowed to
 * request via `secretEnvKeys`. Any env key that does not start with one of
 * these prefixes is rejected in strict mode to prevent credential exfiltration
 * via extension manifests.
 */
export const ALLOWED_SECRET_ENV_PREFIXES = [
  'GITHUB_', 'GH_', 'JIRA_', 'CONFLUENCE_', 'SLACK_', 'SALESFORCE_',
  'ANTHROPIC_', 'OPENAI_', 'GOOGLE_', 'DEEPSEEK_', 'CONSTRUCT_',
  'AWS_', 'AZURE_', 'DATADOG_', 'SENTRY_', 'LINEAR_', 'NOTION_',
  'OPENROUTER_', 'OPEN_ROUTER_',
];

/**
 * Manifest kinds that are considered capability-escalation-sensitive.
 * Manifests of these kinds are subject to additional checks in strict mode
 * (e.g., tool grant allowlisting, builtin prompt shadowing).
 */
export const ESCALATION_SENSITIVE_KINDS = [
  'specialist-pack', 'team-pack', 'data-source', 'mcp-tool', 'external-write',
];

/**
 * Known tool grant identifiers that manifests may request. These correspond
 * to the A6 policy model capability grants. Any grant requested outside this
 * set is rejected in strict mode.
 */
export const KNOWN_REQUESTABLE_TOOL_GRANTS = [
  'shell', 'exec', 'network', 'filesystem', 'webhook', 'admin', 'config',
];

/**
 * Built-in specialist persona ids shipped with Construct. Manifests that
 * declare prompts targeting these ids without `override: true` are rejected
 * in strict mode to prevent accidental or malicious prompt shadowing.
 *
 * Reflects the 12-role roster (11 workers + orchestrator) from
 * construct-rf26.11's specialist consolidation. The pre-consolidation list
 * was already stale (missing several real ids, and listed a non-existent
 * 'cx-operator') — this is a full replacement, not an incremental edit.
 */
export const BUILTIN_SPECIALIST_IDS = [
  'orchestrator', 'architect', 'reviewer', 'engineer',
  'debugger', 'qa', 'security', 'operations',
  'product-manager', 'data-analyst', 'designer', 'researcher',
];
