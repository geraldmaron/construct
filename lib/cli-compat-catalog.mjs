/**
 * lib/cli-compat-catalog.mjs — documented-vs-actual CLI surface and compat inventory.
 *
 * Joins the runtime dispatch table (bin/construct handlers), the public catalog
 * (lib/cli-commands.mjs), and explicit sunset records for removed or retired
 * commands and flags. buildCliCommandCatalog() is the machine-readable catalog;
 * renderCliCommandCatalogMarkdown() emits the human reference page.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CLI_COMMANDS,
  RETIRED_COMMAND_HINTS,
  CLI_COMMANDS_BY_CATEGORY,
  CATEGORY_ORDER,
} from './cli-commands.mjs';

/** Patterns that must not appear in default or per-command help text. */
export const HELP_HIDDEN_PATTERNS = Object.freeze([
  { id: 'matrix-command', pattern: /\bconstruct matrix\b/i, note: 'ADR-0053 alias removed; use `construct graph`' },
  { id: 'install-scope-flag', pattern: /construct install[^\n]*--scope(?:=|\b)/, note: 'ADR-0071 install flag retired; use `--footprint`' },
  { id: 'models-reset-flag', pattern: /models\s+--reset\b/, note: 'Use `construct models reset`' },
  { id: 'models-set-flag', pattern: /models\s+--set=/, note: 'Use `construct models set --tier=… --model=…`' },
  { id: 'models-poll-flag', pattern: /models\s+--poll\b/, note: 'Use `construct models free`' },
]);

/** Explicit sunset decisions required by construct-tsyfe.9.5 AC #4. */
export const CLI_SUNSET_DECISIONS = Object.freeze({
  matrix: {
    surface: 'construct matrix <subcommand>',
    status: 'removed',
    decision: 'Removed after ADR-0053 two-release-cycle deprecation window (alias shipped v1.5.0; removed construct-b0nny.28 / workspace-control-plane E9).',
    replacement: 'construct graph <subcommand>',
    adr: 'ADR-0053',
  },
  'install --scope': {
    surface: 'construct install --scope=<project|user|both>',
    status: 'removed',
    decision: 'Retired in Construct 2.0 cleanup; canonical install-write-target flag is --footprint per ADR-0071.',
    replacement: 'construct install --footprint=<project|user|both>',
    adr: 'ADR-0071',
  },
  'models --reset': {
    surface: 'construct models --reset',
    status: 'removed',
    decision: 'Retired top-level flag form; canonical subcommand is construct models reset.',
    replacement: 'construct models reset',
    adr: 'none',
  },
  'models --set': {
    surface: 'construct models --tier=<t> --set=<model>',
    status: 'removed',
    decision: 'Retired top-level flag form; canonical subcommand is construct models set --tier=<t> --model=<id>.',
    replacement: 'construct models set --tier=<reasoning|standard|fast> --model=<provider/model-id>',
    adr: 'none',
  },
  'models --poll': {
    surface: 'construct models --poll',
    status: 'removed',
    decision: 'Retired top-level flag form; canonical subcommand is construct models free.',
    replacement: 'construct models free',
    adr: 'none',
  },
});

/** Handler keys present in bin/construct but intentionally absent from CLI_COMMANDS. */
export const HANDLER_ONLY_ALLOWLIST = Object.freeze({
  help: { status: 'internal', note: 'Built-in help dispatcher' },
  up: { status: 'legacy-alias', note: 'Legacy alias of construct dev (handler-only, not cataloged)' },
  down: { status: 'legacy-alias', note: 'Legacy alias of construct stop (handler-only, not cataloged)' },
  doc: { status: 'internal', note: 'Single-arg utility dispatcher' },
  'policy:list': { status: 'internal', note: 'Operational policy-engine inspector' },
  'roles:list': { status: 'internal', note: 'Role framework admin' },
  'roles:set': { status: 'internal', note: 'Role framework admin' },
  'feedback:record': { status: 'internal', note: 'Intake feedback admin' },
  'feedback:history': { status: 'internal', note: 'Intake feedback admin' },
  'telemetry-backfill': { status: 'internal', note: 'Operational telemetry setup' },
  'eval-datasets': { status: 'internal', note: 'Dev-only eval dataset listing' },
  ask: { status: 'legacy-alias', note: 'RAG ask path; catalog entry is knowledge' },
  pricing: { status: 'internal', note: 'Cost subcommand sub-tool' },
  costs: { status: 'internal', note: 'Observability sub-namespace' },
  handoffs: { status: 'internal', note: 'Role framework namespace' },
  'docs:check': { status: 'internal', note: 'Operational doc gate alias' },
  'lint:agents': { status: 'internal', note: 'Internal lint gate' },
  'lint:contracts': { status: 'internal', note: 'Internal lint gate' },
});

export function readHandlerNames(rootDir) {
  const source = fs.readFileSync(path.join(rootDir, 'bin', 'construct'), 'utf8');
  const start = source.indexOf('const handlers = new Map([');
  if (start < 0) throw new Error('handlers map opener not found in bin/construct');
  const after = source.slice(start);
  const closerMatch = after.match(/\n\]\);/);
  if (!closerMatch) throw new Error('handlers map closer not found in bin/construct');
  const body = after.slice(0, closerMatch.index);
  const names = new Set();
  for (const match of body.matchAll(/\n {2,3}\[\s*'([^']+)'\s*,/g)) names.add(match[1]);
  return names;
}

function catalogIndex() {
  return new Map(CLI_COMMANDS.map((spec) => [spec.name, spec]));
}

