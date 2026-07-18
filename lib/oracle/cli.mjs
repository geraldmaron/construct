/**
 * lib/oracle/cli.mjs — CLI handlers for `construct oracle <subcommand>`.
 *
 * Subcommands: status, review, pending, approve, gaps, reconcile, triage.
 * The `start` subcommand is retired (maintainer directive 2026-07-18): the
 * legacy oracle background daemon must never run; the workspace control
 * plane (workplace loop, construct-b0nny) replaces it. `start` prints a
 * removal notice and exits non-zero so scripts fail loudly instead of
 * silently spawning nothing.
 */

import os from 'node:os';

import { readHeartbeat } from '../daemons/contract.mjs';
import {
  heartbeatPath,
  readLastTick,
  KILLSWITCH_ENV,
} from './index.mjs';
import { runOracleTick, listPending, approvePending, triagePending, defaultRootDir } from './actions.mjs';
import { collectOracleGaps, formatOracleGapsReport } from './gaps.mjs';
import { reconcileOracleHygieneBeads } from './reconcile.mjs';
import { writeLastTick } from './index.mjs';

function cmdStart() {
  process.stderr.write(
    'construct oracle start has been removed: the oracle background daemon no longer runs.\n'
    + 'One-shot review still works: construct oracle review\n'
    + 'Its successor is the workspace control plane (workplace loop, epic construct-b0nny).\n',
  );
  return 1;
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
  if (!dryRun) writeLastTick(result.tick, homeDir);
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

function cmdTriage(args, { projectDir }) {
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');
  const result = triagePending(projectDir, { dryRun });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  }
  process.stdout.write(
    `Oracle triage${dryRun ? ' (dry-run)' : ''}: ${result.uniqueCount} unique decision(s), ${result.superseded} superseded\n`,
  );
  for (const s of result.survivors) {
    process.stdout.write(`  ${s.id} [${s.status}] x${s.occurrenceCount}: ${s.summary}\n`);
    if (s.producerLinkage) {
      process.stdout.write(`    producer linkage: ${s.producerLinkage.join(', ')} (approving this does not fix the producer)\n`);
    }
  }
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
    case 'start': return cmdStart();
    case 'status': return cmdStatus(subArgs, { homeDir });
    case 'review': return cmdReview(subArgs, { rootDir, projectDir, homeDir });
    case 'pending': return cmdPending(subArgs, { projectDir });
    case 'approve': return cmdApprove(subArgs, { projectDir, rootDir, homeDir });
    case 'gaps': return cmdGaps(subArgs, { projectDir });
    case 'reconcile': return cmdReconcile(subArgs, { projectDir });
    case 'triage': return cmdTriage(subArgs, { projectDir });
    default:
      process.stderr.write(
        'Usage: construct oracle <status|review|pending|approve|gaps|reconcile|triage> [--json] [--dry-run] [--no-execute]\n',
      );
      if (sub && sub !== '--help' && sub !== '-h') {
        process.stderr.write(`Unknown subcommand: ${sub}\n`);
        return 1;
      }
      return sub === '--help' || sub === '-h' ? 0 : 1;
  }
}
