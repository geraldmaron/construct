/**
 * lib/planning/cli.mjs — `construct work-spec` command surface
 * mirroring lib/workspace/cli.mjs's and
 * lib/graph/cli.mjs's dispatch shape: numeric exit codes,
 * process.stdout/stderr.write rather than console.*, --json opt-in.
 *
 * Subcommands:
 *   build --from=<path|-> [--json] [--strict]     buildWorkSpec against the
 *                                                  real Workspace/Sources/
 *                                                  Directives inputs.
 *   check --from=<path|-> [--json] [--strict]     checkDecomposition only,
 *                                                  against a caller-supplied
 *                                                  spec — no workspace I/O.
 *   validate --from=<path|-> [--json]             validateWorkSpec schema
 *                                                  check only.
 *
 * `--strict` exits 1 when the graph-checked report is not ok (cycles found,
 * an unresolved declared dependency, or a falsified independence claim),
 * mirroring `construct graph validate --strict`'s convention.
 */

import fs from 'node:fs';

import { validateWorkSpec } from './work-spec.mjs';
import { checkDecomposition } from './decomposition-check.mjs';
import { buildWorkSpec } from './build-work-spec.mjs';

function readFrom(args) {
  const flag = args.find((a) => a.startsWith('--from='));
  if (!flag) return { error: 'Usage: --from=<path-to-work-spec.json>|-' };
  const source = flag.slice('--from='.length);
  const raw = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(source, 'utf8');
  try {
    return { spec: JSON.parse(raw) };
  } catch (err) {
    return { error: `--from: invalid JSON (${err.message})` };
  }
}

function printSpec(spec, { json }) {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, workSpec: spec }, null, 2) + '\n');
    return;
  }
  process.stdout.write(`work spec: ${spec.title || spec.objective || '(untitled)'}\n`);
  process.stdout.write(`  workspace:   ${spec.workspace ?? '(none)'}\n`);
  process.stdout.write(`  state:       ${spec.state}\n`);
  process.stdout.write(`  assignments: ${spec.decomposition.length}\n`);
  printReport(spec.graphValidation, { json: false, indent: '  ' });
}

function printReport(report, { json, indent = '' }) {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, graphValidation: report }, null, 2) + '\n');
    return;
  }
  if (!report) {
    process.stdout.write(`${indent}graph validation: (not run)\n`);
    return;
  }
  process.stdout.write(`${indent}graph validation: ${report.ok ? 'ok' : 'FAILED'}\n`);
  process.stdout.write(`${indent}  cycles:               ${report.cycles.ok ? 'none' : `${report.cycles.cycles.length} found`}\n`);
  const unresolved = report.dependencyResolution.edges.filter((e) => !e.resolved);
  process.stdout.write(`${indent}  dependency resolution: ${unresolved.length === 0 ? 'all resolved' : `${unresolved.length} unresolved`}\n`);
  const brokenPairs = report.independence.pairs.filter((p) => !p.independent);
  process.stdout.write(`${indent}  independence claims:  ${brokenPairs.length === 0 ? 'all independent' : `${brokenPairs.length} violated`}\n`);
}

function runBuild(args, { projectDir, json, strict }) {
  const { spec: input, error } = readFrom(args);
  if (error) {
    process.stderr.write(`${error}\n`);
    return 1;
  }
  const spec = buildWorkSpec(projectDir, input);
  printSpec(spec, { json });
  return strict && !spec.graphValidation.ok ? 1 : 0;
}

function runCheck(args, { projectDir, json, strict }) {
  const { spec, error } = readFrom(args);
  if (error) {
    process.stderr.write(`${error}\n`);
    return 1;
  }
  const report = checkDecomposition(projectDir, spec);
  printReport(report, { json });
  return strict && !report.ok ? 1 : 0;
}

function runValidate(args, { json }) {
  const { spec, error } = readFrom(args);
  if (error) {
    process.stderr.write(`${error}\n`);
    return 1;
  }
  const errors = validateWorkSpec(spec);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors }, null, 2) + '\n');
    return errors.length === 0 ? 0 : 1;
  }
  if (errors.length === 0) {
    process.stdout.write('✓ work spec is schema-valid\n');
    return 0;
  }
  process.stdout.write(`✗ ${errors.length} schema error(s):\n`);
  for (const e of errors) process.stdout.write(`  ${e}\n`);
  return 1;
}

/**
 * @param {string[]} args
 * @param {{ projectDir: string }} ctx
 * @returns {number} exit code
 */
export function runWorkSpecCli(args, { projectDir }) {
  const sub = args[0] || 'build';
  const json = args.includes('--json');
  const strict = args.includes('--strict');

  if (sub === 'build') return runBuild(args, { projectDir, json, strict });
  if (sub === 'check') return runCheck(args, { projectDir, json, strict });
  if (sub === 'validate') return runValidate(args, { json });
  process.stderr.write(`Unknown work-spec subcommand: ${sub}. Available: build, check, validate\n`);
  return 1;
}
