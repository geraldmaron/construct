/**
 * lib/certification/cli.mjs — certification scenario inspection and execution.
 */

import { listScenarios } from './scenarios.mjs';
import { loadCanonicalScenarios, validateCanonicalScenarios } from './canonical-scenarios.mjs';
import { listCertificationModels } from './model-routing.mjs';
import { LIVE_OPT_IN_ENV, previewCertificationRun, runCertificationScenario } from './runner.mjs';
import {
  listCertificationRunIds,
  readCertificationRun,
} from './store.mjs';

function printUsage() {
  process.stderr.write(
    'Usage: construct certify <list|show|scenarios|models|demos|run> …\n' +
    `  run <scenario-id> [--dry-run] [--json]  (live scenarios require ${LIVE_OPT_IN_ENV}=1)\n` +
    '  models [--json]  (lists routable models; paid models require CONSTRUCT_CERTIFY_ALLOW_PAID=1)\n' +
    '  demos [--json]  (canonical demo scenario catalog for Tauri/web/VHS parity)\n',
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

  if (sub === 'models') {
    const models = listCertificationModels({ env }).map((entry) => ({
      id: entry.id,
      tier: entry.tier,
      resolvedId: entry.resolvedId,
      label: entry.label,
    }));
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify(models, null, 2)}\n`);
      return 0;
    }
    for (const model of models) {
      process.stdout.write(`${model.tier.padEnd(16)} ${model.id}\n`);
    }
    return 0;
  }

  if (sub === 'demos') {
    const { catalog } = loadCanonicalScenarios({ rootDir: repoRoot });
    const validation = validateCanonicalScenarios({ rootDir: repoRoot, catalog });
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify({ ...catalog, validation }, null, 2)}\n`);
      return validation.pass ? 0 : 1;
    }
    for (const demo of catalog.demos ?? []) {
      process.stdout.write(`${demo.id}  tape=${demo.tape ?? demo.tapePath}\n`);
    }
    if (!validation.pass) {
      for (const err of validation.errors) process.stderr.write(`error: ${err}\n`);
      return 1;
    }
    return 0;
  }

  if (sub === 'scenarios') {
    const scenarios = listScenarios({ repoRoot }).map((entry) => {
      const preview = previewCertificationRun(entry.id, { repoRoot, env });
      return {
        id: entry.id,
        capabilityId: entry.capabilityId,
        mode: entry.mode ?? 'hermetic',
        requiresEnv: entry.requiresEnv ?? null,
        modelTier: preview.model.tier,
        modelSummary: preview.modelSummary,
      };
    });
    if (rest.includes('--json')) {
      process.stdout.write(`${JSON.stringify(scenarios, null, 2)}\n`);
      return 0;
    }
    for (const scenario of scenarios) {
      const live = scenario.mode === 'live' ? ` live(${scenario.requiresEnv ?? LIVE_OPT_IN_ENV}=1)` : '';
      process.stdout.write(`${scenario.id}  ${scenario.capabilityId}${live}  ${scenario.modelSummary}\n`);
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
    const preview = previewCertificationRun(scenarioId, { repoRoot, env });
    if (!rest.includes('--json')) {
      process.stdout.write(`${preview.modelSummary}\n`);
    }
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
