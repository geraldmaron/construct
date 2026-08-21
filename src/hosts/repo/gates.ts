/**
 * hosts/repo/gates.ts — what a repository declares it checks about itself.
 *
 * The IO half of the gate obligation. Every judgement about what a script name
 * means lives in kernel/plan/gates.ts, which is pure and tested against
 * hand-built manifests rather than against whatever repository happens to be
 * on this machine. All this module does is read one file and say what is in it.
 *
 * It lives under hosts/ for the reason the kernel seam exists: it reads a path
 * the user supplied, and the kernel is forbidden the filesystem.
 *
 * Only a root the workspace declared as ground is ever passed in. Reading a
 * manifest the user did not declare would put a check nobody asked about into
 * a role's obligations, and the process's own directory is exactly the manifest
 * most likely to be reachable and least likely to be the user's.
 *
 * `package.json` is the manifest read. A repository that keeps its checks
 * somewhere else reads here as declaring none, which is honest and lands the
 * role on the standard rather than on silence.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ManifestScript, RepoManifest } from '../../kernel/plan/gates.ts';

/**
 * The scripts one declared root names, or null when it has no manifest to
 * read. Null and an empty script list are different answers: the first says
 * nothing there declares anything, the second says the manifest was read and
 * declares no scripts, and only the second is the repository speaking.
 */
export function readRepoManifest(root: string): RepoManifest | null {
  let raw: string;
  try {
    raw = readFileSync(join(root, 'package.json'), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A manifest nobody can parse declares nothing that can be relied on.
    return null;
  }
  const scripts = (parsed as { scripts?: unknown } | null)?.scripts;
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) {
    return { root, scripts: [] };
  }
  const named: ManifestScript[] = [];
  for (const [name, command] of Object.entries(scripts as Record<string, unknown>)) {
    if (typeof command !== 'string') continue;
    named.push({ name, command });
  }
  return { root, scripts: named };
}

/** Every declared root that has a manifest, in the order the roots were given. */
export function readRepoManifests(roots: readonly string[]): RepoManifest[] {
  const found: RepoManifest[] = [];
  for (const root of roots) {
    const manifest = readRepoManifest(root);
    if (manifest) found.push(manifest);
  }
  return found;
}
