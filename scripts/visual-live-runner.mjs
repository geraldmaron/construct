#!/usr/bin/env node
/**
 * scripts/visual-live-runner.mjs — watchable visual test runner for Construct surfaces.
 *
 * --watch opens a browser dashboard (and optionally a macOS Terminal replay).
 * Hermetic mode exercises slash commands; live mode scores role depth on Sonnet 4.6.
 *
 * Usage:
 *   npm run test:visual:watch
 *   node scripts/visual-live-runner.mjs --live --watch --role developer
 *   node scripts/visual-live-runner.mjs --watch --terminal
 */

import { listRoleIds } from '../tests/visual/lib/role-expectations.mjs';
import { runVisualSuite } from '../tests/visual/lib/run-suite.mjs';
import { visualLiveSkipReason } from '../tests/visual/lib/live-turn.mjs';
import { createWitnessDashboard, openWitnessInBrowser } from '../tests/visual/lib/witness-dashboard.mjs';
import { launchTerminalReplay } from '../tests/visual/lib/terminal-replay.mjs';

function parseArgs(argv) {
  const opts = {
    mode: 'hermetic',
    watch: false,
    terminal: false,
    roleIds: null,
    port: Number(process.env.CONSTRUCT_VISUAL_PORT || 9333),
    keepOpenMs: Number(process.env.CONSTRUCT_VISUAL_KEEP_OPEN_MS || 45_000),
  };
  for (const arg of argv) {
    if (arg === '--live') opts.mode = 'live';
    if (arg === '--hermetic') opts.mode = 'hermetic';
    if (arg === '--watch' || arg === '-w') opts.watch = true;
    if (arg === '--terminal' || arg === '-t') opts.terminal = true;
    if (arg === '--no-browser') opts.watch = false;
    if (arg.startsWith('--role=')) {
      opts.roleIds = arg.slice('--role='.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (arg.startsWith('--port=')) opts.port = Number(arg.slice('--port='.length));
  }
  return opts;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.mode === 'live') {
    const skip = visualLiveSkipReason(process.env);
    if (skip) {
      console.error(`Live visual tests skipped: ${skip}`);
      console.error('Example: CONSTRUCT_VISUAL_LIVE=1 ANTHROPIC_API_KEY=… npm run test:visual:live');
      process.exit(0);
    }
  }

  let dashboard = null;
  let witness = null;
  const paceMs = opts.watch ? 700 : 0;

  if (opts.watch) {
    dashboard = createWitnessDashboard({ port: opts.port });
    const url = await dashboard.start();
    witness = dashboard.witness;
    dashboard.init({ mode: opts.mode });
    console.error(`Opening visual witness dashboard: ${url}`);
    await openWitnessInBrowser(url);
    await sleep(800);
  }

  if (opts.terminal) {
    const opened = launchTerminalReplay();
    if (opened) console.error('Opened Terminal.app replay — native ANSI chat output');
    else console.error('--terminal is only available on macOS');
  }

  console.error(`Construct visual runner — mode=${opts.mode} watch=${opts.watch} terminal=${opts.terminal}`);
  if (opts.roleIds?.length) console.error(`Roles: ${opts.roleIds.join(', ')}`);
  else if (opts.mode === 'live') console.error(`Roles: ${listRoleIds().join(', ')}`);

  const result = await runVisualSuite({
    mode: opts.mode,
    roleIds: opts.roleIds,
    watch: opts.watch,
    witness,
    paceMs,
  });

  if (result.skipped) {
    if (dashboard) await dashboard.stop();
    console.error(result.reason);
    process.exit(0);
  }

  const summary = result.summary;
  if (witness?.summary) witness.summary(summary);
  if (dashboard) {
    dashboard.init({ evidenceDir: summary.evidenceDir || result.ev?.dir, mode: opts.mode });
    console.error(`\nWitness dashboard: ${dashboard.url}`);
    console.error(`Evidence folder: ${summary.evidenceDir || result.ev?.dir || '(none)'}`);
    console.error(`Keeping dashboard open for ${opts.keepOpenMs / 1000}s — use stage nav to jump, repo paths open in editor`);
    await sleep(opts.keepOpenMs);
    await dashboard.stop();
  }

  console.error('\n--- summary ---');
  console.error(JSON.stringify(summary, null, 2));

  if (summary.evidenceDir) console.error(`\nEvidence: ${summary.evidenceDir}`);
  else if (result.ev?.dir) console.error(`\nEvidence: ${result.ev.dir}`);

  if (opts.mode === 'live' && summary.tuningSignals?.length) {
    console.error('\n--- specialist/skill tuning signals ---');
    for (const sig of summary.tuningSignals) {
      console.error(`  [${sig.roleId}] ${sig.warning}`);
    }
  }

  process.exit(summary.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
