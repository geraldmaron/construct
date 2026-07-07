/**
 * lib/embed/capability-loader.mjs — embed-capability manifest loader (ADR-0061, LMCP-P2).
 *
 * An embed capability is a workflow manifest (lib/workflows/loader.mjs, D1)
 * with `type: "embed"` and an `embed` block. This module discovers those
 * manifests across the three D1 tiers (builtin, pack, project), validates
 * the `embed` block against the ADR-0061 shape — including provider
 * bindings (E4) and the ADR-0060 filter block (reused read-only from
 * lib/providers/filter-schema.mjs / lib/providers/contract.mjs) — and
 * exposes the per-project enable/disable lifecycle described in the ADR:
 * pack tiers ship *available* defaults, `.cx/embed/<id>.manifest.json`
 * (project tier) makes a capability *active*.
 *
 * Every validation failure returns a JSON-schema-style field path
 * (`embed.providerBindings[1]`, `embed.filter.scope.repos`, …) so a failed
 * `enable` names exactly what is wrong — this is a fail-closed surface, not
 * best-effort: an invalid manifest is never silently accepted or partially
 * applied.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadWorkflowManifestsFromDir, mergeWorkflowManifests, resolveWorkflowManifestDirs } from '../workflows/loader.mjs';
import { validateWorkflowManifest } from '../workflows/validate.mjs';
import { loadAllPacks } from '../packs/loader.mjs';
import { validateFilterConfig } from '../providers/contract.mjs';
import { TOP_LEVEL_KEYS as FILTER_TOP_LEVEL_KEYS, SCOPE_KEYS as FILTER_SCOPE_KEYS, PREDICATE_KEYS as FILTER_PREDICATE_KEYS } from '../providers/filter-schema.mjs';
import { configPath } from '../config-dir.mjs';

export const EMBED_MANIFEST_TYPE = 'embed';

export const RUNTIME_VALUES = Object.freeze(['in-process', 'external', 'auto', 'none']);

export const PROPOSAL_AUTHORITY_VALUES = Object.freeze(['propose-only', 'governed-write']);

const REQUIRED_EMBED_FIELDS = Object.freeze([
  'specialist', 'providerBindings', 'framework', 'outputContract', 'proposalAuthority', 'runtime',
]);

/**
 * Directory holding per-project embed enable/override manifests
 * (project tier of the D1 loader, mirrored under `.cx/embed/`).
 */
export function embedProjectDir(rootDir = process.cwd()) {
  return configPath(rootDir, 'embed');
}

function fieldError(filePath, fieldPath, message) {
  const prefix = filePath ? `${filePath}: ` : '';
  return `${prefix}${fieldPath}: ${message}`;
}

/**
 * Validate the `embed` block of a `type: "embed"` workflow manifest against
 * the ADR-0061 shape. Returns `{ valid: true }` or `{ valid: false, errors }`
 * where every error string is prefixed with its JSON-schema-style field path
 * (e.g. `embed.providerBindings[0]`) so a caller can point at exactly what
 * broke. Never throws.
 *
 * `knownSpecialists` — merged E1 pack registry specialist ids; when supplied,
 * an unresolvable `embed.specialist` is a hard error (fail closed rather than
 * silently accepting a typo'd persona reference).
 */
