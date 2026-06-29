/**
 * lib/certification/role-overlays.mjs — certify role overlay parity with specialists.
 *
 * Validates every shipped roles/*.md overlay binds to parent specialists, carries
 * anti-pattern sections, and matches registry roleOverlays references.
 */

import fs from 'node:fs';
import { loadRegistry } from '../registry/loader.mjs';
import path from 'node:path';

import { splitFrontmatter } from '../specialists/prompt-schema.mjs';

const OVERLAY_CLASSES = Object.freeze({
  architect: (key) => key.startsWith('architect'),
  engineer: (key) => key.startsWith('engineer') || key === 'debugger',
  qa: (key) => key.startsWith('qa'),
  security: (key) => key.startsWith('security'),
  pm: (key) => key.startsWith('product-manager'),
});

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'specialists', 'org'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function readRegistry(rootDir) {
  return loadRegistry({ rootDir: findConstructRoot(rootDir) });
}

function specialistIds(registry) {
  return new Set(Object.values(registry.specialists ?? {}).map((s) => `cx-${s.name}`));
}

function countAntiPatterns(body) {
  const heading = (body.match(/^###\s+\d+\./gm) ?? []).length;
  const numbered = (body.match(/^\d+\.\s+\*\*/gm) ?? []).length;
  return Math.max(heading, numbered);
}

export function validateRoleOverlayFile(relPath, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const absolute = path.join(root, 'skills', relPath.endsWith('.md') ? relPath : `${relPath}.md`);
  if (!fs.existsSync(absolute)) {
    return { key: relPath, pass: false, errors: [`missing overlay: ${relPath}`] };
  }
  const raw = fs.readFileSync(absolute, 'utf8');
  const { frontmatter, body } = splitFrontmatter(raw);
  const errors = [];
  const key = path.basename(absolute, '.md').replace(/^roles\//, '');

  if (!frontmatter?.role) errors.push(`${key}: frontmatter.role is required`);
  if (!Array.isArray(frontmatter?.applies_to) || frontmatter.applies_to.length === 0) {
    errors.push(`${key}: applies_to must list at least one specialist`);
  }
  if (countAntiPatterns(body) < 3) {
    errors.push(`${key}: expected at least three numbered anti-pattern sections`);
  }

  const registry = readRegistry(root);
  const ids = specialistIds(registry);
  for (const target of frontmatter?.applies_to ?? []) {
    if (!ids.has(target)) errors.push(`${key}: unknown applies_to specialist ${target}`);
  }

  let overlayClass = null;
  for (const [name, pred] of Object.entries(OVERLAY_CLASSES)) {
    if (pred(key)) {
      overlayClass = name;
      break;
    }
  }

  return {
    key,
    overlayClass,
    appliesTo: frontmatter?.applies_to ?? [],
    antiPatternCount: countAntiPatterns(body),
    appliesToCount: (frontmatter?.applies_to ?? []).length,
    pass: errors.length === 0,
    errors,
  };
}

export function validateAllRoleOverlays({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const rolesDir = path.join(root, 'skills', 'roles');
  const results = [];
  const errors = [];
  const classCoverage = new Set();

  for (const file of fs.readdirSync(rolesDir).filter((n) => n.endsWith('.md')).sort()) {
    const result = validateRoleOverlayFile(`roles/${file.replace(/\.md$/, '')}`, { rootDir: root });
    results.push(result);
    if (!result.pass) errors.push(...result.errors);
    if (result.overlayClass) classCoverage.add(result.overlayClass);
  }

  for (const required of Object.keys(OVERLAY_CLASSES)) {
    if (!classCoverage.has(required)) {
      errors.push(`missing representative overlay class: ${required}`);
    }
  }

  return {
    pass: errors.length === 0,
    overlayCount: results.length,
    classCoverage: [...classCoverage].sort(),
    results,
    errors,
  };
}
