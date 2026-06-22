/**
 * lib/certification/cli.mjs — certification scenario inspection and execution.
 */

import { listScenarios } from './scenarios.mjs';
import { buildCertificationStatus, formatCertificationStatus } from './status.mjs';
import { loadCanonicalScenarios, validateCanonicalScenarios } from './canonical-scenarios.mjs';
import { listCertificationModels } from './model-routing.mjs';
import { LIVE_OPT_IN_ENV, previewCertificationRun, runCertificationScenario } from './runner.mjs';
import {
  listCertificationRunIds,
  readCertificationRun,
} from './store.mjs';
import { formatReleaseCandidateGate, runReleaseCandidateGate } from './rc-gate.mjs';

function printUsage() {
  process.stderr.write(
    'Usage: construct certify <list|show|scenarios|models|demos|status|gate|run> …\n' +
    '  status [--json] [capability-id]  (omit id for full rollup; pass capability id for detail)\n' +
    '  gate [--json]  (release candidate certification freshness; blocks stale or failing release capabilities)\n' +
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

  if (sub === 'status') {
    const json = rest.includes('--json');
    const capabilityId = rest.find((arg) => !arg.startsWith('-')) ?? null;
    const report = buildCertificationStatus({ rootDir: repoRoot, capabilityId });
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    formatCertificationStatus(report, { capabilityId });
    process.stdout.write('\n');
    return 0;
  }

  if (sub === 'show') {
    const target = rest.find((arg) => !arg.startsWith('-'));
    if (!target) {
      process.stderr.write('Usage: construct certify show <run-id|capability-id> [--json]\n');
      return 1;
    }
    const json = rest.includes('--json');
    if (target.startsWith('cert-')) {
      const { run } = readCertificationRun(target, { rootDir: projectDir });
      process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
      return 0;
    }
    const report = buildCertificationStatus({ rootDir: repoRoot, capabilityId: target });
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    formatCertificationStatus(report, { capabilityId: target });
    process.stdout.write('\n');
    return 0;
  }

  if (sub === 'gate') {
    const json = rest.includes('--json');
    const result = await runReleaseCandidateGate({ rootDir: repoRoot, projectDir, env });
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.pass ? 0 : 1;
    }
    process.stdout.write(formatReleaseCandidateGate(result));
    return result.pass ? 0 : 1;
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
