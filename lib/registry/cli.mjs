/**
 * CLI handlers for the canonical Construct registry.
 *
 * Registry records are exposed through their product nouns. This module has
 * no lifecycle editors or compatibility surface for retired organization
 * concepts; catalog changes are made in their canonical source files.
 */

import path from 'node:path';
import { validateCapabilityRegistry, loadCapabilityRegistry } from './validate.mjs';
import { generateCapabilitiesDoc, checkCapabilitiesDocDrift } from './generate-docs.mjs';
import { generateAgentManifest, checkAgentManifestDrift } from './agent-manifest.mjs';
import { loadRegistry } from './loader.mjs';
import { validate as validateUnifiedRegistry } from './validator.mjs';

const CATALOGS = Object.freeze({
  'workspace-preset': { field: 'workspacePresets', label: 'Workspace Preset' },
  'worker-profile': { field: 'workerProfiles', label: 'Worker Profile' },
  procedure: { field: 'procedures', label: 'Procedure' },
  capability: { field: 'capabilities', label: 'Capability' },
  policy: { field: 'policies', label: 'Policy' },
});

function catalogFor(noun) {
  const catalog = CATALOGS[noun];
  if (!catalog) throw new Error(`Unknown registry noun: ${noun}`);
  return catalog;
}

export async function runUnifiedRegistryValidate(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const jsonOutput = args.includes('--json');
  const registryPath = path.join(rootDir, 'registry');

  let registry;
  try {
    const { clearCache } = await import('./loader.mjs');
    clearCache();
    registry = loadRegistry({ rootDir });
  } catch (err) {
    const message = `Cannot load registry from ${registryPath}: ${err.message}`;
    if (jsonOutput) println(JSON.stringify({ ok: false, registryPath, errors: [{ id: 'unreadable', message }], warnings: [] }, null, 2));
    else errorln(`✗ ${message}`);
    return 1;
  }

  const result = validateUnifiedRegistry(registry);
  const counts = Object.fromEntries(Object.values(CATALOGS).map(({ field }) => [field, Object.keys(registry[field]).length]));

  if (jsonOutput) {
    println(JSON.stringify({ ok: result.ok, registryPath, ...counts, errors: result.errors, warnings: result.warnings }, null, 2));
    return result.ok ? 0 : 1;
  }

  println(`Registry: ${registryPath}`);
  println(`Workspace Presets: ${counts.workspacePresets}  Worker Profiles: ${counts.workerProfiles}  Procedures: ${counts.procedures}  Capabilities: ${counts.capabilities}  Policies: ${counts.policies}`);
  if (result.errors.length) {
    errorln(`Errors (${result.errors.length}):`);
    for (const entry of result.errors) errorln(`  ✗ ${entry.id}: ${entry.message}`);
  }
  if (result.warnings.length) {
    println(`Warnings (${result.warnings.length}):`);
    for (const entry of result.warnings) println(`  ⚠ ${entry.id}: ${entry.message}`);
  }
  if (result.ok && !result.warnings.length) println('✓ Registry valid');
  else if (result.ok) println('✓ Registry valid (with warnings)');
  else errorln('✗ Registry invalid');
  return result.ok ? 0 : 1;
}

export async function runRegistryStatus(args = [], { rootDir, println = console.log } = {}) {
  const { capabilities = [] } = loadCapabilityRegistry({ rootDir });
  if (args.includes('--json')) {
    println(JSON.stringify(capabilities, null, 2));
    return 0;
  }

  println('Construct Capability Registry');
  println('='.repeat(40));
  println('');
  for (const capability of capabilities) {
    const tier = capability.criticality ?? '—';
    println(`[${tier}] ${capability.name ?? capability.id} (${capability.id})`);
    if (capability.description) println(`  ${capability.description}`);
    const surfaces = Object.entries(capability.surfaces ?? {}).filter(([, value]) => value?.supported);
    if (surfaces.length) println(`  surfaces: ${surfaces.map(([name]) => name).join(', ')}`);
    const validated = capability.lastValidated ? capability.lastValidated.slice(0, 10) : 'never';
    println(`  humanGate: ${capability.humanGate ?? '—'}  lastValidated: ${validated}`);
    println('');
  }
  return 0;
}

export async function runRegistryValidate(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.includes('--unified')) return runUnifiedRegistryValidate(args, { rootDir, println, errorln });
  const report = validateCapabilityRegistry({ rootDir });
  if (args.includes('--json')) {
    println(JSON.stringify(report, null, 2));
    return report.valid ? 0 : 1;
  }
  println(`Registry: ${report.registryPath}`);
  println(`Entries: ${report.count}`);
  if (report.errors.length) {
    errorln(`Errors (${report.errors.length}):`);
    for (const error of report.errors) errorln(`  ✗ ${error}`);
  }
  if (report.warnings.length) {
    println(`Warnings (${report.warnings.length}):`);
    for (const warning of report.warnings) println(`  ⚠ ${warning}`);
  }
  if (report.valid && !report.warnings.length) println('✓ Registry valid');
  else if (report.valid) println('✓ Registry valid (with warnings)');
  else errorln('✗ Registry invalid');
  return report.valid ? 0 : 1;
}

export async function runRegistryGenerateDocs(args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  if (args.includes('--check')) {
    let failed = false;
    if (checkCapabilitiesDocDrift({ rootDir }).drift) {
      errorln('capabilities.md drift — run `construct registry:generate-docs`');
      failed = true;
    } else println('capabilities.md is up to date');
    if (checkAgentManifestDrift({ rootDir }).drift) {
      errorln('agent-manifest.json drift — run `construct registry:generate-docs`');
      failed = true;
    } else println('agent-manifest.json is up to date');
    return failed ? 1 : 0;
  }
  const out = generateCapabilitiesDoc({ rootDir });
  println(`Generated ${out}`);
  const { path: manifestPath } = generateAgentManifest({ rootDir });
  println(`Generated ${manifestPath}`);
  return 0;
}

export async function runCatalogList(noun, args = [], { rootDir, println = console.log } = {}) {
  const { field, label } = catalogFor(noun);
  const records = Object.values(loadRegistry({ rootDir })[field]).sort((a, b) => a.id.localeCompare(b.id));
  if (args.includes('--json')) {
    println(JSON.stringify(records, null, 2));
    return 0;
  }
  if (!records.length) {
    println(`No ${label.toLowerCase()} records found.`);
    return 0;
  }
  for (const record of records) println(`${record.id.padEnd(32)} ${record.displayName || record.name || record.description || ''}`.trimEnd());
  return 0;
}

export async function runCatalogShow(noun, args = [], { rootDir, println = console.log, errorln = console.error } = {}) {
  const { field, label } = catalogFor(noun);
  const id = args.find((arg) => !arg.startsWith('--'));
  if (!id) {
    errorln(`Usage: construct ${noun} show <id>`);
    return 1;
  }
  const record = loadRegistry({ rootDir })[field][id];
  if (!record) {
    errorln(`${label} not found: ${id}`);
    return 1;
  }
  println(JSON.stringify(record, null, 2));
  return 0;
}

export async function runCatalogCommand(noun, args = [], io = {}) {
  const subcommand = args[0] || 'list';
  if (subcommand === 'list') return runCatalogList(noun, args.slice(1), io);
  if (subcommand === 'show') return runCatalogShow(noun, args.slice(1), io);
  (io.errorln || console.error)(`Unknown ${noun} subcommand: ${subcommand}. Available: list, show`);
  return 1;
}

export function registryCatalogNames() {
  return Object.keys(CATALOGS);
}
