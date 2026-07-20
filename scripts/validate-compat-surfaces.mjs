/**
 * scripts/validate-compat-surfaces.mjs — Compat-surface registry expiration
 * gate.
 *
 * Reads compat/surfaces.json and CHANGELOG.md, then reports any entry whose
 * expiration condition (a calendar date, or a release-count window since a
 * starting version) has passed while the surface is still shipping.
 *
 * Exits non-zero if any entry's current expiration has passed, or if any
 * entry is structurally malformed (missing required fields, or an
 * extensionHistory item with no documented reason).
 *
 * @enforces construct-tsyfe.10.6
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { checkSurfaces, parseChangelogVersions, validateSurfaceShape } from '../lib/compat/surfaces.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACES_PATH = resolve(ROOT, 'compat', 'surfaces.json');
const CHANGELOG_PATH = resolve(ROOT, 'CHANGELOG.md');

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[error] Failed to load ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

const surfaces = loadJSON(SURFACES_PATH);
const changelogText = fs.readFileSync(CHANGELOG_PATH, 'utf8');
const changelogVersions = parseChangelogVersions(changelogText);
const today = new Date().toISOString().slice(0, 10);

let exitCode = 0;

const shapeViolations = [];
for (const entry of surfaces) {
  const { valid, reason } = validateSurfaceShape(entry);
  if (!valid) shapeViolations.push(`${entry.id ?? '(no id)'}: ${reason}`);
}

if (shapeViolations.length > 0) {
  console.error(`\n[error] ${shapeViolations.length} compat-surface entry(ies) are structurally invalid:`);
  for (const msg of shapeViolations) {
    console.error(`  - ${msg}`);
  }
  exitCode = 1;
}

const { violations, ok } = checkSurfaces(surfaces, { today, changelogVersions });

if (violations.length > 0) {
  console.error(`\n[error] ${violations.length} compat-surface entry(ies) have passed their expiration and are still present:`);
  for (const v of violations) {
    console.error(`  - ${v.id} (${v.location}): ${v.detail}`);
  }
  console.error('\nEach must be removed, or given a documented extension (compat/surfaces.json entry.extensionHistory) with a new expiration and a stated reason.');
  exitCode = 1;
}

if (exitCode === 0) {
  console.log(`[ok] All ${surfaces.length} compat-surface entries are within their expiration window.`);
  for (const entry of ok) {
    console.log(`  - ${entry.id}: ${entry.detail}`);
  }
}

process.exit(exitCode);
