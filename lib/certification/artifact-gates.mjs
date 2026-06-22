/**
 * lib/certification/artifact-gates.mjs — per-type structural and visual certification matrix.
 *
 * Validates golden artifact fixtures under tests/fixtures/artifacts/<type>/ against
 * artifact-manifest release gates (layout, accessibility hints, visual requirements).
 */

import fs from 'node:fs';
import path from 'node:path';

import { artifactTypes, getArtifactEntry } from '../artifact-manifest.mjs';
import { validateArtifactRelease } from '../artifact-release-gate.mjs';
import { goldenFixturePath } from './artifact-fixtures.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function artifactGateMatrix({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  return artifactTypes({ rootDir: root }).map((type) => {
    const entry = getArtifactEntry(type, { rootDir: root });
    return {
      type,
      structureRequirements: entry?.structureRequirements ?? [],
      visualRequirements: (entry?.visualRequirements ?? []).map((v) => v.check),
      releaseGate: entry?.releaseGate ?? {},
    };
  });
}

export function validateAllGoldenArtifactGates({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const results = [];
  const errors = [];
  for (const type of artifactTypes({ rootDir: root })) {
    const filePath = goldenFixturePath(type, { rootDir: root });
    if (!fs.existsSync(filePath)) {
      errors.push(`missing golden fixture: ${type}`);
      results.push({ type, pass: false, detail: 'missing fixture' });
      continue;
    }
    const validation = validateArtifactRelease({ filePath, type, rootDir: root });
    results.push({ type, pass: validation.ok === true, errors: validation.errors ?? [] });
    if (!validation.ok) errors.push(`${type}: ${validation.errors?.[0] ?? 'gate failed'}`);
  }
  return { pass: errors.length === 0, results, errors, matrix: artifactGateMatrix({ rootDir: root }) };
}

export function writeArtifactGateMatrixDoc({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const out = path.join(root, 'tests', 'certification', 'artifacts', 'gate-matrix.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const payload = { generatedAt: new Date().toISOString(), matrix: artifactGateMatrix({ rootDir: root }) };
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  return out;
}
