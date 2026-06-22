/**
 * lib/certification/cli.mjs — certification scenario inspection and execution.
 */

import { listScenarios } from './scenarios.mjs';
import { LIVE_OPT_IN_ENV, runCertificationScenario } from './runner.mjs';
import {
  listCertificationRunIds,
  readCertificationRun,
} from './store.mjs';

function printUsage() {
  process.stderr.write(
    'Usage: construct certify <list|show|scenarios|run> …\n' +
    `  run <scenario-id> [--dry-run] [--json]  (live scenarios require ${LIVE_OPT_IN_ENV}=1)\n`,
  );
}

export async function runCertificationCli(args = [], { projectDir = process.cwd(), repoRoot = projectDir, env = process.env } = {}) {
  const sub = args[0] || 'list';
  const rest = args.slice(1);

  if (sub === 'list') {
    const ids = listCertificationRunIds({ rootDir: projectDir });
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify(ids, null, 2)}\n`);
      return 0;
    }
    if (!ids.length) {
      process.stdout.write('No certification runs recorded under .cx/certification/runs/\n');
      return 0;
    }
    for (const id of ids) process.stdout.write(`${id}\n`);
    return 0;
  }

  if (sub === 'scenarios') {
    const scenarios = listScenarios({ repoRoot }).map((entry) => ({
      id: entry.id,
      capabilityId: entry.capabilityId,
      mode: entry.mode ?? 'hermetic',
      requiresEnv: entry.requiresEnv ?? null,
    }));
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify(scenarios, null, 2)}\n`);
      return 0;
    }
    for (const scenario of scenarios) {
      const live = scenario.mode === 'live' ? ` live(${scenario.requiresEnv ?? LIVE_OPT_IN_ENV}=1)` : '';
      process.stdout.write(`${scenario.id}  ${scenario.capabilityId}${live}\n`);
    }
    return 0;
  }

  if (sub === 'show') {
    const runId = rest.find((arg) => !arg.startsWith('-'));
    if (!runId) {
      process.stderr.write('Usage: construct certify show <run-id> [--json]\n');
      return 1;
    }
    const { run } = readCertificationRun(runId, { rootDir: projectDir });
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return 0;
  }

  if (sub === 'run') {
    const scenarioId = rest.find((arg) => !arg.startsWith('-'));
    if (!scenarioId) {
      process.stderr.write(`Usage: construct certify run <scenario-id> [--dry-run] [--json]\n`);
      return 1;
    }
    const dryRun = rest.includes('--dry-run');
    const result = await runCertificationScenario(scenarioId, { projectDir, repoRoot, env, dryRun });
    if (rest.includes('--json')) process.stdout.write(`${JSON.stringify(result.run, null, 2)}\n`);
    else {
      process.stdout.write(`scenario: ${result.run.scenarioId}\n`);
      process.stdout.write(`verdict: ${result.run.verdict.status} (${result.run.verdict.source})\n`);
      if (!dryRun) process.stdout.write(`run-id: ${result.run.id}\n`);
    }
    return result.exitCode ?? 1;
  }

  printUsage();
  return 1;
}