export function validateEmbedBlock(manifest, { filePath, knownSpecialists } = {}) {
  const errors = [];

  if (manifest.type !== EMBED_MANIFEST_TYPE) {
    return { valid: false, errors: [fieldError(filePath, 'type', `must be "${EMBED_MANIFEST_TYPE}" (got '${manifest.type}')`)] };
  }

  const embed = manifest.embed;
  if (embed === undefined || embed === null || typeof embed !== 'object' || Array.isArray(embed)) {
    return { valid: false, errors: [fieldError(filePath, 'embed', 'must be an object present on every type:"embed" manifest')] };
  }

  for (const field of REQUIRED_EMBED_FIELDS) {
    if (!(field in embed) || embed[field] === undefined || embed[field] === null) {
      errors.push(fieldError(filePath, `embed.${field}`, 'missing required field'));
    }
  }

  if ('specialist' in embed && embed.specialist !== undefined && embed.specialist !== null) {
    if (typeof embed.specialist !== 'string' || embed.specialist.length === 0) {
      errors.push(fieldError(filePath, 'embed.specialist', 'must be a non-empty string'));
    } else if (Array.isArray(knownSpecialists) && knownSpecialists.length > 0 && !knownSpecialists.includes(embed.specialist)) {
      errors.push(fieldError(filePath, 'embed.specialist', `unresolvable specialist id '${embed.specialist}' (not present in the merged pack registry)`));
    }
  }

  if ('providerBindings' in embed && embed.providerBindings !== undefined && embed.providerBindings !== null) {
    if (!Array.isArray(embed.providerBindings)) {
      errors.push(fieldError(filePath, 'embed.providerBindings', 'must be an array of provider ids'));
    } else if (embed.providerBindings.length === 0) {
      errors.push(fieldError(filePath, 'embed.providerBindings', 'must declare at least one provider id'));
    } else {
      embed.providerBindings.forEach((binding, idx) => {
        if (typeof binding !== 'string' || binding.length === 0) {
          errors.push(fieldError(filePath, `embed.providerBindings[${idx}]`, 'must be a non-empty string'));
        }
      });
    }
  }

  if ('framework' in embed && embed.framework !== undefined && embed.framework !== null) {
    if (typeof embed.framework !== 'string' || embed.framework.length === 0) {
      errors.push(fieldError(filePath, 'embed.framework', 'must be a non-empty string'));
    }
  }

  if ('outputContract' in embed && embed.outputContract !== undefined && embed.outputContract !== null) {
    if (typeof embed.outputContract !== 'string' || embed.outputContract.length === 0) {
      errors.push(fieldError(filePath, 'embed.outputContract', 'must be a non-empty string'));
    }
  }

  if ('proposalAuthority' in embed && embed.proposalAuthority !== undefined && embed.proposalAuthority !== null) {
    if (!PROPOSAL_AUTHORITY_VALUES.includes(embed.proposalAuthority)) {
      errors.push(fieldError(filePath, 'embed.proposalAuthority', `must be one of: ${PROPOSAL_AUTHORITY_VALUES.join(', ')} (got '${embed.proposalAuthority}')`));
    }
  }

  if ('runtime' in embed && embed.runtime !== undefined && embed.runtime !== null) {
    if (!RUNTIME_VALUES.includes(embed.runtime)) {
      errors.push(fieldError(filePath, 'embed.runtime', `must be one of: ${RUNTIME_VALUES.join(', ')} (got '${embed.runtime}')`));
    }
  }

  if ('cadence' in embed && embed.cadence !== undefined && embed.cadence !== null) {
    if (typeof embed.cadence !== 'object' || Array.isArray(embed.cadence)) {
      errors.push(fieldError(filePath, 'embed.cadence', 'must be an object (e.g. { "every": "PT15M" })'));
    } else if ('every' in embed.cadence && typeof embed.cadence.every !== 'string') {
      errors.push(fieldError(filePath, 'embed.cadence.every', 'must be a string (ISO-8601 duration)'));
    }
  }

  if ('filter' in embed && embed.filter !== undefined && embed.filter !== null) {
    errors.push(...validateEmbedFilterBlock(embed.filter, embed.providerBindings, filePath));
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}

/**
 * Validate the ADR-0060 filter block carried at `embed.filter`, field-path
 * prefixed for the embed-manifest context. Structural checks mirror
 * lib/providers/filter-schema.mjs; per-provider-kind scope legality is
 * re-checked with the read-only lib/providers/contract.mjs
 * `validateFilterConfig` against every bound provider id so a filter that
 * is legal for one binding but not another is caught here rather than at
 * daemon runtime.
 */
function validateEmbedFilterBlock(filter, providerBindings, filePath) {
  const errors = [];

  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    return [fieldError(filePath, 'embed.filter', 'must be an object')];
  }

  for (const key of Object.keys(filter)) {
    if (!FILTER_TOP_LEVEL_KEYS.includes(key)) {
      errors.push(fieldError(filePath, `embed.filter.${key}`, `unknown filter key; allowed: ${FILTER_TOP_LEVEL_KEYS.join(', ')}`));
    }
  }

  if (filter.scope !== undefined) {
    if (typeof filter.scope !== 'object' || filter.scope === null || Array.isArray(filter.scope)) {
      errors.push(fieldError(filePath, 'embed.filter.scope', 'must be an object'));
    } else {
      for (const key of Object.keys(filter.scope)) {
        if (!FILTER_SCOPE_KEYS.includes(key)) {
          errors.push(fieldError(filePath, `embed.filter.scope.${key}`, `unknown scope key; allowed: ${FILTER_SCOPE_KEYS.join(', ')}`));
        } else if (!Array.isArray(filter.scope[key])) {
          errors.push(fieldError(filePath, `embed.filter.scope.${key}`, 'must be an array'));
        }
      }
    }
  }

  if (filter.predicates !== undefined) {
    if (typeof filter.predicates !== 'object' || filter.predicates === null || Array.isArray(filter.predicates)) {
      errors.push(fieldError(filePath, 'embed.filter.predicates', 'must be an object'));
    } else {
      for (const key of Object.keys(filter.predicates)) {
        if (!FILTER_PREDICATE_KEYS.includes(key)) {
          errors.push(fieldError(filePath, `embed.filter.predicates.${key}`, `unknown predicate key; allowed: ${FILTER_PREDICATE_KEYS.join(', ')}`));
        }
      }
    }
  }

  // Structural errors already found: skip the per-provider re-check, its
  // messages would only restate the same problem under a different path.
  if (errors.length > 0) return errors;

  // Fail closed per bound provider: a filter valid for "github" but not
  // "jira" must not silently apply to jira's snapshot with github's rules.
  for (const providerId of Array.isArray(providerBindings) ? providerBindings : []) {
    try {
      validateFilterConfig(providerId, filter);
    } catch (err) {
      errors.push(fieldError(filePath, 'embed.filter', `invalid for bound provider '${providerId}': ${err.message}`));
    }
  }

  return errors;
}

