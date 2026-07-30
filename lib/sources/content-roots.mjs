/**
 * lib/sources/content-roots.mjs — resolve content-capable source targets to
 * on-disk roots for multi-root knowledge corpus builders.
 *
 * A target contributes a filesystem content root when its provider manifest
 * declares content capability and the concrete content exists on disk:
 *   - directory targets — the manifest selector declares `existsAs: 'directory'`,
 *     so the tilde-expanded path IS the root (no cache, always local).
 *   - corpus targets — the manifest declares a `content` descriptor and the
 *     selector opts into corpus mode (github: content.mode === 'corpus'); the
 *     root is the state-root repo cache populated by `construct sources sync`.
 *     A corpus target with no cache yet resolves to nothing (nothing to index).
 *
 * Capability is keyed off manifest descriptors, never a hardcoded provider name,
 * matching the registry pattern in lib/config/source-target-registry.mjs. Adding
 * a future git-hosted content provider means declaring its manifest `content`
 * block, not editing this file.
 *
 * Every root carries an `origin` — {targetId, provider, projectKey, ref} — which
 * the corpus builders stamp onto each chunk (adding per-file `relPath`) so
 * cross-project retrieval can attribute and filter results by source project.
 * The host project itself is the reserved origin: targetId null, projectKey
 * `self`. `--projects=self` selects it.
 */

import { statSync } from 'node:fs';
import path from 'node:path';

import { getSourceTargetDescriptor } from '../config/source-target-registry.mjs';
import { expandTilde, resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { isCorpusTarget, corpusCacheDir, corpusFreshness } from './repo-cache.mjs';

export const SELF_PROJECT_KEY = 'self';

function isDirectoryTarget(target) {
  const descriptor = getSourceTargetDescriptor(target?.provider);
  return descriptor?.selector?.existsAs === 'directory';
}

/**
 * Does this target declare any content capability at all (directory or corpus)?
 * Expands `--projects=all` to the content-eligible target set.
 */
export function isContentCapableTarget(target) {
  return isDirectoryTarget(target) || isCorpusTarget(target);
}

function directoryRoot(target) {
  const descriptor = getSourceTargetDescriptor(target.provider);
  const raw = target.selector?.[descriptor.selector.field];
  if (!raw) return null;
  const dir = expandTilde(String(raw));
  try {
    if (!statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  return { dir, ref: null };
}

function corpusRoot(target, projectRoot) {
  const freshness = corpusFreshness(target, { projectRoot });
  if (!freshness.cached) return null;
  return { dir: corpusCacheDir(target, { projectRoot }), ref: freshness.ref ?? null };
}

/**
 * Resolve content-capable targets to concrete on-disk roots. Targets whose
 * content is not present (a directory that vanished, a corpus never synced) are
 * silently omitted — there is nothing to index — so callers get only roots they
 * can actually walk.
 *
 * @param {object[]} targets      effective source targets (post-merge)
 * @param {object} [opts]
 * @param {string} [opts.projectRoot]
 * @returns {{dir: string, origin: {targetId: string, provider: string, projectKey: string, ref: string|null}}[]}
 */
export function resolveContentRoots(targets = [], { projectRoot = process.cwd() } = {}) {
  const roots = [];
  for (const target of targets) {
    let resolved = null;
    if (isDirectoryTarget(target)) resolved = directoryRoot(target);
    else if (isCorpusTarget(target)) resolved = corpusRoot(target, projectRoot);
    if (!resolved) continue;
    roots.push({
      dir: resolved.dir,
      origin: {
        targetId: target.id,
        provider: target.provider,
        projectKey: target.id,
        ref: resolved.ref,
      },
    });
  }
  return roots;
}

/**
 * Convenience wrapper: resolve content roots straight from a loaded project
 * config (merging in legacy env targets exactly as the rest of the pipeline does).
 */
export function resolveContentRootsFromConfig(config, { projectRoot = process.cwd(), env = process.env } = {}) {
  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
  return resolveContentRoots(targets, { projectRoot });
}

/**
 * Expand a `--projects=` / `projects` filter spec into the set of origin
 * targetIds it selects. Accepts a CSV string or an array. Semantics:
 *   - `all`  → every content-capable target id (host not included).
 *   - `self` → the reserved host project key.
 *   - a target id → that id, which must exist and be content-capable.
 * An unknown or non-content-capable id is a hard error (never a silent empty
 * result), per R3.
 *
 * @returns {{ ids: Set<string>, includeSelf: boolean }}
 * @throws {Error} on an unknown id, with a message listing the known ids.
 */
export function expandProjectsFilter(spec, targets = []) {
  const tokens = (Array.isArray(spec) ? spec : String(spec ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

  const contentTargets = targets.filter(isContentCapableTarget);
  const knownById = new Map(contentTargets.map((t) => [t.id, t]));

  const ids = new Set();
  let includeSelf = false;

  for (const token of tokens) {
    if (token === 'all') {
      for (const t of contentTargets) ids.add(t.id);
      continue;
    }
    if (token === SELF_PROJECT_KEY) {
      includeSelf = true;
      continue;
    }
    if (!knownById.has(token)) {
      const known = [SELF_PROJECT_KEY, 'all', ...knownById.keys()];
      throw new Error(`unknown project "${token}" — known projects: ${known.join(', ')}`);
    }
    ids.add(token);
  }

  return { ids, includeSelf };
}
