/**
 * lib/roots.mjs — canonical resolution of the three directory concepts in Construct.
 *
 * packageRoot  — where the construct npm package is installed. Resolved from
 *                import.meta.url, stable across global install, npx, and local
 *                dev symlinks. Points to the directory that contains
 *                construct's own package.json. Locate bundled assets here:
 *                personas, skills, templates, schemas, hooks.
 *
 * projectRoot  — the user's repo being operated on. Discovered at runtime by
 *                inspecting --project <dir> in argv, then walking up from cwd
 *                looking for .cx/ or package.json. Falls back to cwd when no
 *                marker is found. Services (oracle, embed, telemetry) that
 *                read or write to the user's repo must use this, not
 *                packageRoot.
 *
 * cwd          — process.cwd(). Useful for relative-path resolution before
 *                projectRoot is determined. Callers should prefer
 *                projectRoot once it is resolved.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// lib/roots.mjs lives one level below the package root (<package>/lib/roots.mjs).

export const packageRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

// Walk upward from `start`, looking for .cx/ first (Construct project marker),
// then package.json (generic JS project root). Stops at filesystem root.

function walkUp(start) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, '.cx'))) return dir;
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the project root for the user's repo.
 *
 * Resolution order:
 *   1. --project <dir> in process.argv (explicit override)
 *   2. Walk upward from cwd looking for .cx/ or package.json
 *   3. cwd itself as a last resort
 *
 * Pass a cwd argument when the caller controls the starting directory (tests,
 * sub-process workers). Omit it in top-level CLI code to use process.cwd().
 */
export function resolveProjectRoot(cwd = process.cwd()) {
  const argv = process.argv;
  const flagIndex = argv.indexOf('--project');
  if (flagIndex !== -1 && argv[flagIndex + 1]) {
    return path.resolve(argv[flagIndex + 1]);
  }

  return walkUp(cwd) ?? path.resolve(cwd);
}
