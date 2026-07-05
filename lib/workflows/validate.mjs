/**
 * lib/workflows/validate.mjs — workflow manifest validator.
 *
 * Validates a plain-JS manifest object against the canonical schema defined in
 * manifest-schema.mjs. All errors are returned in a structured result; this
 * function never throws. Error messages are single-line, actionable, and
 * prefixed with the filePath (when provided) so consumers can surface them
 * directly to users.
 */

import {
  WORKFLOW_TYPES, WORKFLOW_REQUIRED_FIELDS, WORKFLOW_OPTIONAL_FIELDS,
  WORKFLOW_COMPAT_VERSION, APPROVAL_MODES,
} from './manifest-schema.mjs';

/** Basic semver pattern: MAJOR.MINOR.PATCH with optional pre-release/build metadata. */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

/** Valid id characters: lowercase alphanumeric, hyphens, dots, forward slashes. */
const ID_RE = /^[a-z0-9\-./]+$/;

/**
 * validateWorkflowManifest(manifest, { filePath, strict } = {})
 *
 * Returns { valid: true } on success, or { valid: false, errors: string[] }
 * on failure. Every error string is a self-contained, single-line description
 * of the problem. The filePath prefix is included in every error so callers
 * can surface messages without additional decoration.
 *
 * Checks performed (in order):
 *   1. Manifest is a non-null object.
 *   2. Required fields are present.
 *   3. `type` is one of the canonical WORKFLOW_TYPES.
 *   4. `version` matches the semver pattern.
 *   5. `id` is a non-empty string matching [a-z0-9-./]+.
 *   6. `compatVersion` (if present) does not exceed WORKFLOW_COMPAT_VERSION.
 *   7. `defaultApprovalMode` is one of APPROVAL_MODES.
 *
 * When strict is true, unknown fields (outside REQUIRED + OPTIONAL) are rejected.
 *
 * @param {unknown} manifest - The parsed manifest object to validate.
 * @param {{ filePath?: string, strict?: boolean }} [opts]
 * @returns {{ valid: true } | { valid: false, errors: string[] }}
 */
export function validateWorkflowManifest(manifest, { filePath, strict = false } = {}) {
  const prefix = filePath ? `${filePath}: ` : '';
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [`${prefix}manifest must be a JSON object`] };
  }

  // Required fields
  for (const field of WORKFLOW_REQUIRED_FIELDS) {
    if (!(field in manifest) || manifest[field] === undefined || manifest[field] === null) {
      errors.push(`${prefix}missing required field: ${field}`);
    }
  }

  // type check (only if type is present — otherwise already flagged above)
  if ('type' in manifest && manifest.type !== undefined && manifest.type !== null) {
    if (!WORKFLOW_TYPES.includes(manifest.type)) {
      errors.push(
        `${prefix}unknown type '${manifest.type}'; expected one of: ${WORKFLOW_TYPES.join(', ')}`
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
    } else if (manifest.compatVersion > WORKFLOW_COMPAT_VERSION) {
      errors.push(
        `${prefix}compatVersion ${manifest.compatVersion} exceeds supported version ${WORKFLOW_COMPAT_VERSION}; upgrade Construct to use this manifest`
      );
    }
  }

  // defaultApprovalMode check
  if (
    'defaultApprovalMode' in manifest &&
    manifest.defaultApprovalMode !== undefined &&
    manifest.defaultApprovalMode !== null
  ) {
    if (!APPROVAL_MODES.includes(manifest.defaultApprovalMode)) {
      errors.push(
        `${prefix}defaultApprovalMode must be one of: ${APPROVAL_MODES.join(', ')} (got '${manifest.defaultApprovalMode}')`
      );
    }
  }

  // Strict-mode hardening: reject unknown fields
  if (strict) {
    const knownFields = new Set([...WORKFLOW_REQUIRED_FIELDS, ...WORKFLOW_OPTIONAL_FIELDS]);
    for (const key of Object.keys(manifest)) {
      if (key.startsWith('_')) continue;
      if (!knownFields.has(key)) {
        errors.push(`${prefix}unknown field '${key}' in strict mode`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}