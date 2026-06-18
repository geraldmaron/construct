/**
 * 01-smoke.mjs — Phase 1: every command runs, honors --help, and is reachable.
 *
 * Two independent probes per command:
 *   1. `construct <cmd> --help` in an isolated HOME — exit 0 + header present + fast.
 *      Safe for all commands because bin/construct intercepts --help before dispatch.
 *   2. Lazy-import reachability — for handlers that defer `await import(...)` to call
 *      time, --help never triggers the import, so the module is resolved statically.
 *      A missing target is dead-on-invoke even though --help passes.
 *
 * Classifies each command and records findings. Read-only. Run: node scripts/audit/01-smoke.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS } from '../../lib/cli-commands.mjs';
import { REPO_ROOT, readHandlerNames, readLazyImportSpecifiers } from './lib/handlers.mjs';
import { isolatedEnv, runConstruct, cleanup } from './lib/spawn.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const HELP_BUDGET_MS = 5000;

// Dispatcher-wide lazy-import reachability: every static `await import('<lib>')` in
// bin/construct must resolve, regardless of which command's code path holds it.

export function checkLazyImports() {
  const specs = readLazyImportSpecifiers();
  const broken = specs.filter((s) => s.exists === false).map((s) => s.specifier);
  const dynamic = specs.filter((s) => s.dynamic).map((s) => s.specifier);
  const verified = specs.filter((s) => s.exists === true).length;
  return { total: specs.length, verified, broken, dynamic };
}

export function runSmoke() {
  const handlers = readHandlerNames();
  const { fakeHome, env } = isolatedEnv();
  const results = [];

  try {
    for (const spec of CLI_COMMANDS) {
      const r = runConstruct([spec.name, '--help'], { env, timeout: HELP_BUDGET_MS + 1500 });
      const headerOk = r.stdout.includes(`construct ${spec.name}`);
      const helpOk = r.status === 0 && headerOk && !r.timedOut;

      let classification;
      if (!handlers.has(spec.name)) classification = 'dead-registered';
      else if (helpOk) classification = 'wired';
      else classification = 'help-failed';

      results.push({
        name: spec.name,
        internal: spec.internal === true,
        helpExit: r.status,
        headerOk,
        elapsedMs: r.elapsedMs,
        slow: r.elapsedMs >= HELP_BUDGET_MS,
        classification,
      });
    }
  } finally {
    cleanup(fakeHome);
  }

  return results;
}

export function smokeFindings() {
  return [...toFindings(runSmoke()), ...lazyImportFindings(checkLazyImports())];
}

function toFindings(results) {
  const rows = [];
  for (const r of results) {
    if (r.classification === 'dead-registered') {
      rows.push({ type: 'dead-command', target: r.name, severity: 'high', tier: 'judgment',
        evidence: 'in CLI_COMMANDS but no handler in bin/construct',
        recommendation: 'Add a handler or remove the catalog entry.' });
    }
    if (r.classification === 'help-failed') {
      rows.push({ type: 'help-failed', target: r.name, severity: 'high', tier: 'judgment',
        evidence: `--help exit=${r.helpExit} headerOk=${r.headerOk}`,
        recommendation: 'Ensure --help exits 0 and prints the command header before dispatch.' });
    }
    if (r.slow && r.classification === 'wired') {
      rows.push({ type: 'help-slow', target: r.name, severity: 'low', tier: 'judgment',
        evidence: `--help took ${r.elapsedMs}ms (budget ${HELP_BUDGET_MS}ms)`,
        recommendation: 'Defer heavy work; --help must be near-instant.' });
    }
  }
  return rows;
}

function lazyImportFindings(lazy) {
  return lazy.broken.map((specifier) => ({
    type: 'lazy-import-broken', target: specifier, severity: 'high', tier: 'mechanical',
    evidence: `await import('${specifier}') in bin/construct resolves to no file`,
    recommendation: 'Fix the specifier or restore the module; the owning command is dead-on-invoke.',
  }));
}

function main() {
  const results = runSmoke();
  const lazy = checkLazyImports();
  const findings = [...toFindings(results), ...lazyImportFindings(lazy)];
  recordFindings('01-smoke', findings);
  writeJson('smoke-results.json', { budget_ms: HELP_BUDGET_MS, lazyImports: lazy, results });

  const by = (c) => results.filter((r) => r.classification === c).length;
  process.stdout.write(`[audit:01] ${results.length} commands smoke-tested: ` +
    `${by('wired')} wired, ${by('dead-registered')} dead-registered, ${by('help-failed')} help-failed.\n`);
  process.stdout.write(`[audit:01] lazy imports: ${lazy.verified}/${lazy.total} resolve, ` +
    `${lazy.broken.length} broken, ${lazy.dynamic.length} dynamic (unverifiable statically).\n`);
  process.stdout.write(`[audit:01] ${findings.length} finding(s) recorded ` +
    `→ ${path.relative(REPO_ROOT, path.join(REPO_ROOT, 'audit-artifacts', 'findings.json'))}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
