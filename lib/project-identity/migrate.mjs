/**
 * lib/project-identity/migrate.mjs — ADR-0092/0096 project-identity migration.
 *
 * Plans and optionally applies filesystem merges from legacy
 * `~/.construct/projects/<key>/` buckets into the canonical
 * `deriveProjectKey` directory for a project. Non-destructive by default:
 * source buckets are copied into the canonical target, never deleted.
 * Homedir()-fallback buckets are flagged for manual review only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { homeDir } from '../paths.mjs';
import { deriveProjectKey, derivePathOnlyProjectKey } from '../state-root.mjs';

function projectsRoot(home = homeDir()) {
  return path.join(home, '.construct', 'projects');
}

function describeBucket(projectsDir, key) {
  const dir = path.join(projectsDir, key);
  if (!fs.existsSync(dir)) {
    return { key, dir, exists: false, entryCount: 0 };
  }
  let entryCount = 0;
  try {
    entryCount = fs.readdirSync(dir).length;
  } catch {
    entryCount = -1;
  }
  return { key, dir, exists: true, entryCount };
}

function mergeBucket(sourceDir, targetDir, { dryRun = true } = {}) {
  if (!fs.existsSync(sourceDir)) {
    return { merged: 0, skipped: 0, conflicts: [] };
  }
  if (path.resolve(sourceDir) === path.resolve(targetDir)) {
    return { merged: 0, skipped: 0, conflicts: [] };
  }

  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  let merged = 0;
  let skipped = 0;
  const conflicts = [];

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const src = path.join(sourceDir, entry.name);
    const dst = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const sub = mergeBucket(src, dst, { dryRun });
      merged += sub.merged;
      skipped += sub.skipped;
      conflicts.push(...sub.conflicts);
      continue;
    }
    if (fs.existsSync(dst)) {
      skipped += 1;
      try {
        const srcStat = fs.statSync(src);
        const dstStat = fs.statSync(dst);
        if (srcStat.size !== dstStat.size || srcStat.mtimeMs !== dstStat.mtimeMs) {
          conflicts.push({ src, dst, reason: 'target-exists' });
        }
      } catch {
        conflicts.push({ src, dst, reason: 'target-exists-unreadable' });
      }
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    merged += 1;
  }

  return { merged, skipped, conflicts };
}

/**
 * Build a read-only migration plan for `projectRoot`. When a git remote exists,
 * any surviving path-hash bucket is scheduled to merge into the canonical
 * remote-hash bucket. Homedir()-fallback buckets are flagged, never merged.
 */
export function planProjectIdentityMigration(projectRoot, { config = {}, home = homeDir() } = {}) {
  const override = config?.deployment?.projectKey;
  const canonicalKey = override || deriveProjectKey(projectRoot);
  const pathOnlyKey = derivePathOnlyProjectKey(projectRoot);
  const homedirKey = deriveProjectKey(os.homedir());
  const root = projectsRoot(home);

  const actions = [];
  const flagged = [];

  if (!override && pathOnlyKey !== canonicalKey) {
    const legacy = describeBucket(root, pathOnlyKey);
    if (legacy.exists) {
      actions.push({
        kind: 'merge',
        fromKey: pathOnlyKey,
        toKey: canonicalKey,
        from: legacy.dir,
        to: path.join(root, canonicalKey),
        reason: 'path-hash bucket from before a git remote existed; canonical key now uses the remote hash',
      });
    }
  }

  const homedirBucket = describeBucket(root, homedirKey);
  if (homedirBucket.exists && homedirKey !== canonicalKey) {
    flagged.push({
      key: homedirKey,
      dir: homedirBucket.dir,
      entryCount: homedirBucket.entryCount,
      reason: 'homedir()-fallback bucket may mix state from multiple unrelated local-only projects; review manually, do not auto-merge (ADR-0092 Consequences section 5)',
    });
  }

  return {
    projectRoot,
    canonicalKey,
    pathOnlyKey,
    homedirKey,
    projectsRoot: root,
    canonical: describeBucket(root, canonicalKey),
    actions,
    flagged,
    notes: [
      'Postgres run-store rows keyed by the pre-ADR-0092 cwd-based projectKey are out of scope for filesystem migration; re-scope or migrate those rows separately when using team/enterprise postgres mode.',
    ],
  };
}

/**
 * Apply the filesystem merges in `planProjectIdentityMigration`'s plan. Source
 * buckets are never deleted; callers confirm the canonical layout before removing
 * legacy directories manually.
 */
export function applyProjectIdentityMigration(projectRoot, options = {}) {
  const plan = planProjectIdentityMigration(projectRoot, options);
  const results = plan.actions.map((action) => ({
    ...action,
    ...mergeBucket(action.from, action.to, { dryRun: false }),
  }));
  return { plan, results };
}

export { mergeBucket, projectsRoot, describeBucket };
