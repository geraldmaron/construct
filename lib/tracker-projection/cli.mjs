/**
 * lib/tracker-projection/cli.mjs — `construct tracker-projection` command
 * surface (construct-b0nny.27 / E8), mirroring lib/planning/cli.mjs's dispatch
 * shape: numeric exit codes, process.stdout/stderr.write, --json opt-in.
 *
 * Sits behind bd (bd stays the tracker CLI surface). No subcommand issues a bd
 * write; each reads live bd and diffs against the durable projection store.
 *
 * Subcommands:
 *   import [--json]              Snapshot live bd, build raw-record-preserving
 *                               projections, persist them, and report the
 *                               zero-data-loss verification.
 *   reconcile [--json] [--strict]  Diff the persisted projections against live
 *                               bd and report drift (domain-owned conflicts vs
 *                               absorbed tracker updates). --strict exits 1 on
 *                               drift.
 *   status [--json]             Print the persisted projection summary.
 */

import { deriveProjectKey } from '../state-root.mjs';
import { snapshotBeads, importBeads, verifyRawRecords } from './import-beads.mjs';
import { reconcileAll } from './reconcile.mjs';
import { upsertProjections, loadProjections, loadProjectionsMeta } from './store.mjs';

function runImport(_args, { projectDir, json }) {
  const issues = snapshotBeads({ cwd: projectDir });
  const workspace = deriveProjectKey(projectDir);
  const { projections, stats } = importBeads(issues, { workspace });
  const verification = verifyRawRecords(projections, issues);
  const { count, dir } = upsertProjections(projectDir, projections);

  if (json) {
    process.stdout.write(JSON.stringify({ ok: verification.ok, imported: stats.imported, persisted: count, rawRecordPreservation: verification, dir }, null, 2) + '\n');
    return verification.ok ? 0 : 1;
  }
  process.stdout.write(`imported ${stats.imported} bead(s) → ${count} projection(s) in ${dir}\n`);
  process.stdout.write(`  raw-record preservation: ${verification.ok ? 'ok (zero data loss)' : `FAILED (${verification.mismatches.length} mismatch)`}\n`);
  if (stats.skipped.length) process.stdout.write(`  skipped (no id): ${stats.skipped.length}\n`);
  return verification.ok ? 0 : 1;
}

function runReconcile(_args, { projectDir, json, strict }) {
  const projections = loadProjections(projectDir);
  const issues = snapshotBeads({ cwd: projectDir });
  const report = reconcileAll(projections, issues);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return strict && !report.ok ? 1 : 0;
  }
  process.stdout.write(`reconcile: ${report.ok ? 'in sync' : 'DRIFT'} (${report.counts.total} projection(s))\n`);
  process.stdout.write(`  in sync:  ${report.counts.inSync}\n`);
  process.stdout.write(`  absorbed: ${report.counts.absorbed} (tracker-owned bd updates)\n`);
  process.stdout.write(`  drifted:  ${report.counts.drifted} (domain-owned conflicts)\n`);
  process.stdout.write(`  missing:  ${report.counts.missing} (bead absent from tracker)\n`);
  for (const d of report.drifted) {
    process.stdout.write(`    ${d.external_id}: ${d.conflicts.map((c) => c.field).join(', ')}\n`);
  }
  return strict && !report.ok ? 1 : 0;
}

function runStatus(_args, { projectDir, json }) {
  const projections = loadProjections(projectDir);
  const meta = loadProjectionsMeta(projectDir);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, count: projections.length, meta }, null, 2) + '\n');
    return 0;
  }
  if (projections.length === 0) {
    process.stdout.write('no projections persisted — run `construct tracker-projection import`\n');
    return 0;
  }
  process.stdout.write(`${projections.length} projection(s) persisted\n`);
  if (meta?.byState) {
    for (const [state, n] of Object.entries(meta.byState)) process.stdout.write(`  ${state}: ${n}\n`);
  }
  return 0;
}

/**
 * @param {string[]} args
 * @param {{ projectDir: string }} ctx
 * @returns {number} exit code
 */
export function runTrackerProjectionCli(args, { projectDir }) {
  const sub = args[0] || 'status';
  const json = args.includes('--json');
  const strict = args.includes('--strict');

  if (sub === 'import') return runImport(args, { projectDir, json });
  if (sub === 'reconcile') return runReconcile(args, { projectDir, json, strict });
  if (sub === 'status') return runStatus(args, { projectDir, json });
  process.stderr.write(`Unknown tracker-projection subcommand: ${sub}. Available: import, reconcile, status\n`);
  return 1;
}
