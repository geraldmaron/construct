/**
 * lib/oracle/cli.mjs — CLI handlers for `construct oracle <subcommand>`.
 *
 * Subcommands: start, status, review, pending, approve, gaps, reconcile.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readHeartbeat } from '../daemons/contract.mjs';
import {
  buildOracleDaemon,
  heartbeatPath,
  readLastTick,
  KILLSWITCH_ENV,
} from './index.mjs';
import { runOracleTick, listPending, approvePending, defaultRootDir } from './actions.mjs';
import { collectOracleGaps, formatOracleGapsReport } from './gaps.mjs';
import { reconcileOracleHygieneBeads } from './reconcile.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const MODULE_FILE = fileURLToPath(import.meta.url);

function runtimeDir(homeDir) {
  return path.join(doctorRoot(homeDir), 'runtime', 'oracle');
}

async function cmdStart(args, { rootDir, projectDir, homeDir }) {
  const hb = heartbeatPath(homeDir);
  const live = readHeartbeat(hb);
  if (live) {
    process.stdout.write(`oracle daemon already running (pid ${live.pid})\n`);
    return 0;
  }

  if (process.env[KILLSWITCH_ENV] === 'off' || process.env[KILLSWITCH_ENV] === '0') {
    process.stderr.write(`oracle daemon disabled (${KILLSWITCH_ENV}=off)\n`);
    return 1;
  }

  const foreground = args.includes('--foreground') || args.includes('-f');
  if (foreground) {
    const daemon = buildOracleDaemon({ rootDir, projectDir, homeDir });
    const result = await daemon.run();
    process.stdout.write(`oracle daemon stopped: ${result.reason}\n`);
    return 0;
  }

  const entry = path.join(path.dirname(MODULE_FILE), 'daemon-entry.mjs');
  const logDir = runtimeDir(homeDir);
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'oracle-daemon.log');
  const fd = fs.openSync(logFile, 'a');

  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ['ignore', fd, fd],
    env: {
      ...process.env,
      CONSTRUCT_ORACLE_ROOT: rootDir,
      CONSTRUCT_ORACLE_PROJECT: projectDir,
    },
    cwd: projectDir,
  });
  child.unref();
  process.stdout.write(`oracle daemon started (pid ${child.pid})\n`);
  return 0;
}

function cmdStatus(_args, { homeDir }) {
  const hb = readHeartbeat(heartbeatPath(homeDir));
  const last = readLastTick(homeDir);
  const payload = {
    running: !!hb,
    heartbeat: hb,
    lastTick: last,
    killswitch: process.env[KILLSWITCH_ENV] === 'off' || process.env[KILLSWITCH_ENV] === '0',
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  return 0;
}

async function cmdReview(args, { rootDir, projectDir, homeDir }) {
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  const result = await runOracleTick({ rootDir, projectDir, homeDir, dryRun });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`Oracle verdict: ${result.verdict}\n`);
  if (result.gaps.length) {
    process.stdout.write(`Gaps (${result.gaps.length}):\n`);
    for (const g of result.gaps) {
      process.stdout.write(`  [${g.severity}] ${g.id}: ${g.detail}\n`);
    }
  }
  if (result.tick.executed.length) {
    process.stdout.write(`Auto-executed (${result.tick.executed.length}):\n`);
    for (const e of result.tick.executed) {
      process.stdout.write(`  ${e.kind}: ${e.result?.ok ? 'ok' : 'failed'}\n`);
    }
  }
  if (result.tick.queued.length) {
    process.stdout.write(`Queued for approval (${result.tick.queued.length}):\n`);
    for (const q of result.tick.queued) {
      process.stdout.write(`  ${q.id} ${q.kind}: ${q.summary}\n`);
    }
  }
  return 0;
}

function cmdPending(_args, { projectDir }) {
  const pending = listPending(projectDir).filter((p) => p.status !== 'approved');
  process.stdout.write(JSON.stringify(pending, null, 2) + '\n');
  return 0;
}

function cmdApprove(args, { projectDir, rootDir, homeDir }) {
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    process.stderr.write('Usage: construct oracle approve <id> [--no-execute]\n');
    return 1;
  }
  const noExecute = args.includes('--no-execute');
  return approvePending(projectDir, id, {
    execute: !noExecute,
    rootDir,
    homeDir,
  }).then((result) => {
    if (!result.ok) {
      process.stderr.write(`approve failed: ${result.reason}\n`);
      return 1;
    }
    process.stdout.write(JSON.stringify(result.action, null, 2) + '\n');
    return 0;
  });
}

function cmdGaps(args, { projectDir }) {
  const json = args.includes('--json');
  const data = collectOracleGaps(projectDir);
  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(formatOracleGapsReport(data));
  return 0;
}

async function cmdReconcile(args, { projectDir }) {
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  const result = await reconcileOracleHygieneBeads({ projectDir, dryRun });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(`Oracle reconcile${dryRun ? ' (dry-run)' : ''}: found ${result.found} hygiene beads\n`);
  if (Object.keys(result.kept).length) {
    process.stdout.write(`Keeping newest per gap: ${JSON.stringify(result.kept)}\n`);
  }
  process.stdout.write(`Planned close: ${result.plannedClose.length}\n`);
  if (!dryRun) process.stdout.write(`Closed: ${result.closed.length}\n`);
  if (result.raisedPruned) process.stdout.write(`Pruned raised-issues rows: ${result.raisedPruned}\n`);
  if (result.contractViolations?.superseded) {
    process.stdout.write(`Superseded ${result.contractViolations.recentCount} bare-goal contract violation(s)\n`);
  } else if (result.contractViolations?.wouldSupersede) {
    process.stdout.write(`Would supersede ${result.contractViolations.recentCount} bare-goal contract violation(s)\n`);
  }
  return 0;
}

/**
 * Entry point for bin/construct.
 */
export async function runOracleCli(args, opts = {}) {
  const sub = args[0];
  const subArgs = args.slice(1);
  const homeDir = opts.homeDir ?? os.homedir();
  const rootDir = opts.rootDir ?? defaultRootDir();
  const projectDir = opts.projectDir ?? process.cwd();

  switch (sub) {
    case 'start': return cmdStart(subArgs, { rootDir, projectDir, homeDir });
    case 'status': return cmdStatus(subArgs, { homeDir });
    case 'review': return cmdReview(subArgs, { rootDir, projectDir, homeDir });
    case 'pending': return cmdPending(subArgs, { projectDir });
    case 'approve': return cmdApprove(subArgs, { projectDir, rootDir, homeDir });
    case 'gaps': return cmdGaps(subArgs, { projectDir });
    case 'reconcile': return cmdReconcile(subArgs, { projectDir });
    default:
      process.stderr.write(
        'Usage: construct oracle <start|status|review|pending|approve|gaps|reconcile> [--json] [--dry-run] [--foreground] [--no-execute]\n',
      );
      if (sub && sub !== '--help' && sub !== '-h') {
        process.stderr.write(`Unknown subcommand: ${sub}\n`);
        return 1;
      }
      return sub === '--help' || sub === '-h' ? 0 : 1;
  }
}
