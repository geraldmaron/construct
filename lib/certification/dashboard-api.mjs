/**
 * lib/certification/dashboard-api.mjs — dashboard-safe certification status payload.
 *
 * Mirrors construct certify status for GET /api/certification/status without secrets.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildCertificationStatus } from './status.mjs';
import { loadCertificationStatus } from './stale-impact.mjs';
import { certificationRunDir, certificationRunsRoot, listCertificationRunIds, readCertificationRun } from './store.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function buildStaleRows({ rootDir }) {
  const { status } = loadCertificationStatus({ rootDir });
  if (!status?.capabilities) return [];
  return Object.entries(status.capabilities)
    .filter(([, entry]) => entry.status === 'stale')
    .map(([capabilityId, entry]) => ({
      capabilityId,
      staleSince: entry.staleSince ?? null,
      staleReason: entry.staleReason ?? null,
      stalePaths: entry.stalePaths ?? [],
    }));
}

export function buildCertificationDashboard({ rootDir = process.cwd() } = {}) {
  const root = findConstructRoot(rootDir);
  const report = buildCertificationStatus({ rootDir: root });
  const runs = [];
  for (const runId of listCertificationRunIds({ rootDir: root }).slice(-20)) {
    try {
      const { run } = readCertificationRun(runId, { rootDir: root });
      const dir = certificationRunDir(runId, root);
      runs.push({
        id: run.id,
        scenarioId: run.scenarioId,
        capabilityId: run.capabilityId,
        status: run.verdict?.status ?? 'unknown',
        createdAt: run.createdAt,
        artifactPath: path.relative(root, path.join(dir, 'run.json')),
      });
    } catch { /* skip corrupt */ }
  }
  return {
    generatedAt: report.generatedAt,
    capabilities: report.capabilities,
    specialists: report.specialists,
    skills: report.skills,
    artifactTypes: report.artifactTypes,
    documentCategories: report.documentCategories,
    demos: report.demos,
    stale: buildStaleRows({ rootDir: root }),
    runs,
    runsDir: path.relative(root, certificationRunsRoot(root)),
    artifactLinks: {
      runsRoot: '.cx/certification/runs',
      recentRunIds: runs.map((r) => r.id),
    },
  };
}
