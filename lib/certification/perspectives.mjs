/**
 * Certify perspective parity with canonical Worker Profiles.
 *
 * Every shipped perspective must bind to at least one exact Worker Profile id
 * and carry the minimum anti-pattern guidance contract.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { splitFrontmatter } from '../worker-profiles/prompt-schema.mjs';

const PERSPECTIVE_CLASSES = Object.freeze({
  architect: (key) => key.startsWith('architect'),
  engineer: (key) => key.startsWith('engineer') || key === 'debugger',
  qa: (key) => key.startsWith('qa'),
  security: (key) => key.startsWith('security'),
  pm: (key) => key.startsWith('product-manager'),
});

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'registry', 'worker-profiles'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readRegistry(rootDir) {
  return loadRegistry({ rootDir: findConstructRoot(rootDir), skipValidation: true });
}

function workerProfileIds(registry) {
  return new Set(Object.keys(registry.workerProfiles ?? {}));
}

function countAntiPatterns(body) {
  const heading = (body.match(/^###\s+\d+\./gm) ?? []).length;
  const numbered = (body.match(/^\d+\.\s+\*\*/gm) ?? []).length;
  return Math.max(heading, numbered);
}

export function validatePerspectiveFile(relPath, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const absolute = path.join(root, 'skills', relPath.endsWith('.md') ? relPath : `${relPath}.md`);
  if (!fs.existsSync(absolute)) {
    return { key: relPath, pass: false, errors: [`missing overlay: ${relPath}`] };
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const errors = [];
  const key = path.basename(absolute, '.md').replace(/^perspectives\//, '');

  if (!frontmatter?.perspective) errors.push(`${key}: frontmatter.perspective is required`);
  if (!Array.isArray(frontmatter?.applies_to) || frontmatter.applies_to.length === 0) {
    errors.push(`${key}: applies_to must list at least one Worker Profile id`);
  }
  if (countAntiPatterns(body) < 3) {
    errors.push(`${key}: expected at least three numbered anti-pattern sections`);
  }

  const registry = readRegistry(root);
  const ids = workerProfileIds(registry);
  for (const target of frontmatter?.applies_to ?? []) {
    if (!ids.has(target)) errors.push(`${key}: unknown applies_to Worker Profile ${target}`);
  }

  let perspectiveClass = null;
  for (const [name, pred] of Object.entries(PERSPECTIVE_CLASSES)) {
    if (pred(key)) {
      perspectiveClass = name;
      break;
    }
  }

  return {
    key,
    perspectiveClass,
    appliesToWorkerProfileIds: frontmatter?.applies_to ?? [],
    antiPatternCount: countAntiPatterns(body),
    appliesToCount: (frontmatter?.applies_to ?? []).length,
    pass: errors.length === 0,
    errors,
  };
}

export function validateAllPerspectives({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const perspectivesDir = path.join(root, 'skills', 'perspectives');
  const results = [];
  const errors = [];
  const perspectiveClassCoverage = new Set();

  for (const file of fs.readdirSync(perspectivesDir).filter((n) => n.endsWith('.md')).sort()) {
    const result = validatePerspectiveFile(`perspectives/${file.replace(/\.md$/, '')}`, { rootDir: root });
    results.push(result);
    if (!result.pass) errors.push(...result.errors);
    if (result.perspectiveClass) perspectiveClassCoverage.add(result.perspectiveClass);
  }

  for (const required of Object.keys(PERSPECTIVE_CLASSES)) {
    if (!perspectiveClassCoverage.has(required)) {
      errors.push(`missing representative overlay class: ${required}`);
    }
  }

  return {
    pass: errors.length === 0,
    perspectiveCount: results.length,
    perspectiveClassCoverage: [...perspectiveClassCoverage].sort(),
    results,
    errors,
  };
}
