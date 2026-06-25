/**
 * lib/migrations/v2-unified-registry.mjs — v1 → v2 schema stamp.
 *
 * v2 is the version that unified-registry.json was born at when the legacy
 * specialists/registry.json + contracts.json + teams.json were consolidated
 * into a single unified file. Artifacts already at v2 need no shape change.
 * For any v1 artifact carrying the old flat-registry shape, this stamps the
 * version field so the migrate runner reports "already at v2" on re-run.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export default {
  from: 1,
  to: 2,
  description: 'Stamp legacy v1 artifacts with version: 2 (no shape changes required)',
  async apply(artifactPath, { dryRun = false } = {}) {
    if (!existsSync(artifactPath)) {
      return { changed: false, summary: `${artifactPath}: not present (skip)` };
    }
    let data;
    try { data = JSON.parse(readFileSync(artifactPath, 'utf8')); }
    catch (err) { throw new Error(`failed to parse ${artifactPath}: ${err.message}`); }

    if (data && typeof data === 'object' && data.version === 2) {
      return { changed: false, summary: `${artifactPath}: already at v2` };
    }

    const next = { ...data, version: 2 };
    if (!dryRun) {
      writeFileSync(artifactPath, JSON.stringify(next, null, 2) + '\n');
    }
    return { changed: true, summary: `${artifactPath}: stamped version: 2` };
  },
};
