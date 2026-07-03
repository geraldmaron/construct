/**
 * lib/packs/validate.mjs — pack manifest validator.
 *
 * Validates a plain-JS pack manifest object against the canonical schema
 * defined in manifest-schema.mjs. All errors are returned in a structured
 * result; this function never throws. Error messages are single-line,
 * actionable, and prefixed with the filePath (when provided).
 */

import {
  PACK_REQUIRED_FIELDS, PACK_OPTIONAL_FIELDS, PACK_COMPAT_VERSION,
} from './manifest-schema.mjs';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const PACK_ID_RE = /^[a-z0-9\-./@]+$/;

export function validatePackManifest(manifest, { filePath, strict = false } = {}) {
  const prefix = filePath ? `${filePath}: ` : '';
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [`${prefix}manifest must be a JSON object`] };
  }

  for (const field of PACK_REQUIRED_FIELDS) {
    if (!(field in manifest) || manifest[field] === undefined || manifest[field] === null) {
      errors.push(`${prefix}missing required field: ${field}`);
    }
  }

  if ('id' in manifest && manifest.id !== undefined && manifest.id !== null) {
    if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
      errors.push(`${prefix}id must be a non-empty string`);
    } else if (!PACK_ID_RE.test(manifest.id)) {
      errors.push(`${prefix}id must match [a-z0-9-./@]+ (got '${manifest.id}')`);
    }
  }

  if ('version' in manifest && manifest.version !== undefined && manifest.version !== null) {
    if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
      errors.push(`${prefix}version must be a semver string`);
    }
  }

  if (manifest.compatVersion !== undefined && manifest.compatVersion !== null) {
    if (typeof manifest.compatVersion !== 'number' || !Number.isInteger(manifest.compatVersion)) {
      errors.push(`${prefix}compatVersion must be an integer`);
    } else if (manifest.compatVersion > PACK_COMPAT_VERSION) {
      errors.push(
        `${prefix}compatVersion ${manifest.compatVersion} exceeds supported version ${PACK_COMPAT_VERSION}; upgrade Construct to use this pack`
      );
    }
  }

  if (manifest.deprecation !== undefined && manifest.deprecation !== null) {
    if (typeof manifest.deprecation !== 'object' || Array.isArray(manifest.deprecation)) {
      errors.push(`${prefix}deprecation must be an object`);
    } else {
      if (!('since' in manifest.deprecation)) {
        errors.push(`${prefix}deprecation must include 'since' field`);
      }
      if (!('message' in manifest.deprecation)) {
        errors.push(`${prefix}deprecation must include 'message' field`);
      }
    }
  }

  if (strict) {
    const knownFields = new Set([...PACK_REQUIRED_FIELDS, ...PACK_OPTIONAL_FIELDS]);
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