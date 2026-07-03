/**
 * lib/extensions/validate.mjs — extension manifest validator.
 *
 * Validates a plain-JS manifest object against the canonical schema defined in
 * manifest-schema.mjs. All errors are returned in a structured result; this
 * function never throws. Error messages are single-line, actionable, and
 * prefixed with the filePath (when provided) so consumers can surface them
 * directly to users.
 */

import {
  MANIFEST_KINDS, REQUIRED_FIELDS, OPTIONAL_FIELDS, COMPAT_VERSION,
  ALLOWED_SECRET_ENV_PREFIXES, ESCALATION_SENSITIVE_KINDS,
  KNOWN_REQUESTABLE_TOOL_GRANTS, BUILTIN_SPECIALIST_IDS,
} from './manifest-schema.mjs';

/** Basic semver pattern: MAJOR.MINOR.PATCH with optional pre-release/build metadata. */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

/** Valid id characters: lowercase alphanumeric, hyphens, dots, forward slashes. */
const ID_RE = /^[a-z0-9\-./]+$/;

/**
 * validateManifest(manifest, { filePath, strict } = {})
 *
 * Returns { valid: true } on success, or { valid: false, errors: string[] }
 * on failure. Every error string is a self-contained, single-line description
 * of the problem. The filePath prefix is included in every error so callers
 * can surface messages without additional decoration.
 *
 * Checks performed (in order):
 *   1. Required fields are present.
 *   2. `kind` is one of the canonical MANIFEST_KINDS.
 *   3. `version` matches the semver pattern.
 *   4. `id` is a non-empty string matching [a-z0-9-./]+.
 *   5. `compatVersion` (if present) does not exceed COMPAT_VERSION.
 *
 * When strict is true, additional hardening checks are applied:
 *   6. No unknown fields (fields outside REQUIRED_FIELDS + OPTIONAL_FIELDS).
 *   7. secretEnvKeys entries must start with an allowed prefix.
 *   8. For escalation-sensitive kinds, toolGrantsRequested must be in
 *      KNOWN_REQUESTABLE_TOOL_GRANTS.
 *   9. Prompts targeting built-in specialists without override:true are
 *      rejected (prompt shadowing prevention).
 *  10. owner values starting with 'cx-' must be known built-in specialist ids.
 *
 * @param {unknown} manifest - The parsed manifest object to validate.
 * @param {{ filePath?: string, strict?: boolean }} [opts]
 * @returns {{ valid: true } | { valid: false, errors: string[] }}
 */
export function validateManifest(manifest, { filePath, strict = false } = {}) {
  const prefix = filePath ? `${filePath}: ` : '';
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [`${prefix}manifest must be a JSON object`] };
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in manifest) || manifest[field] === undefined || manifest[field] === null) {
      errors.push(`${prefix}missing required field: ${field}`);
    }
  }

  // If required fields are missing we may not have meaningful values for the
  // semantic checks — collect what we can, but short-circuit gracefully.

  // kind check (only if kind is present — otherwise already flagged above)
  if ('kind' in manifest && manifest.kind !== undefined && manifest.kind !== null) {
    if (!MANIFEST_KINDS.includes(manifest.kind)) {
      errors.push(
        `${prefix}unknown kind '${manifest.kind}'; expected one of: ${MANIFEST_KINDS.join(', ')}`
      );
    }
  }

  // version semver check
  if ('version' in manifest && manifest.version !== undefined && manifest.version !== null) {
    if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
      errors.push(`${prefix}version must be a semver string`);
    }
  }

  // id format check
  if ('id' in manifest && manifest.id !== undefined && manifest.id !== null) {
    if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
      errors.push(`${prefix}id must be a non-empty string`);
    } else if (!ID_RE.test(manifest.id)) {
      errors.push(`${prefix}id must match [a-z0-9-./]+ (got '${manifest.id}')`);
    }
  }

  // Forward-compat guard
  if (
    manifest.compatVersion !== undefined &&
    manifest.compatVersion !== null
  ) {
    if (typeof manifest.compatVersion !== 'number' || !Number.isInteger(manifest.compatVersion)) {
      errors.push(`${prefix}compatVersion must be an integer`);
    } else if (manifest.compatVersion > COMPAT_VERSION) {
      errors.push(
        `${prefix}compatVersion ${manifest.compatVersion} exceeds supported version ${COMPAT_VERSION}; upgrade Construct to use this manifest`
      );
    }
  }

  // Strict-mode hardening checks
  if (strict) {
    const knownFields = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);

    // Unknown field rejection
    for (const key of Object.keys(manifest)) {
      if (key.startsWith('_')) continue;
      if (!knownFields.has(key)) {
        errors.push(`${prefix}unknown field '${key}' in strict mode`);
      }
    }

    // Secret env key allowlist
    if (manifest.secretEnvKeys && Array.isArray(manifest.secretEnvKeys)) {
      for (const key of manifest.secretEnvKeys) {
        const allowed = ALLOWED_SECRET_ENV_PREFIXES.some(p => key.startsWith(p));
        if (!allowed) {
          errors.push(`${prefix}secretEnvKey '${key}' is not allowed; must start with one of: ${ALLOWED_SECRET_ENV_PREFIXES.join(', ')}`);
        }
      }
    }

    // Capability escalation checks for sensitive kinds
    if (manifest.kind && ESCALATION_SENSITIVE_KINDS.includes(manifest.kind)) {
      if (manifest.toolGrantsRequested && Array.isArray(manifest.toolGrantsRequested)) {
        for (const grant of manifest.toolGrantsRequested) {
          if (!KNOWN_REQUESTABLE_TOOL_GRANTS.includes(grant)) {
            errors.push(`${prefix}toolGrantsRequested '${grant}' is not a known tool grant`);
          }
        }
      }
    }

    // Builtin prompt shadowing prevention
    if (manifest.prompts && Array.isArray(manifest.prompts)) {
      for (const [i, prompt] of manifest.prompts.entries()) {
        if (
          prompt &&
          typeof prompt.specialist === 'string' &&
          BUILTIN_SPECIALIST_IDS.includes(prompt.specialist) &&
          !prompt.override
        ) {
          errors.push(
            `${prefix}prompts[${i}]: specialist '${prompt.specialist}' is a built-in; set "override": true to shadow`
          );
        }
      }
    }

    // Owner validation — cx- prefixed owners must be known builtins
    if (
      manifest.owner &&
      typeof manifest.owner === 'string' &&
      manifest.owner.startsWith('cx-')
    ) {
      if (!BUILTIN_SPECIALIST_IDS.includes(manifest.owner)) {
        errors.push(
          `${prefix}owner '${manifest.owner}' starts with 'cx-' but is not a known built-in specialist id`
        );
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}
