/**
 * lib/certification/canonical-scenarios.mjs — versioned canonical demo scenario catalog.
 *
 * Loads tests/certification/demos/canonical-scenarios.json and validates that
 * cited tape and theme paths exist under templates/demos/.
 */

import fs from 'node:fs';
import path from 'node:path';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export const CANONICAL_DEMO_SCHEMA = 'construct/certification/canonical-demos/1';

export function defaultCanonicalScenariosPath(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'certification', 'demos', 'canonical-scenarios.json');
}

export function loadCanonicalScenarios({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const filePath = defaultCanonicalScenariosPath(root);
  const catalog = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { root, filePath, catalog };
}

export function validateCanonicalScenarios({ rootDir, catalog: supplied } = {}) {
  const root = findConstructRoot(rootDir);
  const catalog = supplied ?? JSON.parse(fs.readFileSync(defaultCanonicalScenariosPath(root), 'utf8'));
  const errors = [];

  if (catalog.version !== 1) errors.push('canonical-scenarios.version must equal 1');
  if (catalog.schema !== CANONICAL_DEMO_SCHEMA) errors.push(`canonical-scenarios.schema must equal ${CANONICAL_DEMO_SCHEMA}`);
  if (!Array.isArray(catalog.demos) || catalog.demos.length < 2) errors.push('canonical-scenarios.demos must contain at least two entries');

  const ids = new Set();
  for (const demo of catalog.demos ?? []) {
    if (!demo.id || typeof demo.id !== 'string') {
      errors.push('demo entry missing id');
      continue;
    }
    if (ids.has(demo.id)) errors.push(`${demo.id}: duplicate demo id`);
    ids.add(demo.id);

    const tape = demo.tape ?? demo.tapePath;
    if (!tape) errors.push(`${demo.id}: tape path is required`);
    else if (!fs.existsSync(path.join(root, tape))) errors.push(`${demo.id}: tape does not exist: ${tape}`);

    for (const ref of demo.references ?? []) {
      if (!fs.existsSync(path.join(root, ref))) errors.push(`${demo.id}: reference does not exist: ${ref}`);
    }
    if (demo.vhsTheme && !fs.existsSync(path.join(root, demo.vhsTheme))) {
      errors.push(`${demo.id}: vhsTheme does not exist: ${demo.vhsTheme}`);
    }
    if (demo.script && !fs.existsSync(path.join(root, demo.script))) {
      errors.push(`${demo.id}: script does not exist: ${demo.script}`);
    }
  }

  const required = ['agentic-platforms-prd', 'construct-cockpit'];
  for (const id of required) {
    if (!ids.has(id)) errors.push(`required demo missing: ${id}`);
  }

  return {
    filePath: defaultCanonicalScenariosPath(root),
    demoCount: catalog.demos?.length ?? 0,
    errors,
    pass: errors.length === 0,
  };
}