/**
 * Discover embed-capability manifests across the D1 three-tier loader
 * (builtin, every pack root's workflows/ dir, project .cx/embed/), validate
 * the base workflow-manifest shape via lib/workflows/validate.mjs and the
 * ADR-0061 `embed` block via validateEmbedBlock, and merge by id with
 * project overriding pack overriding builtin. Non-`type:"embed"` workflow
 * manifests present in the same directories are silently excluded — this
 * loader is embed-capability-scoped, not a general workflow loader.
 *
 * @param {{ rootDir?: string, packRoots?: string[], knownSpecialists?: string[] }} [opts]
 * @returns {{ capabilities: object[], errors: string[] }}
 */
export function loadEmbedCapabilities(opts = {}) {
  const { rootDir = process.cwd() } = opts;
  const errors = [];

  let packRoots = opts.packRoots;
  let knownSpecialists = opts.knownSpecialists;
  if (!packRoots || !knownSpecialists) {
    const { packs, errors: packErrors } = loadAllPacks({ rootDir });
    errors.push(...packErrors);
    if (!packRoots) packRoots = packs.map((p) => p._packDir).filter(Boolean);
    if (!knownSpecialists) knownSpecialists = [...new Set(packs.flatMap((p) => p.specialists ?? []))];
  }

  const dirs = resolveWorkflowManifestDirs({ rootDir, packRoots });

  // Project-tier embed manifests live under .cx/embed/ (not .cx/workflows/,
  // which is D1's general workflow project tier) — see embedProjectDir().
  const projectDir = embedProjectDir(rootDir);

  const builtin = loadWorkflowManifestsFromDir(dirs.builtin);
  errors.push(...builtin.errors);

  const packManifests = [];
  for (const packDir of dirs.pack) {
    const result = loadWorkflowManifestsFromDir(packDir);
    packManifests.push(...result.manifests);
    errors.push(...result.errors);
  }

  const project = loadWorkflowManifestsFromDir(projectDir);
  errors.push(...project.errors);

  const merged = mergeWorkflowManifests(builtin.manifests, packManifests, project.manifests);

  const capabilities = [];
  for (const manifest of merged) {
    if (manifest.type !== EMBED_MANIFEST_TYPE) continue;

    const result = validateEmbedBlock(manifest, { filePath: manifest._filePath, knownSpecialists });
    if (!result.valid) {
      errors.push(...result.errors);
      continue;
    }
    capabilities.push(manifest);
  }

  return { capabilities, errors };
}

/**
 * Validate a single candidate manifest object end to end (base workflow
 * shape + ADR-0061 embed block) without touching disk, so an `enable` call
 * can reject a bad manifest before any project-tier file is written.
 */
export function validateEmbedManifest(manifest, { filePath, knownSpecialists } = {}) {
  const base = validateWorkflowManifest(manifest, { filePath });
  if (!base.valid) return base;
  return validateEmbedBlock(manifest, { filePath, knownSpecialists });
}

/**
 * Read the project-tier enable/override manifest for `id`, if present.
 * Returns null when the capability has never been enabled in this project.
 */
export function readProjectEmbedManifest(id, rootDir = process.cwd()) {
  const filePath = join(embedProjectDir(rootDir), `${id}.manifest.json`);
  if (!existsSync(filePath)) return null;
  return { manifest: JSON.parse(readFileSync(filePath, 'utf8')), filePath };
}

/**
 * Write the project-tier enable/override manifest for `id`, creating
 * `.cx/embed/` on demand. Callers must validate before calling — the
 * function performs no validation, matching the D1 loader's separation
 * between building a manifest object and validating one.
 */
export function writeProjectEmbedManifest(id, manifest, rootDir = process.cwd()) {
  const dir = embedProjectDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${id}.manifest.json`);
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
  return filePath;
}
