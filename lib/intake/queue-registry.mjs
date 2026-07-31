/**
 * lib/intake/queue-registry.mjs — kind:'queue' provider resolution.
 *
 * Substrate owns the queue/run-store CONTRACT; git-queue is the zero-dependency
 * DEFAULT provider and Postgres is an OPTIONAL provider. Selection is explicit:
 * a concrete queue backend is chosen by resolving an installed kind:'queue'
 * manifest through the extension registry. No silent postgres->git alias
 * exists — a
 * caller that names a backend with no registered kind:'queue' provider gets a
 * typed error, not a swallowed downgrade.
 *
 * Resolution surface:
 *   listQueueProviders({ rootDir, env }) → manifest[] of kind:'queue', merged
 *     across builtin/user/project tiers (project wins).
 *   findQueueProvider(backend, { rootDir, env }) → manifest | null for a backend id.
 */

import { loadManifestsFromDir, mergeManifests, resolveManifestDirs } from '../extensions/loader.mjs';

/**
 * The queue backend ids that are always resolvable without a registered
 * manifest. git is the default provider; filesystem is the solo-mode default
 * provider. Both ship in-tree, so they never require an extension manifest.
 */
export const BUILTIN_QUEUE_BACKENDS = ['git', 'filesystem'];

// Load every kind:'queue' manifest across the three tiers and merge by id so a
// project- or user-level Postgres queue provider overrides a builtin of the
// same id. Only manifests declaring kind:'queue' are returned.

export function listQueueProviders({ rootDir = process.cwd(), env = process.env } = {}) {
  const homeDir = env?.HOME || env?.USERPROFILE || undefined;
  const dirs = resolveManifestDirs({ rootDir, homeDir });
  const builtin = loadManifestsFromDir(dirs.builtin).manifests;
  const user = loadManifestsFromDir(dirs.user).manifests;
  const project = loadManifestsFromDir(dirs.project).manifests;
  return mergeManifests(builtin, user, project).filter((m) => m.kind === 'queue');
}

/**
 * findQueueProvider(backend, opts)
 *
 * Returns the kind:'queue' manifest whose id matches `backend`, or null when no
 * such provider is registered. Callers use the null result to distinguish an
 * unregistered backend (a hard, explicit error) from a resolvable one.
 */
export function findQueueProvider(backend, { rootDir = process.cwd(), env = process.env } = {}) {
  if (!backend) return null;
  return listQueueProviders({ rootDir, env }).find((m) => m.id === backend) || null;
}
