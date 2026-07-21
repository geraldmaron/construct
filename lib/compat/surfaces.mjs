/**
 * lib/compat/surfaces.mjs — expiration-check logic for the compat-surface
 * registry (compat/surfaces.json).
 *
 * Every retained compatibility shim (a deprecated CLI alias, a one-time
 * migration module, an opt-in legacy-cleanup module) records an owner and an
 * expiration condition instead of just a comment. Two expiration shapes are
 * supported: a calendar date, or a release-count window (N published versions
 * since a starting version) mirroring ADR-0053's "2 release cycles" language.
 * "Release" for the count is any version heading in CHANGELOG.md, since this
 * repo ships multiple patch versions per day — a minor-version-only count
 * would let a shim outlive its stated window by months.
 *
 * Entries with `status: "removed"` are honest tombstones: they stay in the
 * registry for audit but are never unresolved-expired, and their location
 * must not claim a live handler or module path.
 *
 * Pure functions here take the registry, the parsed CHANGELOG version list,
 * and "today" as explicit inputs so the expiration logic itself is testable
 * against fixtures without touching the real registry or real dates.
 */

import { compareSemver } from '../version.mjs';

const CHANGELOG_VERSION_HEADING = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/;

/**
 * Parse `## [x.y.z] - YYYY-MM-DD` headings out of a CHANGELOG.md body, in
 * file order. Skips `[Unreleased]` (no version, not a shipped release).
 */
export function parseChangelogVersions(changelogText) {
  const versions = [];
  for (const line of changelogText.split('\n')) {
    const match = line.match(CHANGELOG_VERSION_HEADING);
    if (!match) continue;
    versions.push({ version: match[1], date: match[2] });
  }
  return versions;
}

/**
 * Count how many entries in `changelogVersions` shipped after `sinceVersion`
 * (strict semver greater-than; entries equal to or older than sinceVersion
 * don't count as a subsequent release cycle).
 */
export function countReleasesSince(changelogVersions, sinceVersion) {
  return changelogVersions.filter((entry) => compareSemver(entry.version, sinceVersion) > 0).length;
}

function isDateExpired(dateStr, today) {
  return new Date(today).getTime() > new Date(dateStr).getTime();
}

/**
 * Evaluate whether a single registry entry's CURRENT expiration has passed.
 * Returns { expired, detail } — detail is a human-readable reason string used
 * in check-script/test failure messages.
 */
export function isExpired(entry, { today, changelogVersions } = {}) {
  if (entry?.status === 'removed') {
    return { expired: false, detail: 'tombstone: surface already removed' };
  }

  const expiration = entry.expiration;
  if (!expiration || typeof expiration !== 'object') {
    return { expired: false, detail: 'no expiration configured' };
  }

  if (expiration.type === 'date') {
    const expired = isDateExpired(expiration.date, today);
    return {
      expired,
      detail: expired
        ? `date expiration ${expiration.date} has passed (as of ${today})`
        : `date expiration ${expiration.date} not yet reached (as of ${today})`,
    };
  }

  if (expiration.type === 'releaseCount') {
    const count = countReleasesSince(changelogVersions ?? [], expiration.sinceVersion);
    const expired = count >= expiration.cycles;
    return {
      expired,
      detail: expired
        ? `${count} release(s) shipped since ${expiration.sinceVersion}, meeting or exceeding the ${expiration.cycles}-cycle window`
        : `${count} release(s) shipped since ${expiration.sinceVersion}, within the ${expiration.cycles}-cycle window`,
    };
  }

  throw new Error(`compat surface '${entry.id}': unknown expiration.type '${expiration.type}'`);
}

/**
 * Evaluate every entry in a registry array against the same { today,
 * changelogVersions } context. Returns { violations, ok } — violations are
 * entries whose current expiration has passed, each annotated with the
 * isExpired() detail string.
 */
export function checkSurfaces(surfaces, context) {
  const violations = [];
  const ok = [];
  for (const entry of surfaces) {
    const { expired, detail } = isExpired(entry, context);
    (expired ? violations : ok).push({ id: entry.id, location: entry.location, detail });
  }
  return { violations, ok };
}

export const REQUIRED_SURFACE_FIELDS = ['id', 'location', 'description', 'adr', 'owner', 'expiration', 'extensionHistory'];

/**
 * Structural validation independent of expiration state: every entry carries
 * the required fields, and every extensionHistory item (if any) carries a
 * reason and a new expiration, so an extension is never a silent field bump.
 */
export function validateSurfaceShape(entry) {
  const missing = REQUIRED_SURFACE_FIELDS.filter((field) => !(field in entry));
  if (missing.length > 0) {
    return { valid: false, reason: `missing field(s): ${missing.join(', ')}` };
  }
  if (!Array.isArray(entry.extensionHistory)) {
    return { valid: false, reason: 'extensionHistory must be an array' };
  }
  for (const [index, ext] of entry.extensionHistory.entries()) {
    if (!ext.reason || typeof ext.reason !== 'string' || ext.reason.trim() === '') {
      return { valid: false, reason: `extensionHistory[${index}] missing a non-empty reason` };
    }
    if (!ext.newExpiration || typeof ext.newExpiration !== 'object') {
      return { valid: false, reason: `extensionHistory[${index}] missing newExpiration` };
    }
  }
  return { valid: true };
}
