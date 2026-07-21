/**
 * lib/registry/custom-loader.mjs — Load and merge custom Worker Profiles from
 * user- and project-scoped org tiers with the builtin registry catalog.
 *
 * Precedence follows ADR-0052 / ADR-0072: registry → user (~/.construct/org) →
 * project (.construct/org), with later tiers winning on id collision.
 */

import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry } from './loader.mjs';
import { customOrgDir } from './custom-scaffold.mjs';
import { recordId } from './catalog-format.mjs';

function readTierProfiles(orgDir, scope, { projectRoot }) {
  const dir = path.join(orgDir, 'worker-profiles');
  if (!fs.existsSync(dir)) return [];

  const rows = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }
    const id = record.id || record.name || name.slice(0, -'.json'.length);
    rows.push({
      ...record,
      id,
      source: scope,
      customPath: filePath,
      customRelPath: projectRoot ? path.relative(projectRoot, filePath) : filePath,
    });
  }
  return rows;
}

export function loadCustomWorkerProfileTiers({ cwd = process.cwd() } = {}) {
  const projectRoot = cwd;
  return {
    user: readTierProfiles(customOrgDir('user', { rootDir: projectRoot }), 'user', { projectRoot }),
    project: readTierProfiles(customOrgDir('project', { rootDir: projectRoot }), 'project', { projectRoot }),
  };
}

export function mergeWorkerProfiles({ rootDir, cwd = process.cwd() } = {}) {
  const registry = loadRegistry({ rootDir });
  const byId = new Map();

  for (const record of Object.values(registry.workerProfiles)) {
    byId.set(recordId(record), { ...record, source: 'registry' });
  }

  const tiers = loadCustomWorkerProfileTiers({ cwd });
  for (const record of tiers.user) {
    byId.set(recordId(record), record);
  }
  for (const record of tiers.project) {
    byId.set(recordId(record), record);
  }

  const records = [...byId.values()].sort((a, b) => recordId(a).localeCompare(recordId(b)));
  return { records, byId: Object.fromEntries(byId) };
}

export function getMergedWorkerProfile(id, opts = {}) {
  return mergeWorkerProfiles(opts).byId[id] || null;
}
