/**
 * lib/extensions/validate.mjs — extension manifest validator.
 *
 * Validates a plain-JS manifest object against the canonical schema defined in
 * manifest-schema.mjs. All errors are returned in a structured result; this
 * function never throws. Error messages are single-line, actionable, and
 * prefixed with the filePath (when provided) so consumers can surface them
 * directly to users.
 */

import { MANIFEST_KINDS, REQUIRED_FIELDS, COMPAT_VERSION } from './manifest-schema.mjs';

/** Basic semver pattern: MAJOR.MINOR.PATCH with optional pre-release/build metadata. */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

/** Valid id characters: lowercase alphanumeric, hyphens, dots, forward slashes. */
const ID_RE = /^[a-z0-9\-./]+$/;

/**
 * validateManifest(manifest, { filePath } = {})
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
 * @param {unknown} manifest - The parsed manifest object to validate.
 * @param {{ filePath?: string }} [opts]
 * @returns {{ valid: true } | { valid: false, errors: string[] }}
 */
export function validateManifest(manifest, { filePath } = {}) {
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

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}
