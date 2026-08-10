/**
 * CLI handlers for the canonical Construct registry.
 *
 * Registry records are exposed through their product nouns. This module has
 * no lifecycle editors or compatibility surface for retired organization
 * concepts; catalog changes are made in their canonical source files.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { validateCapabilityRegistry, loadCapabilityRegistry } from './validate.mjs';
import { loadRegistry } from './loader.mjs';
import { validate as validateUnifiedRegistry } from './validator.mjs';
import { suggestClosestMatch } from '../cli-commands.mjs';
import {
  formatNotFoundError,
  formatWorkerProfileListLine,
  grepFilter,
  listColumnWidth,
  recordId,
  truncate,
  workerProfileListLabel,
  workerProfileTagline,
} from './catalog-format.mjs';
import { validateCustomWorkerProfile } from './custom-schema.mjs';
import { createCustomWorkerProfile } from './custom-scaffold.mjs';
import { mergeWorkerProfiles } from './custom-loader.mjs';
import { resolveUiColors } from '../ui/theme.mjs';

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

function flagValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : undefined;
}

function positionalArgs(args) {
  return args.filter((arg) => !arg.startsWith('--'));
}

function listFlagValue(args, name) {
  const raw = flagValue(args, name);
  if (!raw) return undefined;
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function loadCatalogRecords(noun, { rootDir, cwd = process.cwd() }) {
  const { field } = catalogFor(noun);
  if (noun === 'worker-profile') {
    return mergeWorkerProfiles({ rootDir, cwd }).records;
  }
  return Object.values(loadRegistry({ rootDir })[field]).sort((a, b) => recordId(a).localeCompare(recordId(b)));
}

export async function runCatalogList(noun, args = [], { rootDir, cwd = process.cwd(), println = console.log } = {}) {
  const { label } = catalogFor(noun);
  const jsonOutput = args.includes('--json');
  const grep = flagValue(args, '--grep');
  let records = loadCatalogRecords(noun, { rootDir, cwd });
  records = grepFilter(records, grep);

  if (jsonOutput) {
    println(JSON.stringify(records, null, 2));
    return 0;
  }

  if (noun === 'worker-profile') {
    const { resolveActiveWorkspacePreset } = await import('../workspace-presets/loader.mjs');
    const active = resolveActiveWorkspacePreset(cwd);
    if (active?.id) println(`Active preset: ${active.id}\n`);
  }

  if (!records.length) {
    println(grep ? `No ${label.toLowerCase()} records match "${grep}".` : `No ${label.toLowerCase()} records found.`);
    return 0;
  }

  if (noun === 'worker-profile') {
    const idWidth = listColumnWidth(records);
    const labelWidth = Math.max(...records.map((record) => workerProfileListLabel(record).length), 8);
    for (const record of records) {
      println(formatWorkerProfileListLine(record, { idWidth, labelWidth, showSource: true }));
    }
  } else {
    const width = listColumnWidth(records);
    for (const record of records) {
      const summary = truncate(record.displayName || record.name || record.description || '', 56);
      println(`${recordId(record).padEnd(width)} ${summary}`.trimEnd());
    }
  }
  if (noun === 'worker-profile') {
    println('\nRun `construct worker-profile show <id>` to inspect one; add `--grep=<term>` to filter.');
  }
  return 0;
}

export async function runCatalogShow(noun, args = [], { rootDir, cwd = process.cwd(), println = console.log, errorln = console.error } = {}) {
  const { field, label } = catalogFor(noun);
  const jsonOutput = args.includes('--json');
  const id = positionalArgs(args)[0];
  if (!id) {
    errorln(`Usage: construct ${noun} show <id>`);
    if (noun === 'worker-profile') {
      errorln('Example: construct worker-profile show engineer');
    }
    return 1;
  }

  let record;
  let availableIds;
  if (noun === 'worker-profile') {
    const merged = mergeWorkerProfiles({ rootDir, cwd });
    record = merged.byId[id];
    availableIds = Object.keys(merged.byId).sort();
  } else {
    const records = loadRegistry({ rootDir })[field];
    record = records[id];
    availableIds = Object.keys(records).sort();
  }

  if (!record) {
    formatNotFoundError(label, id, availableIds, { errorln });
    return 1;
  }

  if (jsonOutput || noun !== 'worker-profile') {
    println(JSON.stringify(record, null, 2));
    return 0;
  }

  println(`${recordId(record)} — ${workerProfileListLabel(record)}`);
  const tagline = workerProfileTagline(record);
  if (tagline) println(tagline);
  const whenToUse = truncate(record.whenToUse || record.when_to_use || record.description || '', 96);
  if (whenToUse && whenToUse !== tagline) println(whenToUse);
  const skillCount = Array.isArray(record.skillEmphasis) ? record.skillEmphasis.length
    : Array.isArray(record.skills) ? record.skills.length
      : 0;
  if (skillCount) println(`Skill emphasis: ${skillCount} bundles`);
  if (record.source && record.source !== 'registry') {
    const pathHint = record.customRelPath || record.customPath || record.source;
    println(`Source: ${record.source} (${pathHint})`);
  }
  println('\nAdd --json for the full record.');
  return 0;
}

export async function runWorkerProfileValidate(args = [], { rootDir, cwd = process.cwd(), println = console.log, errorln = console.error } = {}) {
  const fileArg = flagValue(args, '--file');
  let raw = '';
  if (fileArg) {
    raw = readFileSync(path.resolve(cwd, fileArg), 'utf8');
  } else if (!process.stdin.isTTY) {
    try {
      raw = readFileSync(0, 'utf8');
    } catch (err) {
      if (err.code !== 'EAGAIN' && err.code !== 'EWOULDBLOCK') throw err;
    }
  }
  if (!String(raw || '').trim()) {
    errorln('Usage: construct worker-profile validate [--file=<path>]');
    errorln('Validates a custom Worker Profile JSON record (stdin or --file).');
    errorln('Example: construct worker-profile validate --file=.construct/org/worker-profiles/widget-worker.json');
    return 1;
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    errorln(`Invalid JSON: ${err.message}`);
    return 1;
  }

  const projectRoot = cwd || rootDir || process.cwd();
  const errors = validateCustomWorkerProfile(record, { rootDir: projectRoot, checkPromptFileExists: true });
  if (errors.length) {
    errorln(`Worker Profile validation failed (${record?.name || record?.id || 'unnamed'}):`);
    for (const message of errors) errorln(`  ${message}`);
    return 1;
  }

  println(`Worker Profile "${record.name || record.id}" is valid.`);
  return 0;
}

export function formatWorkerProfileCreateHelp({ colors = false } = {}) {
  const c = resolveUiColors({ enabled: colors });
  return [
    `${c.bold}construct worker-profile create${c.reset} — scaffold a custom Worker Profile`,
    '',
    `${c.dim}Usage:${c.reset} construct worker-profile create <id> --description=<text> --skills=<bundle/skill,...> [flags]`,
    '',
    `${c.bold}Flags${c.reset}`,
    '  --description=<text>          Required — routing description (≥20 characters)',
    '  --skills=<refs>               Required — comma-separated skill bundles (e.g. development/typescript)',
    '  --role=<id>                   Routing role id (default: <id>)',
    '  --team=<id>                   Optional legacy team id (ignored when absent)',
    '  --scope=project|user          Write tier (default: project)',
    '  --allowed-paths=<globs>       Fence allowedPaths globs (default: .)',
    '  --model-tier=<tier>           fast | standard | reasoning (default: standard)',
    '  --reasoning-effort=<level>    Optional reasoning effort hint',
    '  --display-name=<text>         Human-readable display name',
    '  --claude-tools=<list>         Comma-separated tool allowlist',
    '  --handoff-candidates=<ids>    Comma-separated handoff target ids',
    '  --force                       Overwrite existing scaffold files',
    '  --json                        Emit machine-readable result',
    '',
    `${c.bold}Output paths${c.reset}`,
    '  project scope (default):',
    '    .construct/org/worker-profiles/<id>.json',
    '    .construct/org/prompts/<id>.md',
    '  user scope (--scope=user):',
    '    ~/.construct/org/worker-profiles/<id>.json',
    '    ~/.construct/org/prompts/<id>.md',
    '',
    `${c.bold}Examples${c.reset}`,
    '  construct worker-profile create widget-worker \\',
    '    --description="Owns widget feature implementation and reviews" \\',
    '    --skills=development/typescript --allowed-paths=src/**',
    '',
    '  construct worker-profile validate --file=.construct/org/worker-profiles/widget-worker.json',
    '',
  ].join('\n');
}

export async function runWorkerProfileCreate(args = [], { rootDir, cwd = process.cwd(), println = console.log, errorln = console.error } = {}) {
  if (args.includes('--help') || args.includes('-h')) {
    println(formatWorkerProfileCreateHelp());
    return 0;
  }

  const jsonOutput = args.includes('--json');
  const force = args.includes('--force');
  const id = positionalArgs(args)[0];
  if (!id) {
    errorln('Usage: construct worker-profile create <id> --description=<text> --skills=<bundle/skill,...>');
    errorln('Scaffolds a custom Worker Profile JSON record and prompt stub under .construct/org/.');
    errorln('Run `construct worker-profile create --help` for flags and output paths.');
    return 1;
  }

  const description = flagValue(args, '--description');
  const skills = listFlagValue(args, '--skills');
  const allowedPaths = listFlagValue(args, '--allowed-paths') || ['.'];
  const team = flagValue(args, '--team') || flagValue(args, '--team-id');
  const role = flagValue(args, '--role') || id;
  const scope = flagValue(args, '--scope') || 'project';
  const modelTier = flagValue(args, '--model-tier') || 'standard';
  const reasoningEffort = flagValue(args, '--reasoning-effort');
  const displayName = flagValue(args, '--display-name');
  const claudeTools = flagValue(args, '--claude-tools');
  const handoffCandidates = listFlagValue(args, '--handoff-candidates') || [];

  if (!description || String(description).trim().length < 20) {
    errorln('Missing or invalid --description — provide at least 20 characters for orchestration routing.');
    return 1;
  }
  if (!skills?.length) {
    errorln('Missing --skills — provide at least one skill bundle reference (e.g. --skills=development/typescript).');
    return 1;
  }

  let result;
  try {
    result = createCustomWorkerProfile({
      rootDir: cwd,
      scope,
      id,
      role,
      description,
      modelTier,
      reasoningEffort,
      skills,
      fence: { allowedPaths },
      ...(team ? { team } : {}),
      handoffCandidates,
      claudeTools,
      displayName,
      force,
    });
  } catch (err) {
    errorln(err.message);
    return 1;
  }

  const postValidate = validateCustomWorkerProfile(result.record, { rootDir: cwd, checkPromptFileExists: true });
  if (postValidate.length) {
    errorln(`Scaffolded Worker Profile "${id}" failed post-create validation:`);
    for (const message of postValidate) errorln(`  ${message}`);
    return 1;
  }

  if (jsonOutput) {
    println(JSON.stringify({
      ok: true,
      id,
      scope: result.scope,
      path: result.path,
      relPath: result.relPath,
      promptPath: result.promptPath,
      record: result.record,
    }, null, 2));
    return 0;
  }

  const scopeLabel = scope === 'user' ? '~/.construct/org' : '.construct/org';
  println(`Created custom Worker Profile "${id}" (${scope} scope).`);
  println(`  Record: ${result.relPath}`);
  println(`  Prompt: ${path.relative(cwd, result.promptPath)}`);
  println(`  Tier:   ${scopeLabel}`);
  println(`Run \`construct worker-profile validate --file=${result.relPath}\` to re-check, or \`construct sync\` to refresh platform files.`);
  return 0;
}

export async function runCatalogCommand(noun, args = [], io = {}) {
  const subcommand = args[0] || 'list';
  const errorln = io.errorln || console.error;
  const println = io.println || console.log;
  const catalogIo = { cwd: process.cwd(), ...io };
  if (subcommand === 'list') return runCatalogList(noun, args.slice(1), catalogIo);
  if (subcommand === 'show') return runCatalogShow(noun, args.slice(1), catalogIo);
  if (noun === 'capability' && subcommand === 'describe') {
    const { describeCapabilities } = await import('../embedded-contract/index.mjs');
    const envelope = describeCapabilities({ env: process.env, cwd: catalogIo.cwd, rootDir: io.rootDir });
    if (args.includes('--json')) {
      println(JSON.stringify(envelope, null, 2));
    } else {
      println(JSON.stringify(envelope.data ?? envelope, null, 2));
    }
    return 0;
  }
  if (noun === 'worker-profile' && subcommand === 'validate') {
    return runWorkerProfileValidate(args.slice(1), catalogIo);
  }
  if (noun === 'worker-profile' && subcommand === 'create') {
    return runWorkerProfileCreate(args.slice(1), catalogIo);
  }
  const available = noun === 'worker-profile'
    ? ['list', 'show', 'validate', 'create']
    : (noun === 'capability' ? ['list', 'show', 'describe'] : ['list', 'show']);
  const suggestion = suggestClosestMatch(subcommand, available);
  errorln(`Unknown ${noun} subcommand: ${subcommand}. Available: ${available.join(', ')}`);
  if (suggestion) errorln(`Did you mean: ${suggestion}?`);
  return 1;
}

export function registryCatalogNames() {
  return Object.keys(CATALOGS);
}
