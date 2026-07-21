/**
 * lib/doctor/format-report.mjs — sort, summarize, and render `construct doctor` output.
 *
 * Checks register in discovery order; this module reorders by severity (fail →
 * warn → pass), counts results, extracts backtick-quoted fix commands for a
 * footer, and prints reconciliation drift in a stable shape. Pre-setup HOME
 * advisories collapse via setup-readiness.mjs before sorting.
 */

import { prepareChecksForPreSetupReport } from './setup-readiness.mjs';

const CMD_RE = /`((?:construct|git|npm|bd)[^`]+)`/g;

/**
 * @param {{ pass: boolean, optional?: boolean }} check
 * @returns {'fail'|'warn'|'pass'}
 */
export function severityOf(check) {
  if (check.pass) return 'pass';
  if (check.optional) return 'warn';
  return 'fail';
}

/**
 * Stable sort: failures first, warnings second, always-show passes (e.g. active
 * Workspace Preset), then remaining passes — original order within each tier.
 */
export function sortChecksBySeverity(checks) {
  const rank = (check) => {
    const severity = severityOf(check);
    if (severity === 'fail') return 0;
    if (severity === 'warn') return 1;
    if (check.alwaysShow) return 2;
    return 3;
  };
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => {
      const ra = rank(a.check);
      const rb = rank(b.check);
      return ra !== rb ? ra - rb : a.index - b.index;
    })
    .map(({ check }) => check);
}

/**
 * @param {{ pass: boolean, optional?: boolean, label: string }} check
 */
export function symbolForCheck(check) {
  if (check.pass) return '✓';
  if (check.optional) return '⚠';
  return '✗';
}

/**
 * @param {Array<{ pass: boolean, optional?: boolean }>} checks
 */
export function summarizeChecks(checks) {
  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const check of checks) {
    if (check.pass) okCount += 1;
    else if (check.optional) warnCount += 1;
    else failCount += 1;
  }
  return { okCount, warnCount, failCount };
}

/**
 * Pull unique actionable commands from check labels and reconcile tasks.
 */
export function extractNextSteps(checks, reconcileDrift = []) {
  const steps = [];
  const seen = new Set();

  const push = (cmd) => {
    const normalized = cmd.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    steps.push(normalized);
  };

  for (const check of checks) {
    if (check.pass) continue;
    for (const match of check.label.matchAll(CMD_RE)) push(match[1]);
  }

  for (const task of reconcileDrift) {
    push(`construct sync --reconcile=${task.id}`);
  }

  return steps;
}

/**
 * @param {object} opts
 * @param {Array<{ pass: boolean, optional?: boolean, label: string }>} opts.checks
 * @param {Array<{ id: string, safety?: string, summary?: string }>} [opts.reconcileDrift]
 * @param {string|null} [opts.firstRunReadinessLine]
 * @param {boolean} [opts.showPasses]
 * @param {string} [opts.homeDir]
 * @param {(line: string) => void} [opts.println]
 */
export function renderDoctorReport({
  checks,
  reconcileDrift = [],
  firstRunReadinessLine = null,
  showPasses = true,
  homeDir = process.env.HOME,
  println = (line) => process.stdout.write(`${line}\n`),
}) {
  const { checks: reportChecks } = prepareChecksForPreSetupReport(checks, { homeDir });
  const ordered = sortChecksBySeverity(reportChecks);
  const visible = showPasses
    ? ordered
    : ordered.filter((c) => !c.pass || c.alwaysShow);
  const { okCount, warnCount, failCount } = summarizeChecks(reportChecks);
  const nextSteps = extractNextSteps(reportChecks, reconcileDrift);

  println('Construct Health Check');
  println('══════════════════════');
  println('');

  for (const check of visible) {
    println(`  ${check.label.padEnd(40)} ${symbolForCheck(check)}`);
  }

  if (!showPasses && okCount > 0) {
    println('');
    println(`  (${okCount} check${okCount === 1 ? '' : 's'} passed — run without --summary to view)`);
  }

  if (reconcileDrift.length > 0) {
    println('');
    println('Reconciliation drift:');
    for (const task of reconcileDrift) {
      println(`  ⚠ ${task.id} (${task.safety})`);
      if (task.summary) println(`       ${task.summary}`);
      println(`       fix: construct sync --reconcile=${task.id}`);
    }
  }

  println('');
  println(`Results: ${okCount} passed, ${warnCount} warnings, ${failCount} failed`);

  if (nextSteps.length > 0) {
    println('');
    println('Suggested next steps:');
    for (const step of nextSteps.slice(0, 8)) println(`  ${step}`);
    if (nextSteps.length > 8) println(`  … +${nextSteps.length - 8} more (see labels above)`);
  }

  if (failCount > 0) {
    println('');
    println('Auto-fix (where supported): construct doctor --fix');
  }

  if (firstRunReadinessLine) {
    println('');
    println(firstRunReadinessLine);
  }

  return { okCount, warnCount, failCount };
}
