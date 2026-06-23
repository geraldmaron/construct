/**
 * lib/capability-ledger.mjs — behavior-to-test traceability for release-critical surfaces.
 *
 * The ledger describes observable product capabilities, not implementation units. A
 * capability entry identifies the outcome, failure modes, affected paths, fixtures,
 * and test files that verify it. Validation is deliberately bidirectional: every
 * listed test must declare the capability id in its source, preventing an unmaintained JSON
 * entry from claiming coverage when its test source lacks the marker.
 */

import fs from 'node:fs';
import path from 'node:path';

export const TEST_LAYERS = Object.freeze([
  'unit',
  'integration',
  'functional',
  'host-emulation',
  'live-provider',
  'visual',
]);

export const CRITICALITIES = Object.freeze(['release', 'important', 'standard']);

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

export function defaultLedgerPath(rootDir = process.cwd()) {
  return path.join(findConstructRoot(rootDir), 'tests', 'capabilities', 'ledger.json');
}

export function loadCapabilityLedger({ rootDir } = {}) {
  const filePath = defaultLedgerPath(rootDir);
  return { filePath, ledger: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(hasText);
}

function testDeclaresCapability(testPath, id) {
  try {
    return fs.readFileSync(testPath, 'utf8').includes(`@capability ${id}`);
  } catch {
    return false;
  }
}

export function validateCapabilityLedger({ rootDir, ledger: suppliedLedger } = {}) {
  const root = findConstructRoot(rootDir);
  const loaded = suppliedLedger ? { filePath: null, ledger: suppliedLedger } : loadCapabilityLedger({ rootDir: root });
  const ledger = loaded.ledger;
  const errors = [];
  const warnings = [];
  const ids = new Set();
  let mappedTestCount = 0;

  if (ledger?.version !== 1) errors.push('ledger.version must equal 1');
  if (!Array.isArray(ledger?.capabilities) || ledger.capabilities.length === 0) {
    errors.push('ledger.capabilities must contain at least one capability');
  }

  for (const capability of ledger?.capabilities ?? []) {
    const id = capability?.id;
    if (!hasText(id) || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(id)) {
      errors.push(`capability has invalid id: ${String(id)}`);
      continue;
    }
    if (ids.has(id)) errors.push(`${id}: duplicate capability id`);
    ids.add(id);

    if (!hasText(capability.outcome)) errors.push(`${id}: outcome must describe an observable user or system result`);
    if (!hasStringArray(capability.failureModes)) errors.push(`${id}: failureModes must name at least one failure mode`);
    if (!hasStringArray(capability.changePaths)) errors.push(`${id}: changePaths must identify affected implementation paths`);
    if (!CRITICALITIES.includes(capability.criticality)) errors.push(`${id}: criticality must be one of ${CRITICALITIES.join(', ')}`);
    if (!hasStringArray(capability.assertions)) errors.push(`${id}: assertions must describe observable checks`);
    if (!Array.isArray(capability.tests) || capability.tests.length === 0) {
      errors.push(`${id}: tests must contain at least one test reference`);
      continue;
    }

    const layers = new Set();
    for (const test of capability.tests) {
      const relPath = test?.path;
      if (!hasText(relPath)) {
        errors.push(`${id}: test path is required`);
        continue;
      }
      const absolutePath = path.join(root, relPath);
      if (!fs.existsSync(absolutePath)) errors.push(`${id}: test file does not exist: ${relPath}`);
      if (!TEST_LAYERS.includes(test?.layer)) errors.push(`${id}: ${relPath} has invalid layer ${String(test?.layer)}`);
      if (!testDeclaresCapability(absolutePath, id)) errors.push(`${id}: ${relPath} must declare @capability ${id}`);
      layers.add(test?.layer);
      mappedTestCount += 1;
    }

    if (capability.criticality === 'release' && !['functional', 'host-emulation', 'integration', 'visual'].some((layer) => layers.has(layer))) {
      errors.push(`${id}: release-critical capability needs integration, functional, host-emulation, or visual coverage`);
    }

    for (const fixture of capability.fixtures ?? []) {
      if (!hasText(fixture) || !fs.existsSync(path.join(root, fixture))) errors.push(`${id}: fixture does not exist: ${String(fixture)}`);
    }
    if (!Array.isArray(capability.fixtures) || capability.fixtures.length === 0) warnings.push(`${id}: no committed fixture declared`);
  }

  return {
    filePath: loaded.filePath,
    capabilityCount: ledger?.capabilities?.length ?? 0,
    mappedTestCount,
    errors,
    warnings,
    pass: errors.length === 0,
  };
}

export function formatCapabilityLedgerAudit(result) {
  const lines = [
    'Construct capability ledger audit',
    '════════════════════════════════',
    `  Capabilities: ${result.capabilityCount}`,
    `  Test references: ${result.mappedTestCount}`,
    '',
  ];
  if (result.errors.length) {
    lines.push(`  ✗ Errors (${result.errors.length}):`);
    result.errors.forEach((error) => lines.push(`      - ${error}`));
  } else {
    lines.push('  ✓ Every mapped test declares its observable capability');
  }
  if (result.warnings.length) {
    lines.push('', `  ⚠ Warnings (${result.warnings.length}):`);
    result.warnings.forEach((warning) => lines.push(`      - ${warning}`));
  }
  lines.push('', result.pass ? '  Result: PASS' : '  Result: FAIL');
  return `${lines.join('\n')}\n`;
}

export function runCapabilityLedgerAuditCli(args = [], { rootDir } = {}) {
  const result = validateCapabilityLedger({ rootDir });
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(formatCapabilityLedgerAudit(result));
  if (!result.pass) process.exitCode = 1;
  return result;
}