function classifyCommand(name, { handlers, catalog }) {
  if (handlers.has(name)) {
    const spec = catalog.get(name);
    if (spec) {
      if (spec.internal) return { status: 'internal', replacement: null, note: spec.description };
      return { status: 'current', replacement: null, note: spec.description };
    }
    const allow = HANDLER_ONLY_ALLOWLIST[name];
    if (allow) return { status: allow.status, replacement: null, note: allow.note };
    return { status: 'undocumented-handler', replacement: null, note: 'Handler exists with no catalog or allowlist entry' };
  }
  const retired = RETIRED_COMMAND_HINTS[name];
  if (retired) {
    return {
      status: 'removed',
      replacement: retired.replacement ? `construct ${retired.replacement}` : null,
      note: retired.note,
    };
  }
  return { status: 'unknown', replacement: null, note: 'Not present in dispatch table' };
}

/**
 * Machine-readable catalog reconciling dispatch, CLI_COMMANDS, and sunset records.
 */
export function buildCliCommandCatalog({ rootDir = process.cwd() } = {}) {
  const handlers = readHandlerNames(rootDir);
  const catalog = catalogIndex();
  const names = new Set([...handlers, ...catalog.keys(), ...Object.keys(RETIRED_COMMAND_HINTS)]);

  const commands = [...names].sort().map((name) => {
    const spec = catalog.get(name);
    const classification = classifyCommand(name, { handlers, catalog });
    return {
      name,
      status: classification.status,
      replacement: classification.replacement,
      note: classification.note,
      category: spec?.category ?? null,
      core: spec?.core ?? false,
      documentedInReference: Boolean(spec && !spec.internal),
      usage: spec?.usage ?? null,
    };
  });

  return {
    generatedFrom: ['bin/construct handlers map', 'lib/cli-commands.mjs', 'lib/cli-compat-catalog.mjs'],
    handlerCount: handlers.size,
    catalogCount: CLI_COMMANDS.length,
    sunsetDecisions: CLI_SUNSET_DECISIONS,
    helpHiddenPatterns: HELP_HIDDEN_PATTERNS.map(({ id, note }) => ({ id, note })),
    commands,
  };
}

function collectSpecHelpStrings(spec) {
  const parts = [spec.description, spec.usage, spec.next];
  for (const sub of spec.subcommands ?? []) {
    parts.push(typeof sub === 'string' ? sub : `${sub.name} ${sub.desc ?? sub.description ?? ''}`);
  }
  for (const opt of spec.options ?? []) parts.push(`${opt.flag} ${opt.desc}`);
  for (const ex of spec.examples ?? []) parts.push(`${ex.cmd} ${ex.desc ?? ''}`);
  return parts.filter(Boolean).join('\n');
}

/** Strings that constitute user-visible help for the default and catalog surfaces. */
export function collectPublicHelpCorpus({ rootDir = process.cwd() } = {}) {
  const chunks = [];
  for (const category of CATEGORY_ORDER) {
    const commands = (CLI_COMMANDS_BY_CATEGORY[category] ?? []).filter((c) => c.core);
    for (const spec of commands) chunks.push(collectSpecHelpStrings(spec));
  }
  for (const spec of CLI_COMMANDS) {
    if (spec.internal) continue;
    chunks.push(collectSpecHelpStrings(spec));
  }

  const setupSource = fs.readFileSync(path.join(rootDir, 'lib', 'setup.mjs'), 'utf8');
  const setupHelp = setupSource.match(/function printHelp\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  chunks.push(setupHelp);

  const binSource = fs.readFileSync(path.join(rootDir, 'bin', 'construct'), 'utf8');
  const modelsBlock = binSource.match(/async function cmdModels\([\s\S]*?errorln\('Usage: construct models/)?.[0] ?? '';
  chunks.push(modelsBlock);

  return chunks.join('\n');
}

export function findHelpHiddenViolations(helpText) {
  return HELP_HIDDEN_PATTERNS
    .filter(({ pattern }) => pattern.test(helpText))
    .map(({ id, note }) => ({ id, note }));
}

export function renderCliCommandCatalogMarkdown(catalog) {
  const lines = [
    '---',
    'title: CLI command catalog',
    'description: Documented-vs-actual construct CLI surface with current, internal, and removed compat entries.',
    '---',
    '',
    '> Generated from `lib/cli-compat-catalog.mjs`. Re-run `node --test tests/cli-deprecated-surface.test.mjs` to refresh.',
    '',
    'This page reconciles three sources:',
    '',
    '1. The runtime dispatch table in `bin/construct`',
    '2. The public catalog in `lib/cli-commands.mjs` (what `--help` and generated reference pages advertise)',
    '3. Explicit sunset records for retired compatibility surfaces',
    '',
    '## Sunset decisions',
    '',
    '| Surface | Status | Replacement | Record |',
    '| --- | --- | --- | --- |',
  ];

  for (const entry of Object.values(catalog.sunsetDecisions)) {
    const record = entry.adr === 'none' ? entry.decision : `${entry.adr}: ${entry.decision}`;
    lines.push(`| \`${entry.surface}\` | ${entry.status} | \`${entry.replacement}\` | ${record.replace(/\|/g, '\\|')} |`);
  }

  lines.push('', '## Command inventory', '', '| Command | Status | Category | Core help | Notes |', '| --- | --- | --- | --- | --- |');
  for (const row of catalog.commands) {
    lines.push(`| \`${row.name}\` | ${row.status} | ${row.category ?? 'n/a'} | ${row.core ? 'yes' : 'no'} | ${String(row.note).replace(/\|/g, '\\|')} |`);
  }

  lines.push('', '## Help-hidden compat surfaces', '', 'The following must not appear in default or per-command help text:', '');
  for (const entry of catalog.helpHiddenPatterns) {
    lines.push(`- \`${entry.id}\`: ${entry.note}`);
  }

  lines.push('');
  return lines.join('\n');
}
