/**
 * scripts/validate-dep-intent.mjs — Dependency-intent manifest validator.
 *
 * Reads package.json deps (dependencies, optionalDependencies, devDependencies)
 * and deps/intent.json, then reports:
 *   1. Any package.json dep missing from intent.json
 *   2. Any intent entry with disposition='remove' or 'quarantine' still present in package.json
 *
 * Exits non-zero if any missing entries are found.
 * Exits non-zero if a remove-dispositioned entry is still in package.json.
 *
 * @enforces ADR-0059 (dependency-intent rubric)
 * @bead construct-9oi4.11.1
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const INTENT_PATH = resolve(ROOT, 'deps', 'intent.json');

const VALID_DISPOSITIONS = new Set([
  'core',
  'optional',
  'provider-plugin',
  'dev',
  'replace',
  'remove',
  'quarantine',
]);

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[error] Failed to load ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

const pkg = loadJSON(PKG_PATH);
const intentEntries = loadJSON(INTENT_PATH);

// Build set of all package.json package names (excluding binary sidecars which are not in package.json)
const pkgDeps = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);

// Build map of intent entries by id
const intentMap = new Map(intentEntries.map((entry) => [entry.id, entry]));

let exitCode = 0;
const missing = [];
const invalidDispositions = [];
const removeButPresent = [];
const quarantineInPkg = [];

// Check every package.json dep has an intent entry
for (const dep of pkgDeps) {
  if (!intentMap.has(dep)) {
    missing.push(dep);
  }
}

// Check intent entries for validity
for (const entry of intentEntries) {
  if (!VALID_DISPOSITIONS.has(entry.disposition)) {
    invalidDispositions.push(`${entry.id}: unknown disposition '${entry.disposition}'`);
  }

  // deps with disposition=remove that are still in package.json are violations
  if (entry.disposition === 'remove' && pkgDeps.has(entry.id)) {
    removeButPresent.push(entry.id);
  }

  // deps with disposition=quarantine that ARE in package.json get a warning (not an error)
  // per ADR-0059: quarantine = present but unintentional; must not be used in new code
  if (entry.disposition === 'quarantine' && pkgDeps.has(entry.id)) {
    quarantineInPkg.push(entry.id);
  }
}

// Report results
if (missing.length > 0) {
  console.error(`\n[error] ${missing.length} package(s) in package.json have no entry in deps/intent.json:`);
  for (const dep of missing) {
    console.error(`  - ${dep}`);
  }
  exitCode = 1;
}

if (invalidDispositions.length > 0) {
  console.error(`\n[error] ${invalidDispositions.length} intent entry(ies) have invalid dispositions:`);
  for (const msg of invalidDispositions) {
    console.error(`  - ${msg}`);
  }
  exitCode = 1;
}

if (removeButPresent.length > 0) {
  console.error(`\n[error] ${removeButPresent.length} dep(s) marked disposition=remove are still present in package.json:`);
  for (const dep of removeButPresent) {
    console.error(`  - ${dep} (remove from package.json or change disposition)`);
  }
  exitCode = 1;
}

if (quarantineInPkg.length > 0) {
  console.warn(`\n[warn] ${quarantineInPkg.length} dep(s) marked disposition=quarantine are present in package.json:`);
  for (const dep of quarantineInPkg) {
    console.warn(`  - ${dep} (quarantined — do not use in new code; see deps/intent.json for removalCriteria)`);
  }
  // quarantine is a warning, not an error per ADR-0059
}

if (exitCode === 0 && missing.length === 0 && removeButPresent.length === 0) {
  const intentCount = intentEntries.length;
  const pkgCount = pkgDeps.size;
  console.log(`[ok] All ${pkgCount} package.json dep(s) have intent entries. Total intent entries: ${intentCount}.`);
  if (quarantineInPkg.length > 0) {
    console.log(`     ${quarantineInPkg.length} quarantined dep(s) noted above.`);
  }
}

process.exit(exitCode);
