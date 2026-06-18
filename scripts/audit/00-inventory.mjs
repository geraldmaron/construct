/**
 * 00-inventory.mjs — Phase 0: command census and the coverage-matrix spine.
 *
 * Joins the command registry (CLI_COMMANDS — the single source of truth) against the
 * actual dispatch table parsed from bin/construct, and against the two registry
 * consumers (completions, dashboard). Emits command-census.json plus a blank
 * command-coverage-matrix.md that later phases fill column by column.
 *
 * Read-only. Run: node scripts/audit/00-inventory.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS, ALL_COMMAND_NAMES } from '../../lib/cli-commands.mjs';
import { REPO_ROOT, readHandlerNames, readLazyImportCommands } from './lib/handlers.mjs';
import { writeJson, writeText, mdTable } from './lib/artifacts.mjs';

function consumerCoverage() {
  const completions = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'completions.mjs'), 'utf8');
  const completionsUsesRegistry = /from '\.\/cli-commands\.mjs'/.test(completions);
  return { completionsUsesRegistry };
}

export function buildCensus() {
  const handlers = readHandlerNames();
  const lazy = readLazyImportCommands();
  const { completionsUsesRegistry } = consumerCoverage();

  const rows = CLI_COMMANDS.map((spec) => ({
    name: spec.name,
    category: spec.category || 'Uncategorized',
    core: spec.core === true,
    internal: spec.internal === true,
    hasHandler: handlers.has(spec.name),
    lazyImport: lazy.has(spec.name),
    hasDescription: Boolean(spec.description),
    hasUsage: Boolean(spec.usage),
    optionCount: Array.isArray(spec.options) ? spec.options.length : 0,
    subcommandCount: Array.isArray(spec.subcommands) ? spec.subcommands.length : 0,
  }));

  const handlerOrphans = [...handlers].filter((n) => !ALL_COMMAND_NAMES.includes(n));
  const catalogOnly = ALL_COMMAND_NAMES.filter((n) => !handlers.has(n));

  return {
    generatedFrom: 'lib/cli-commands.mjs + bin/construct handlers Map',
    totals: {
      commands: rows.length,
      core: rows.filter((r) => r.core).length,
      internal: rows.filter((r) => r.internal).length,
      withSubcommands: rows.filter((r) => r.subcommandCount > 0).length,
      lazyImportHandlers: rows.filter((r) => r.lazyImport).length,
    },
    parity: { handlerOrphans, catalogOnly, clean: handlerOrphans.length === 0 && catalogOnly.length === 0 },
    consumers: { completionsUsesRegistry },
    commands: rows,
  };
}

// The matrix spine: one row per command, a column per later phase, all blank now.
// A column is filled to '✓' / '✗' / score by the phase that owns it.

function renderMatrix(census) {
  const headers = ['command', 'category', 'runs', 'wired', 'documented', 'flags_doc', 'audited', 'visual'];
  const rows = census.commands.map((c) => [c.name, c.category, '', '', '', '', '', '']);
  const header = '# Command Coverage Matrix\n\n' +
    `Generated from ${census.generatedFrom}. ${census.totals.commands} commands ` +
    `(${census.totals.core} core, ${census.totals.internal} internal). ` +
    'Columns are filled by Phases 1-6; a fully green row means runs · wired · documented · ' +
    'flags-documented · audited · visually-mature.\n\n';
  return header + mdTable(headers, rows) + '\n';
}

function main() {
  const census = buildCensus();
  const jsonPath = writeJson('command-census.json', census);
  const mdPath = writeText('command-coverage-matrix.md', renderMatrix(census));
  process.stdout.write(`[audit:00] ${census.totals.commands} commands censused ` +
    `(${census.totals.core} core, ${census.totals.internal} internal, ` +
    `${census.totals.lazyImportHandlers} lazy-import handlers).\n`);
  process.stdout.write(`[audit:00] parity ${census.parity.clean ? 'clean' : 'DRIFT'}: ` +
    `${census.parity.handlerOrphans.length} handler-orphans, ${census.parity.catalogOnly.length} catalog-only.\n`);
  process.stdout.write(`[audit:00] wrote ${path.relative(REPO_ROOT, jsonPath)} and ${path.relative(REPO_ROOT, mdPath)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
