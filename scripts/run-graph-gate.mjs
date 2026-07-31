/**
 * scripts/run-graph-gate.mjs — CI drift gate for the living workflow/capability
 * graph.
 *
 * The living graph is derived, not committed, so "drift" is not a file-diff: it
 * is a declaration that fails to match reality — a workflow with zero tests,
 * a capability whose doc is absent, a provider without a manifest, a surface
 * declared but never registered. The gate rebuilds the graph from source and
 * runs `graph validate` in STRICT mode (so a missing-test/missing-doc gap is a
 * hard error regardless of the repo's configured deployment mode — CI never
 * inherits solo-mode leniency) plus the `graph stale` per-source check. Any
 * validate error or stale source fails the gate.
 *
 * When `CHANGED_FILES` (newline/space-separated) or a `--changed <files...>`
 * argument is supplied, the gate additionally resolves the C4 impact set and
 * emits a GitHub `::notice::` annotation naming the impacted workflows/tests/
 * docs — advisory context on the PR, never a failure condition on its own.
 *
 * Importable (`runGraphGate`) so the self-test drives it in-process; runnable as
 * `node scripts/run-graph-gate.mjs [--changed <files...>] [--json]` for local
 * pre-flight and the CI step.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const BIN = resolve(REPO_ROOT, 'bin', 'construct');

/**
 * Run one `construct graph <...>` subcommand, returning stdout. Throws with the
 * combined output when the subcommand exits non-zero *and* `allowFailure` is
 * false — `validate` exits 1 on errors, which the gate wants to inspect rather
 * than crash on, so that call passes `allowFailure: true`.
 */
function runGraph(args, { cwd, allowFailure = false } = {}) {
  try {
    return execFileSync(process.execPath, [BIN, 'graph', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFailure) return err.stdout ?? '';
    const detail = [err.stdout, err.stderr].filter(Boolean).join('\n');
    throw new Error(`construct graph ${args.join(' ')} failed:\n${detail}`);
  }
}

/** Parse the last JSON object printed on stdout, tolerating leading log lines. */
function parseJsonTail(out) {
  const start = out.indexOf('{');
  if (start === -1) throw new Error(`no JSON in output:\n${out}`);
  return JSON.parse(out.slice(start));
}

/** Normalize a changed-files input (array, or whitespace-separated string). */
function normalizeChangedFiles(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(/\s+/);
  return list.map((f) => f.trim()).filter(Boolean);
}

/**
 * Rebuild the graph, validate it in strict mode, and check per-source
 * staleness. Returns a structured verdict; never calls process.exit so the
 * self-test can assert on it.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd] - project root to gate (defaults to the repo root)
 * @param {string[]|string} [opts.changedFiles] - changed paths for the impact annotation
 * @returns {{ ok: boolean, errors: string[], warnings: string[], stale: boolean, staleSources: string[], impacted: object|null }}
 */
export function runGraphGate({ cwd = REPO_ROOT, changedFiles = [] } = {}) {
  runGraph(['build'], { cwd });

  const validate = parseJsonTail(runGraph(['validate', '--strict', '--json'], { cwd, allowFailure: true }));
  const stale = parseJsonTail(runGraph(['stale', '--json'], { cwd }));

  const files = normalizeChangedFiles(changedFiles);
  let impacted = null;
  if (files.length > 0) {
    impacted = parseJsonTail(runGraph(['impacted', '--changed', ...files, '--json'], { cwd }));
  }

  const errors = validate.errors ?? [];
  const warnings = validate.warnings ?? [];
  const staleSources = stale.staleSources ?? [];
  const ok = errors.length === 0 && stale.stale !== true;

  return { ok, errors, warnings, stale: stale.stale === true, staleSources, impacted };
}

function emitAnnotation(impacted) {
  if (!impacted) return;
  const wf = impacted.impactedWorkflows ?? [];
  if (wf.length === 0) return;
  const summary = `${wf.length} workflow(s) impacted: ${wf.join(', ')}`;
  process.stdout.write(`::notice title=Graph impact::${summary}\n`);
}

function main(argv) {
  const json = argv.includes('--json');

  const changedFlag = argv.indexOf('--changed');
  const changedFiles = changedFlag === -1
    ? process.env.CHANGED_FILES ?? []
    : argv.slice(changedFlag + 1).filter((a) => !a.startsWith('--'));

  const verdict = runGraphGate({ changedFiles });

  if (json) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  } else {
    emitAnnotation(verdict.impacted);
    for (const err of verdict.errors) process.stderr.write(`  drift: ${err}\n`);
    for (const src of verdict.staleSources) process.stderr.write(`  stale source: ${src}\n`);
    if (verdict.ok) {
      process.stdout.write(`✓ graph gate passed (0 drift errors, ${verdict.warnings.length} warning(s))\n`);
    } else {
      process.stderr.write(`\n✖ graph gate failed: ${verdict.errors.length} drift error(s)${verdict.stale ? ', graph stale' : ''}\n`);
      process.stderr.write(`  Run \`construct graph build && construct graph validate --strict\` locally to reproduce.\n`);
    }
  }

  return verdict.ok ? 0 : 1;
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  process.exit(main(process.argv.slice(2)));
}
