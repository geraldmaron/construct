/**
 * lib/migrations/index.mjs — Schema migration registry and runner.
 *
 * Construct's machine-readable artifacts (specialists/registry.json, contracts.json,
 * role-manifests.json, .cx/config.json, profile JSON) carry an integer
 * `version` field. When the installed binary's expected schema version is
 * higher than the on-disk version, migrations apply in order. When the on-disk
 * version is higher, the runner refuses to load and instructs the operator to
 * upgrade.
 *
 * Each migration is a module under lib/migrations/ that exports:
 *   - from: integer
 *   - to: integer
 *   - apply(artifactPath, options): Promise<{ changed, summary }>
 *
 * v1 is the baseline — no migration needed. The registry below is the contract
 * between the installed binary and migration authors.
 */

import v1Baseline from './v1-baseline.mjs';

const REGISTRY = [
  v1Baseline,
];

export const CURRENT_SCHEMA_VERSION = Math.max(...REGISTRY.map((m) => m.to));

/**
 * Compute the migration path from `fromVersion` to CURRENT_SCHEMA_VERSION.
 * Returns an array of migrations to apply in order, or null if no path exists.
 */
export function planMigrations(fromVersion, toVersion = CURRENT_SCHEMA_VERSION) {
  if (fromVersion === toVersion) return [];
  if (fromVersion > toVersion) return null;
  const steps = [];
  let cursor = fromVersion;
  while (cursor < toVersion) {
    const step = REGISTRY.find((m) => m.from === cursor);
    if (!step) return null;
    steps.push(step);
    cursor = step.to;
  }
  return steps;
}

/**
 * Apply a planned migration sequence. Each step receives the artifact path
 * and any options. Returns a summary including every step's outcome.
 *
 * When dryRun is true, steps must not write to disk; they only report what
 * they would change.
 */
export async function runMigrations({ artifactPath, fromVersion, toVersion = CURRENT_SCHEMA_VERSION, dryRun = false }) {
  const plan = planMigrations(fromVersion, toVersion);
  if (plan === null) {
    return {
      ok: false,
      error: `no migration path from version ${fromVersion} to ${toVersion}`,
      applied: [],
    };
  }
  if (plan.length === 0) {
    return { ok: true, applied: [], summary: 'no migrations needed' };
  }

  const applied = [];
  for (const step of plan) {
    try {
      const result = await step.apply(artifactPath, { dryRun });
      applied.push({ from: step.from, to: step.to, ...result });
    } catch (err) {
      return {
        ok: false,
        error: `migration ${step.from}→${step.to} failed: ${err.message}`,
        applied,
      };
    }
  }
  return { ok: true, applied, summary: `applied ${applied.length} migration(s)` };
}

/**
 * Check artifact compatibility. Returns:
 *   { compatible: true }                              — versions match
 *   { compatible: false, needsMigration: true,  ... } — on-disk is older
 *   { compatible: false, needsUpgrade: true, ... }   — on-disk is newer
 */
export function checkCompatibility(artifactVersion, expected = CURRENT_SCHEMA_VERSION) {
  if (artifactVersion === expected) return { compatible: true };
  if (artifactVersion < expected) {
    return {
      compatible: false,
      needsMigration: true,
      fromVersion: artifactVersion,
      toVersion: expected,
      message: `artifact schema version ${artifactVersion} is older than expected ${expected}; run 'construct migrate'`,
    };
  }
  return {
    compatible: false,
    needsUpgrade: true,
    fromVersion: artifactVersion,
    toVersion: expected,
    message: `artifact schema version ${artifactVersion} is newer than this binary supports (${expected}); run 'construct upgrade'`,
  };
}
