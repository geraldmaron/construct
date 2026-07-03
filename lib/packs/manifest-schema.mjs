/**
 * lib/packs/manifest-schema.mjs — canonical pack manifest schema descriptor.
 *
 * Defines the vocabulary for pack manifests as per ADR-0055 (A5 pack schema).
 * A plain JS descriptor, not JSON Schema — the validator in validate.mjs
 * consumes it directly. The schema is intentionally additive: new optional
 * fields may be added in a minor version bump; new required fields are
 * breaking and require a PACK_COMPAT_VERSION increment.
 */

export const PACK_REQUIRED_FIELDS = ['id', 'version', 'compatVersion'];

export const PACK_OPTIONAL_FIELDS = [
  'teams', 'specialists', 'prompts', 'perspectives',
  'modelTierHints', 'toolGrantsRequested', 'workflowContributions',
  'handoffContracts', 'outputContracts', 'gates', 'tests', 'docs',
  'installConditions', 'enableConditions', 'deprecation',
];

export const PACK_COMPAT_VERSION = 1;
export const PACK_ID_RE = /^[a-z0-9\-./@]+$/;
export const PACK_SOURCE_TIERS = ['builtin', 'user', 'project'];