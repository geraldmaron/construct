/**
 * lib/packs/validate.mjs — pack manifest validator.
 *
 * Validates a plain-JS pack manifest object against the canonical schema
 * defined in manifest-schema.mjs. All errors are returned in a structured
 * result; this function never throws. Error messages are single-line,
 * actionable, and prefixed with the filePath (when provided).
 *
 * `embedBindings` validation (LMCP-E4) additionally cross-checks each bound
 * provider id and capability against `knownProviders` — a map of provider id
 * to its loaded extension manifest (lib/extensions/loader.mjs). A binding
 * naming a provider id absent from that map, or granting a capability the
 * provider's own manifest does not declare, fails validation with a path.
 */

import {
  PACK_REQUIRED_FIELDS, PACK_OPTIONAL_FIELDS, PACK_COMPAT_VERSION,
  EMBED_BINDING_CAPABILITIES, EMBED_BINDING_FIELDS, EMBED_BINDING_PROVIDER_FIELDS,
  EMBED_BINDING_PROPOSAL_RE,
} from './manifest-schema.mjs';
import { validateFilterConfig } from '../providers/contract.mjs';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].+)?$/;

const PACK_ID_RE = /^[a-z0-9\-./@]+$/;

/**
 * Validate the `embedBindings` block (LMCP-E4) against known extension
 * manifests. `knownProviders` is a map of providerId → manifest (as loaded
 * by lib/extensions/loader.mjs); each bound provider must exist in that map
 * and must itself declare every capability the binding grants — a pack
 * cannot hand a worker profile a read/search grant the provider never advertises.
 * Every error names the JSON path of the offending field.
 */
function validateEmbedBindings(embedBindings, { prefix, knownProviders = {} }) {
  const errors = [];

  if (typeof embedBindings !== 'object' || embedBindings === null || Array.isArray(embedBindings)) {
    return [`${prefix}embedBindings must be an object keyed by worker profile id`];
  }

  for (const [workerProfileId, binding] of Object.entries(embedBindings)) {
    const bindingPath = `embedBindings.${workerProfileId}`;

    if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) {
      errors.push(`${prefix}${bindingPath} must be an object`);
      continue;
    }

    for (const key of Object.keys(binding)) {
      if (!EMBED_BINDING_FIELDS.includes(key)) {
        errors.push(`${prefix}${bindingPath}.${key} is not a recognized embedBindings field (allowed: ${EMBED_BINDING_FIELDS.join(', ')})`);
      }
    }

    const providers = binding.providers;
    if (providers !== undefined) {
      if (!Array.isArray(providers)) {
        errors.push(`${prefix}${bindingPath}.providers must be an array`);
      } else {
        providers.forEach((entry, idx) => {
          const entryPath = `${bindingPath}.providers[${idx}]`;

          if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            errors.push(`${prefix}${entryPath} must be an object`);
            return;
          }

          for (const key of Object.keys(entry)) {
            if (!EMBED_BINDING_PROVIDER_FIELDS.includes(key)) {
              errors.push(`${prefix}${entryPath}.${key} is not a recognized provider binding field (allowed: ${EMBED_BINDING_PROVIDER_FIELDS.join(', ')})`);
            }
          }

          const providerId = entry.id;
          if (typeof providerId !== 'string' || providerId.length === 0) {
            errors.push(`${prefix}${entryPath}.id must be a non-empty string`);
            return;
          }

          const providerManifest = knownProviders[providerId];
          if (!providerManifest) {
            errors.push(`${prefix}${entryPath}.id references unknown provider "${providerId}" (no extension manifest declares this id)`);
            return;
          }

          const declaredCapabilities = new Set(providerManifest.capabilities || []);

          if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
            errors.push(`${prefix}${entryPath}.capabilities must be a non-empty array`);
          } else {
            entry.capabilities.forEach((cap, capIdx) => {
              const capPath = `${entryPath}.capabilities[${capIdx}]`;
              if (!EMBED_BINDING_CAPABILITIES.includes(cap)) {
                errors.push(`${prefix}${capPath} "${cap}" is not a recognized embed capability (allowed: ${EMBED_BINDING_CAPABILITIES.join(', ')})`);
              } else if (!declaredCapabilities.has(cap)) {
                errors.push(`${prefix}${capPath} "${cap}" is not declared by provider "${providerId}"'s manifest capabilities (${[...declaredCapabilities].join(', ') || '(none)'})`);
              }
            });
          }

          if (entry.filters !== undefined) {
            try {
              validateFilterConfig(providerId, entry.filters);
            } catch (err) {
              errors.push(`${prefix}${entryPath}.filters: ${err.message}`);
            }
          }
        });
      }
    }

    const proposals = binding.proposals;
    if (proposals !== undefined) {
      if (!Array.isArray(proposals)) {
        errors.push(`${prefix}${bindingPath}.proposals must be an array`);
      } else {
        const boundProviderIds = new Set((Array.isArray(providers) ? providers : []).map((p) => p?.id).filter(Boolean));
        proposals.forEach((token, idx) => {
          const tokenPath = `${bindingPath}.proposals[${idx}]`;
          if (typeof token !== 'string' || !EMBED_BINDING_PROPOSAL_RE.test(token)) {
            errors.push(`${prefix}${tokenPath} "${token}" must be a "<providerId>.<writeKind>" token (e.g. "jira.createIssue")`);
            return;
          }
          const [providerId] = token.split('.');
          if (!knownProviders[providerId]) {
            errors.push(`${prefix}${tokenPath} "${token}" references unknown provider "${providerId}" (no extension manifest declares this id)`);
          } else if (boundProviderIds.size > 0 && !boundProviderIds.has(providerId)) {
            errors.push(`${prefix}${tokenPath} "${token}" proposes against provider "${providerId}" which is not in this worker profile's providers[] grant`);
          }
        });
      }
    }
  }

  return errors;
}

export function validatePackManifest(manifest, { filePath, strict = false, knownProviders = {} } = {}) {
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

  if (manifest.embedBindings !== undefined && manifest.embedBindings !== null) {
    errors.push(...validateEmbedBindings(manifest.embedBindings, { prefix, knownProviders }));
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