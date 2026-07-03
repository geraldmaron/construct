/**
 * lib/packs/manifest-schema.mjs — canonical pack manifest schema descriptor.
 *
 * Defines the vocabulary for pack manifests as per ADR-0055 (A5 pack schema).
 * A plain JS descriptor, not JSON Schema — the validator in validate.mjs
 * consumes it directly. The schema is intentionally additive: new optional
 * fields may be added in a minor version bump; new required fields are
 * breaking and require a PACK_COMPAT_VERSION increment.
 *
 * `embedBindings` (LMCP-E4) is one such additive field: per-specialist
 * provider read/search grants and external-write proposal grants, closing
 * the excessive-agency gap where an embedded specialist could read any
 * provider and propose any write with no declared authorization.
 */

export const PACK_REQUIRED_FIELDS = ['id', 'version', 'compatVersion'];

export const PACK_OPTIONAL_FIELDS = [
  'teams', 'specialists', 'prompts', 'frameworks', 'perspectives',
  'modelTierHints', 'toolGrantsRequested', 'workflowContributions',
  'handoffContracts', 'outputContracts', 'gates', 'tests', 'docs',
  'installConditions', 'enableConditions', 'deprecation', 'embedBindings',
];

export const PACK_COMPAT_VERSION = 1;
export const PACK_ID_RE = /^[a-z0-9\-./@]+$/;
export const PACK_SOURCE_TIERS = ['builtin', 'user', 'project'];

/**
 * embedBindings shape (LMCP-E4) — per-specialist read/propose grant.
 *
 * `embedBindings` is a pack-level map keyed by specialist id:
 *
 *   {
 *     "<specialistId>": {
 *       "providers": [
 *         { "id": "<extension-manifest-id>", "capabilities": ["read"], "filters": { ... ADR-0060 filter block ... } }
 *       ],
 *       "proposals": ["jira.createIssue"]
 *     }
 *   }
 *
 * `providers[].capabilities` values must be drawn from EMBED_BINDING_CAPABILITIES
 * and must each be declared by the referenced extension manifest's own
 * `capabilities` array — the binding cannot grant a capability the provider
 * itself never advertises. `providers[].filters` reuses the ADR-0060 provider
 * filter block verbatim (scope/predicates/nativeQuery); it is optional and,
 * when present, validated with the same rules poll-time filters use.
 * `proposals` is a flat list of `<providerId>.<writeKind>` tokens the
 * specialist may propose (never execute autonomously — see authority-guard.mjs).
 */
export const EMBED_BINDING_CAPABILITIES = ['read', 'search'];

export const EMBED_BINDING_FIELDS = ['providers', 'proposals'];

export const EMBED_BINDING_PROVIDER_FIELDS = ['id', 'capabilities', 'filters'];

export const EMBED_BINDING_PROPOSAL_RE = /^[a-z0-9-]+\.[a-zA-Z0-9]+$/;