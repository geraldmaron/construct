/**
 * lib/frameworks/loader.mjs — pack-precedence framework resolution (ADR-0062, LMCP-F7).
 *
 * A pack manifest's `frameworks` map declares `{ framework-id: relativePath }`,
 * resolved the same way lib/packs/prompts.mjs resolves `prompts`: relative to
 * that pack's own directory (`_packDir`), falling back to `packageRoot` for
 * the core pack (which has no `_packDir`). resolveFramework() walks a
 * tier-precedence-ordered pack list and returns the first pack that declares
 * the id, so a project-tier pack (.cx/packs) overrides the core pack for the
 * same framework id — the same three-tier precedence every other pack asset
 * obeys (ADR-0055).
 *
 * validatePackFrameworks() mirrors validatePackPrompts(): every declared
 * framework file must exist and pass the ADR-0062 schema (schema.mjs), or
 * the pack fails closed with the file path and offending field named.
 */

import { existsSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { parseFrameworkFile } from './schema.mjs';

function packFrameworkRoot(pack, fallbackRoot) {
  return pack?._packDir || fallbackRoot;
}

/**
 * Validate every framework file a pack declares.
 *
 * @param {object} pack        a manifest object carrying `frameworks: {id: relPath}`
 * @param {object} opts
 * @param {string} opts.packageRoot   fallback root for packs with no `_packDir` (e.g. the core pack)
 * @param {Set<string>|string[]} [opts.knownRoles]  roles appliesToRole may name
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePackFrameworks(pack, { packageRoot, knownRoles } = {}) {
  const errors = [];
  const frameworks = pack?.frameworks || {};
  const root = packFrameworkRoot(pack, packageRoot);

  for (const [frameworkId, relPath] of Object.entries(frameworks)) {
    if (typeof relPath !== 'string' || !relPath) {
      errors.push(`pack '${pack.id}': framework entry for '${frameworkId}' has no file path`);
      continue;
    }
    const absPath = joinPath(root, relPath);
    if (!existsSync(absPath)) {
      errors.push(`pack '${pack.id}': declared framework file missing for '${frameworkId}': ${relPath}`);
      continue;
    }
    const result = parseFrameworkFile(absPath, { knownRoles });
    if (!result.valid) {
      errors.push(...result.errors.map((e) => `pack '${pack.id}': framework '${frameworkId}': ${e}`));
      continue;
    }
    if (result.frontmatter.id !== frameworkId) {
      errors.push(
        `pack '${pack.id}': framework '${frameworkId}' declares mismatched frontmatter id '${result.frontmatter.id}'`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolve one framework through the pack registry only, honoring tier precedence.
 *
 * @param {string} frameworkId
 * @param {object} opts
 * @param {object[]} opts.packs      pack list, tier-precedence ordered (project before user before builtin)
 * @param {string} opts.packageRoot  fallback root for packs with no `_packDir` (e.g. the core pack)
 * @param {Set<string>|string[]} [opts.knownRoles]
 * @returns {{found: true, frontmatter: object, body: string, packId: string} | {found: false}}
 */
export function resolveFramework(frameworkId, { packs, packageRoot, knownRoles } = {}) {
  for (const pack of packs || []) {
    const relPath = pack?.frameworks?.[frameworkId];
    if (!relPath) continue;
    const absPath = joinPath(packFrameworkRoot(pack, packageRoot), relPath);
    if (!existsSync(absPath)) continue;

    const result = parseFrameworkFile(absPath, { knownRoles });
    if (!result.valid) continue;

    return { found: true, frontmatter: result.frontmatter, body: result.body, packId: pack.id };
  }

  return { found: false };
}

/**
 * List every framework id a pack declares, without loading file contents.
 *
 * @param {object} pack
 * @returns {string[]}
 */
export function listPackFrameworks(pack) {
  return Object.keys(pack?.frameworks || {});
}
