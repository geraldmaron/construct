/**
 * lib/packs/prompts.mjs — pack Worker Profile prompt validation and resolution.
 *
 * A pack manifest's `prompts` map declares `{ workerProfileId: relativePath }`,
 * relative to that pack's own directory (`_packDir`, set by
 * lib/packs/loader.mjs for every manifest-loaded pack) — a project pack's
 * prompt paths are relative to the project, not to the Construct install.
 * The core pack (lib/packs/core-pack.mjs) has no `_packDir`; its prompts map
 * uses paths relative to `packageRoot` (the Construct install), the fallback
 * root used whenever a pack carries no `_packDir` of its own.
 *
 * validatePackPrompts() confirms every declared file exists AND carries
 * parseable YAML frontmatter with a matching `workerProfileId` field. In
 * governed deployment mode
 * mode a miss is a hard load-time error (the pack is rejected, naming the
 * missing file) per LMCP-E2: a governed pack must never run a worker under
 * another profile's instructions.
 *
 * resolveWorkerProfilePrompt() is the ONLY path worker.mjs uses to read a profile
 * body: a walk of the pack list in the order given (the caller sorts by tier
 * precedence — project before user before builtin, per ADR-0055), returning
 * the first pack that declares the role, or `{ found: false }` when no pack
 * in the registry declares it. No fallback to another catalog directory
 * exists — that would defeat the pack boundary the registry is
 * meant to enforce.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return null;
  try {
    return load(match[1]) || {};
  } catch {
    return null;
  }
}

function packPromptRoot(pack, fallbackRoot) {
  return pack?._packDir || fallbackRoot;
}

/**
 * Validate every prompt file a pack declares.
 *
 * @param {object} pack        a manifest object carrying `prompts: {id: relPath}`
 * @param {object} opts
 * @param {string} opts.packageRoot   fallback root for packs with no `_packDir` (e.g. the core pack)
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePackPrompts(pack, { packageRoot } = {}) {
  const errors = [];
  const prompts = pack?.prompts || {};
  const root = packPromptRoot(pack, packageRoot);

  for (const [specId, relPath] of Object.entries(prompts)) {
    if (typeof relPath !== 'string' || !relPath) {
      errors.push(`pack '${pack.id}': prompt entry for '${specId}' has no file path`);
      continue;
    }
    const absPath = join(root, relPath);
    if (!existsSync(absPath)) {
      errors.push(`pack '${pack.id}': declared prompt file missing for '${specId}': ${relPath}`);
      continue;
    }
    let raw;
    try {
      raw = readFileSync(absPath, 'utf8');
    } catch (err) {
      errors.push(`pack '${pack.id}': declared prompt file unreadable for '${specId}': ${relPath} (${err.message})`);
      continue;
    }
    const fm = parseFrontmatter(raw);
    if (!fm) {
      errors.push(`pack '${pack.id}': prompt file missing or invalid frontmatter for '${specId}': ${relPath}`);
      continue;
    }
    if (!fm.workerProfileId || typeof fm.workerProfileId !== 'string') {
      errors.push(`pack '${pack.id}': prompt frontmatter missing 'workerProfileId' for '${specId}': ${relPath}`);
      continue;
    }
    if (fm.workerProfileId !== specId) {
      errors.push(`pack '${pack.id}': prompt workerProfileId '${fm.workerProfileId}' does not match '${specId}': ${relPath}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Resolve one Worker's Profile prompt through the pack registry only.
 *
 * Packs are tried in the order given (the caller sorts by tier precedence;
 * see the module header) — the first pack declaring the role wins.
 *
 * @param {string} workerProfileId  canonical Worker Profile id, e.g. 'engineer'
 * @param {object} opts
 * @param {object[]} opts.packs      pack list, tier-precedence ordered (see loadAllPacks)
 * @param {string} opts.packageRoot  fallback root for packs with no `_packDir` (e.g. the core pack)
 * @returns {{found: true, content: string, packId: string} | {found: false}}
 */
export function resolveWorkerProfilePrompt(workerProfileId, { packs, packageRoot }) {
  const profileId = String(workerProfileId || '');

  for (const pack of packs || []) {
    const relPath = pack?.prompts?.[profileId];
    if (!relPath) continue;
    const absPath = join(packPromptRoot(pack, packageRoot), relPath);
    if (!existsSync(absPath)) continue;
    try {
      return { found: true, content: readFileSync(absPath, 'utf8'), packId: pack.id };
    } catch {
      continue;
    }
  }

  return { found: false };
}
