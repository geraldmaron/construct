/**
 * scripts/validate-dep-intent.mjs — Dependency-intent manifest validator.
 *
 * Reads package.json deps (dependencies, optionalDependencies, devDependencies)
 * and deps/intent.json, then reports:
 *   1. Any package.json dep missing from intent.json
 *   2. Any intent entry with disposition='remove' or 'quarantine' still present in package.json
 *   3. Any npm dependency/optionalDependency declared in intent but with zero imports in lib/ + bin/
 *
 * Exits non-zero if any missing entries are found.
 * Exits non-zero if a remove-dispositioned entry is still in package.json.
 * Declared-but-unused npm deps are warn-tier until purpose-drift cases are resolved.
 * Dependency budget ceilings (deps/budget.json) are warn-first install footprint.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { collectImportedPackageNames } from '../lib/graph/build-import-graph.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const INTENT_PATH = resolve(ROOT, 'deps', 'intent.json');
const BUDGET_PATH = resolve(ROOT, 'deps', 'budget.json');

const VALID_DISPOSITIONS = new Set([
  'core',
  'optional',
  'provider-plugin',
  'dev',
  'replace',
  'remove',
  'quarantine',
]);

const USAGE_SCAN_DISPOSITIONS = new Set(['core', 'optional', 'provider-plugin']);
const BUDGET_DISPOSITIONS = new Set(['core', 'optional', 'provider-plugin']);
const USAGE_SCAN_KIND_PREFIX = 'npm-';

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[error] Failed to load ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

export function auditDepIntent({
  rootDir = ROOT,
  pkgPath = PKG_PATH,
  intentPath = INTENT_PATH,
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const intentEntries = JSON.parse(fs.readFileSync(intentPath, 'utf8'));

  const runtimePkgDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  const pkgDeps = new Set([
    ...runtimePkgDeps,
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  const intentMap = new Map(intentEntries.map((entry) => [entry.id, entry]));
  const importedPackages = collectImportedPackageNames({ rootDir, sourceRoots: ['lib', 'bin'] });

  const missing = [];
  const invalidDispositions = [];
  const removeButPresent = [];
  const quarantineInPkg = [];
  const declaredButUnused = [];

  for (const dep of pkgDeps) {
    if (!intentMap.has(dep)) missing.push(dep);
  }

  for (const entry of intentEntries) {
    if (!VALID_DISPOSITIONS.has(entry.disposition)) {
      invalidDispositions.push(`${entry.id}: unknown disposition '${entry.disposition}'`);
    }

    if (entry.disposition === 'remove' && pkgDeps.has(entry.id)) {
      removeButPresent.push(entry.id);
    }

    if (entry.disposition === 'quarantine' && pkgDeps.has(entry.id)) {
      quarantineInPkg.push(entry.id);
    }

    const kind = entry.kind ?? '';
    if (
      runtimePkgDeps.has(entry.id)
      && kind.startsWith(USAGE_SCAN_KIND_PREFIX)
      && USAGE_SCAN_DISPOSITIONS.has(entry.disposition)
      && !importedPackages.has(entry.id)
    ) {
      declaredButUnused.push(entry.id);
    }
  }

  let exitCode = 0;
  if (missing.length > 0) exitCode = 1;
  if (invalidDispositions.length > 0) exitCode = 1;
  if (removeButPresent.length > 0) exitCode = 1;

  return {
    missing,
    invalidDispositions,
    removeButPresent,
    quarantineInPkg,
    declaredButUnused,
    importedPackages,
    exitCode,
    intentCount: intentEntries.length,
    pkgCount: pkgDeps.size,
  };
}

export function auditDepBudget({
  rootDir = ROOT,
  pkgPath = PKG_PATH,
  intentPath = INTENT_PATH,
  budgetPath = BUDGET_PATH,
} = {}) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const intentEntries = JSON.parse(fs.readFileSync(intentPath, 'utf8'));
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

  const runtimePkgDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);

  const counts = {
    core: 0,
    optional: 0,
    'provider-plugin': 0,
    runtimeTotal: 0,
  };

  for (const entry of intentEntries) {
    if (!runtimePkgDeps.has(entry.id)) continue;
    if (!BUDGET_DISPOSITIONS.has(entry.disposition)) continue;
    counts[entry.disposition] += 1;
    counts.runtimeTotal += 1;
  }

  const ceilings = budget.ceilings ?? {};
  const overBudget = [];
  for (const tier of ['core', 'optional', 'provider-plugin', 'runtimeTotal']) {
    const ceiling = ceilings[tier];
    if (ceiling == null) continue;
    if (counts[tier] > ceiling) {
      overBudget.push({ tier, count: counts[tier], ceiling });
    }
  }

  const warnFirst = budget.warnFirst !== false;
  let exitCode = 0;
  if (overBudget.length > 0 && !warnFirst) exitCode = 1;

  return {
    counts,
    ceilings,
    overBudget,
    warnFirst,
    exitCode,
  };
}

function reportAudit(result) {
  let exitCode = result.exitCode;

  if (result.missing.length > 0) {
    console.error(`\n[error] ${result.missing.length} package(s) in package.json have no entry in deps/intent.json:`);
    for (const dep of result.missing) console.error(`  - ${dep}`);
  }

  if (result.invalidDispositions.length > 0) {
    console.error(`\n[error] ${result.invalidDispositions.length} intent entry(ies) have invalid dispositions:`);
    for (const msg of result.invalidDispositions) console.error(`  - ${msg}`);
  }

  if (result.removeButPresent.length > 0) {
    console.error(`\n[error] ${result.removeButPresent.length} dep(s) marked disposition=remove are still present in package.json:`);
    for (const dep of result.removeButPresent) {
      console.error(`  - ${dep} (remove from package.json or change disposition)`);
    }
  }

  if (result.quarantineInPkg.length > 0) {
    console.warn(`\n[warn] ${result.quarantineInPkg.length} dep(s) marked disposition=quarantine are present in package.json:`);
    for (const dep of result.quarantineInPkg) {
      console.warn(`  - ${dep} (quarantined — do not use in new code; see deps/intent.json for removalCriteria)`);
    }
  }

  if (result.declaredButUnused.length > 0) {
    console.warn(`\n[warn] ${result.declaredButUnused.length} npm dep(s) are declared in deps/intent.json and package.json but have zero imports in lib/ + bin/:`);
    for (const dep of result.declaredButUnused) {
      console.warn(`  - ${dep} (declared purpose not reflected in source imports; see deps/intent.json)`);
    }
  }

  if (exitCode === 0 && result.missing.length === 0 && result.removeButPresent.length === 0) {
    console.log(`[ok] All ${result.pkgCount} package.json dep(s) have intent entries. Total intent entries: ${result.intentCount}.`);
    if (result.quarantineInPkg.length > 0) {
      console.log(`     ${result.quarantineInPkg.length} quarantined dep(s) noted above.`);
    }
    if (result.declaredButUnused.length > 0) {
      console.log(`     ${result.declaredButUnused.length} declared-but-unused dep(s) noted above (warn-tier).`);
    }
  }

  return exitCode;
}

function reportBudget(result) {
  let exitCode = result.exitCode;

  if (result.overBudget.length > 0) {
    const label = result.warnFirst ? 'warn' : 'error';
    const writer = result.warnFirst ? console.warn : console.error;
    writer(`\n[${label}] dependency budget exceeded (${result.overBudget.length} tier(s)):`);
    for (const row of result.overBudget) {
      writer(`  - ${row.tier}: ${row.count} > ceiling ${row.ceiling}`);
    }
    if (!result.warnFirst) exitCode = 1;
  } else {
    console.log(
      `[ok] Dependency budget: runtimeTotal=${result.counts.runtimeTotal}/${result.ceilings.runtimeTotal ?? 'n/a'} `
      + `(core=${result.counts.core}, optional=${result.counts.optional}, provider-plugin=${result.counts['provider-plugin']}).`,
    );
  }

  return exitCode;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const auditResult = auditDepIntent();
  const budgetResult = auditDepBudget();
  const auditExit = reportAudit(auditResult);
  const budgetExit = reportBudget(budgetResult);
  process.exit(Math.max(auditExit, budgetExit));
}
