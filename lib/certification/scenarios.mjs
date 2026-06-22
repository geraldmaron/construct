/**
 * lib/certification/scenarios.mjs — load certification scenario catalog and fixtures.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function defaultScenarioCatalogPath(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'certification', 'scenarios', 'catalog.json');
}

export function loadScenarioCatalog({ repoRoot } = {}) {
  const root = findConstructRoot(repoRoot);
  const filePath = defaultScenarioCatalogPath(root);
  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { root, filePath, catalog };
}

export function listScenarios({ repoRoot } = {}) {
  const { catalog } = loadScenarioCatalog({ repoRoot });
  return catalog.scenarios ?? [];
}

export function getScenario(scenarioId, { repoRoot } = {}) {
  const { root, catalog } = loadScenarioCatalog({ repoRoot });
  const scenario = (catalog.scenarios ?? []).find((entry) => entry.id === scenarioId);
  if (!scenario) throw new Error(`unknown certification scenario: ${scenarioId}`);
  return { root, scenario };
}

export function fixtureDigest(root, relPath) {
  const absolute = path.join(root, relPath);
  if (!fs.existsSync(absolute)) throw new Error(`fixture does not exist: ${relPath}`);
  return createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

export function newRunId(scenarioId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `cert-${scenarioId.replace(/[^a-z0-9.-]+/gi, '-')}-${stamp}`;
}
