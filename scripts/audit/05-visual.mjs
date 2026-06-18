/**
 * 05-visual.mjs — Phase 5: objective visual-maturity checks on real --help output.
 *
 * Construct ships a hand-rolled ANSI UI, so the top risk is color/TTY hygiene: piped,
 * non-TTY, NO_COLOR output must contain zero escape sequences. Checks that plus help
 * structure (header + usage) across every command, and category grouping at the top level.
 * Subjective dimensions (decision-point phrasing, outcome quality) are left to an LLM-judge
 * bead — this phase asserts only what is mechanically decidable, to avoid false verdicts.
 *
 * Read-only. Run: node scripts/audit/05-visual.mjs
 */

import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS, CATEGORY_ORDER } from '../../lib/cli-commands.mjs';
import { isolatedEnv, runConstruct, cleanup } from './lib/spawn.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/;

export function runVisual() {
  // Non-TTY (piped) + NO_COLOR: the harness pipes stdout, so spawnSync is already non-TTY.
  const { fakeHome, env } = isolatedEnv({ NO_COLOR: '1' });
  const perCommand = [];
  try {
    for (const spec of CLI_COMMANDS) {
      const r = runConstruct([spec.name, '--help'], { env, timeout: 6000 });
      const out = r.stdout || '';
      perCommand.push({
        name: spec.name,
        ansiLeak: ANSI.test(out),
        hasHeader: out.includes(`construct ${spec.name}`),
        hasUsage: /\n\s*Usage:/i.test(out) || /Usage:/i.test(out),
      });
    }
    // Default --help is intentionally Core-only; full category grouping shows under --all.
    const top = runConstruct(['--all'], { env, timeout: 6000 });
    const topOut = top.stdout || '';
    const presentCategories = CATEGORY_ORDER.filter((c) => topOut.includes(c));
    const topAnsiLeak = ANSI.test(topOut);
    return { perCommand, top: { ansiLeak: topAnsiLeak, presentCategories, expectedCategories: CATEGORY_ORDER } };
  } finally {
    cleanup(fakeHome);
  }
}

function toFindings(report) {
  const rows = [];
  for (const c of report.perCommand) {
    if (c.ansiLeak) {
      rows.push({ type: 'color-leak-non-tty', target: c.name, severity: 'medium', tier: 'mechanical',
        evidence: 'NO_COLOR + piped --help still contains ANSI escape sequences',
        recommendation: 'Route this output through term-format colour gating (NO_COLOR / non-TTY must strip ANSI).' });
    }
    if (!c.hasUsage) {
      rows.push({ type: 'help-missing-usage', target: c.name, severity: 'low', tier: 'mechanical',
        evidence: '--help output has no Usage: line',
        recommendation: 'Add a Usage: line so every command help has consistent structure.' });
    }
  }
  if (report.top.ansiLeak) {
    rows.push({ type: 'color-leak-non-tty', target: '--help (top level)', severity: 'medium', tier: 'mechanical',
      evidence: 'top-level --help leaks ANSI under NO_COLOR/non-TTY', recommendation: 'Gate top-level help colour on TTY/NO_COLOR.' });
  }
  const missingCats = report.top.expectedCategories.filter((c) => !report.top.presentCategories.includes(c));
  if (missingCats.length) {
    rows.push({ type: 'help-category-missing', target: missingCats.join(','), severity: 'low', tier: 'judgment',
      evidence: `--all/--help does not surface categories: ${missingCats.join(', ')}`,
      recommendation: 'Ensure every populated category is shown as a group header.' });
  }
  return rows;
}

function main() {
  const report = runVisual();
  const findings = toFindings(report);
  recordFindings('05-visual', findings);
  writeJson('visual-report.json', report);
  const leaks = report.perCommand.filter((c) => c.ansiLeak).length;
  const noUsage = report.perCommand.filter((c) => !c.hasUsage).length;
  process.stdout.write(`[audit:05] ${report.perCommand.length} commands: ${leaks} ANSI-leak under NO_COLOR, ${noUsage} missing Usage line. ` +
    `Top-level categories present: ${report.top.presentCategories.length}/${report.top.expectedCategories.length}; top ANSI leak=${report.top.ansiLeak}.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
