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

// Under `bun build --compile`, every module's import.meta.url/dirname resolves
// inside the bundle's virtual filesystem (`/$bunfs/root/...`) rather than a
// real on-disk path, so any install-root resolution derived from it collapses
// to a directory that does not exist and every sibling-data-dir read (skills/,
// specialists/, templates/, config/, registry/) throws ENOENT. process.execPath
// still reports the compiled binary's real on-disk location, so callers whose
// naive resolution lands inside /$bunfs fall back to the binary's own
// directory. This assumes the data directories ship next to the binary
// (true for the CI/dev smoke path — dist/<binary> sits one level below the
// checkout root, the same depth bin/construct and lib/roots.mjs assume); a
// fully standalone end-user install still needs its own asset story
// (embedded assets or a co-installed data tree), tracked separately.

const BUN_VIRTUAL_FS_PREFIX = '/$bunfs';

export function isBunCompiledVirtualPath(candidatePath) {
  return typeof process.versions?.bun === 'string' && candidatePath.startsWith(BUN_VIRTUAL_FS_PREFIX);
}

export function resolveInstallRoot(naiveRoot, { execPath = process.execPath, upFromBinary = 1 } = {}) {
  if (!isBunCompiledVirtualPath(naiveRoot)) return naiveRoot;
  return path.resolve(path.dirname(execPath), ...Array(upFromBinary).fill('..'));
}

// Two dozen lib/*.mjs files use the standard Node "was I run directly"
// idiom (`import.meta.url === file://${process.argv[1]}`) so they double as
// standalone scripts. Under a Bun-compiled binary, every bundled module's
// import.meta.url collapses to the same virtual bunfs path as process.argv[1]
// (both point at the single compiled executable), so that comparison is true
// for every one of those files simultaneously — each runs its own top-level
// CLI logic as an unwanted side effect of merely being imported, and the
// first one whose logic throws (e.g. lib/headhunt.mjs's bare invocation
// requiring --for) takes the whole binary down before bin/construct's real
// dispatch ever executes. There is exactly one legitimate entry point inside
// a compiled binary (bin/construct itself), so this always resolves false
// under Bun-compile regardless of the module asking.

export function isMainModule(moduleUrl) {
  if (typeof process.versions?.bun === 'string' && isBunCompiledVirtualPath(process.argv[1] || '')) {
    return false;
  }
  return moduleUrl === `file://${process.argv[1]}`;
}

// lib/roots.mjs lives one level below the package root (<package>/lib/roots.mjs).

export const packageRoot = resolveInstallRoot(path.resolve(fileURLToPath(import.meta.url), '..', '..'));

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
