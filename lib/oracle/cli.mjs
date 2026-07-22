/**
 * lib/oracle/cli.mjs — CLI handlers for `construct oracle <subcommand>`.
 *
 * Subcommands: status, review, pending, approve, gaps, reconcile, triage, invariants, impact,
 * semantic-review, miss (record|process|status), miss-analysis (classify|taxonomy).
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
import { isCleanVerdict } from './synthesize.mjs';

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
  const attention = isCleanVerdict(result.verdict) ? '' : ' (needs attention)';
  process.stdout.write(`Oracle verdict: ${result.verdict}${attention}\n`);
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

async function cmdImpact(args, { projectDir }) {
  const json = args.includes('--json');
  const useStdin = args.includes('--stdin');
  const baseIdx = args.indexOf('--base');
  const mergeBaseIdx = args.indexOf('--merge-base');
  const rangeIdx = args.indexOf('--range');
  const base = baseIdx >= 0 ? args[baseIdx + 1] : undefined;
  const mergeBase = mergeBaseIdx >= 0 ? args[mergeBaseIdx + 1] : undefined;
  const range = rangeIdx >= 0 ? args[rangeIdx + 1] : undefined;
  let files = args.filter((a, i) => !a.startsWith('--') && ![baseIdx, mergeBaseIdx, rangeIdx].some((idx) => idx >= 0 && (i === idx + 1)));

  const { resolveChangedFiles, computeChangeAwareImpact } = await import('./impact-analysis.mjs');
  if (useStdin) {
    const { readFileSync } = await import('node:fs');
    try {
      files = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      files = [];
    }
  }

  const resolved = files.length
    ? { changed: files, source: 'explicit' }
    : resolveChangedFiles(projectDir, { base, mergeBase, range });
  if (resolved.error) {
    process.stderr.write(`Layer 2 impact: ${resolved.error}\n`);
    return 1;
  }
  if (resolved.changed.length === 0) {
    process.stderr.write('Layer 2 impact: no changed files resolved (pass paths, --stdin, or use git diff).\n');
    return 1;
  }

  const result = computeChangeAwareImpact({ rootDir: projectDir, changedFiles: resolved.changed });
  const payload = { ...result, resolution: resolved.source };
  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return result.graphPresent ? 0 : 1;
  }

  process.stdout.write(`Layer 2 impact (${resolved.source}): ${result.changed.length} changed file(s)\n`);
  process.stdout.write(`Coupled producers (${result.producers.length}): ${result.producers.join(', ') || '(none)'}\n`);
  process.stdout.write(`Coupled consumers (${result.consumers.length}): ${result.consumers.join(', ') || '(none)'}\n`);
  process.stdout.write(`Changed contracts (${result.changedContracts.length}): ${result.changedContracts.join(', ') || '(none)'}\n`);
  process.stdout.write(`Invalidated evidence tests (${result.invalidatedEvidence.length}): ${result.invalidatedEvidence.join(', ') || '(none)'}\n`);
  process.stdout.write(`Untested capabilities (${result.untestedCapabilities.length}): ${result.untestedCapabilities.join(', ') || '(none)'}\n`);
  if (!result.graphPresent) {
    process.stderr.write('No dependency graph found. Run `construct graph build` first.\n');
    return 1;
  }
  return 0;
}

async function cmdInvariants(args, { projectDir }) {
  const json = args.includes('--json');
  const { runInvariants } = await import('./invariants/registry.mjs');
  const result = await runInvariants({ cwd: projectDir });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.overall === 'failed' ? 1 : 0;
  }
  process.stdout.write(`Oracle invariants: ${result.overall}\n`);
  for (const inv of result.invariants) {
    const violationCount = inv.violations?.length || 0;
    process.stdout.write(`  [${inv.status}] ${inv.id}${violationCount ? ` — ${violationCount} violation(s)` : ''}\n`);
    for (const v of inv.violations || []) {
      process.stdout.write(`    ${v.beadId}: ${v.detail}\n`);
    }
  }
  return result.overall === 'failed' ? 1 : 0;
}

async function cmdSemanticReview(args, { projectDir }) {
  const json = args.includes('--json');
  const { runSemanticReview } = await import('./semantic-review.mjs');
  let changedFiles = args.filter((a) => !a.startsWith('--'));
  let layer2Couplings = [];

  if (changedFiles.length) {
    const { computeChangeAwareImpact } = await import('./impact-analysis.mjs');
    const impact = computeChangeAwareImpact({ rootDir: projectDir, changedFiles });
    layer2Couplings = impact.layer2Couplings || [];
  }

  const result = runSemanticReview({ rootDir: projectDir, changedFiles, layer2Couplings });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.overall === 'failed' ? 1 : 0;
  }

  process.stdout.write(`Layer 3 semantic review: ${result.overall} (${result.applicableCount}/${result.seedCorpusSize} applicable)\n`);
  for (const review of result.reviews) {
    process.stdout.write(`  [${review.status}] ${review.id}: ${review.detail || review.summary || ''}\n`);
  }
  return result.overall === 'failed' ? 1 : 0;
}

async function cmdMiss(args, { projectDir }) {
  const json = args.includes('--json');
  const action = ['record', 'process', 'status'].includes(args[0]) ? args[0] : null;
  const rest = action ? args.slice(1) : args;

  if (!action) {
    process.stderr.write('Usage: construct oracle miss <record|process|status> [--json]\n');
    return 1;
  }

  const { processMiss, recordMiss, summarizeLearningLoop } = await import('./learning-loop.mjs');

  if (action === 'status') {
    const summary = summarizeLearningLoop(projectDir);
    if (json) {
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`Oracle learning loop: ${summary.totalMisses} recorded miss(es)\n`);
    for (const [classId, count] of Object.entries(summary.byClass)) {
      process.stdout.write(`  ${classId}: ${count}\n`);
    }
    return 0;
  }

  const descIdx = rest.indexOf('--description');
  const beadIdx = rest.indexOf('--bead');
  const description = descIdx >= 0 ? rest[descIdx + 1] : rest.filter((a) => !a.startsWith('--')).join(' ').trim();
  const beadId = beadIdx >= 0 ? rest[beadIdx + 1] : undefined;

  if (action === 'record') {
    if (!description) {
      process.stderr.write('Usage: construct oracle miss record --description "<text>" [--bead <id>] [--json]\n');
      return 1;
    }
    const record = recordMiss({ rootDir: projectDir, description, beadId });
    if (json) {
      process.stdout.write(JSON.stringify(record, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`Recorded miss ${record.missId}\n`);
    return 0;
  }

  if (action === 'process') {
    let text = description;
    if (rest.includes('--stdin')) {
      const { readFileSync } = await import('node:fs');
      try {
        text = readFileSync(0, 'utf8').trim();
      } catch {
        text = '';
      }
    }
    if (!text) {
      process.stderr.write('Usage: construct oracle miss process --description "<text>" | --stdin [--bead <id>] [--json]\n');
      return 1;
    }
    const output = processMiss({ rootDir: projectDir, description: text, beadId });
    if (json) {
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(`Processed miss ${output.missId}\n`);
    process.stdout.write(`  class: ${output.classification.classId || 'candidate-new-class'}\n`);
    process.stdout.write(`  earliest stage: ${output.earliestDetectionStage}\n`);
    process.stdout.write(`  recurrence: ${output.recurrence.first ? 'first' : 'repeat'} (count ${output.recurrence.count})\n`);
    if (output.proposedInvariant) {
      process.stdout.write(`  proposed invariant: ${output.proposedInvariant.invariantId}\n`);
    }
    return 0;
  }

  process.stderr.write(`Unknown miss action: ${action}\n`);
  return 1;
}

async function cmdMissAnalysis(args, { projectDir }) {
  const json = args.includes('--json');
  const action = ['classify', 'taxonomy'].includes(args[0]) ? args[0] : null;
  const rest = action ? args.slice(1) : args;

  if (!action) {
    process.stderr.write('Usage: construct oracle miss-analysis <classify|taxonomy> [--json]\n');
    return 1;
  }

  const { analyzeMiss, listMissClasses } = await import('./miss-analysis.mjs');

  if (action === 'taxonomy') {
    const taxonomy = listMissClasses();
    if (json) {
      process.stdout.write(JSON.stringify({ taxonomy }, null, 2) + '\n');
      return 0;
    }
    for (const c of taxonomy) {
      process.stdout.write(`${c.id} ${c.name}: ${c.summary}\n`);
    }
    return 0;
  }

  let description = '';
  const descIdx = rest.indexOf('--description');
  if (descIdx >= 0) {
    description = rest[descIdx + 1] || '';
  } else if (rest.includes('--stdin')) {
    const { readFileSync } = await import('node:fs');
    try {
      description = readFileSync(0, 'utf8').trim();
    } catch {
      description = '';
    }
  } else {
    description = rest.filter((a) => !a.startsWith('--')).join(' ').trim();
  }

  if (!description) {
    process.stderr.write('Usage: construct oracle miss-analysis classify --description "<text>" | --stdin [--json]\n');
    return 1;
  }

  const result = analyzeMiss({ rootDir: projectDir, description });
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }

  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    return 1;
  }

  const cls = result.classification.classId || 'candidate-new-class';
  process.stdout.write(`Miss analysis: ${cls}\n`);
  process.stdout.write(`  earliest stage: ${result.earliestDetectionStage}\n`);
  process.stdout.write(`  recurrence: ${result.recurrence.isRecurrence ? 'yes' : 'no'} (${result.recurrence.count} prior)\n`);
  if (result.reportCitation) process.stdout.write(`  citation: ${result.reportCitation}\n`);
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
    case 'invariants': return cmdInvariants(subArgs, { projectDir });
    case 'impact': return cmdImpact(subArgs, { projectDir });
    case 'semantic-review': return cmdSemanticReview(subArgs, { projectDir });
    case 'miss': return cmdMiss(subArgs, { projectDir });
    case 'miss-analysis': return cmdMissAnalysis(subArgs, { projectDir });
    default:
      process.stderr.write(
        'Usage: construct oracle <status|review|pending|approve|gaps|reconcile|triage|invariants|impact|semantic-review|miss|miss-analysis> [--json] [--dry-run] [--no-execute]\n',
      );
      if (sub && sub !== '--help' && sub !== '-h') {
        process.stderr.write(`Unknown subcommand: ${sub}\n`);
        return 1;
      }
      return sub === '--help' || sub === '-h' ? 0 : 1;
  }
}
