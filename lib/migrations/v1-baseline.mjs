/**
 * lib/migrations/v1-baseline.mjs — No-op baseline migration.
 *
 * Marks v0 (pre-versioned artifacts) as compatible with v1 by stamping the
 * artifact with `version: 1` when absent. Schema bumps after v1 will add new
 * migrations rather than modifying this one.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export default {
  from: 0,
  to: 1,
  description: 'Stamp pre-versioned artifacts with version: 1 (no shape changes)',
  async apply(artifactPath, { dryRun = false } = {}) {
    if (!existsSync(artifactPath)) {
      return { changed: false, summary: `${artifactPath}: not present (skip)` };
    }
    let data;
    try { data = JSON.parse(readFileSync(artifactPath, 'utf8')); }
    catch (err) { throw new Error(`failed to parse ${artifactPath}: ${err.message}`); }

    if (data && typeof data === 'object' && data.version === 1) {
      return { changed: false, summary: `${artifactPath}: already at v1` };
    }

    const next = { ...data, version: 1 };
    if (!dryRun) {
      writeFileSync(artifactPath, JSON.stringify(next, null, 2) + '\n');
    }
    return { changed: true, summary: `${artifactPath}: stamped version: 1` };
  },
};
