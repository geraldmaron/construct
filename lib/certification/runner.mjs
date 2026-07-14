/**
 * lib/certification/runner.mjs — execute certification scenarios and persist run records.
 *
 * Hermetic scenarios run deterministic gates only. Live scenarios require
 * CONSTRUCT_CERTIFY_LIVE=1; without opt-in the runner records inconclusive and
 * never promotes a skipped provider call to pass. Paid reference models require
 * CONSTRUCT_CERTIFY_ALLOW_PAID=1 with operator ack recorded on the run artifact.
 */

import path from 'node:path';
import fs from 'node:fs';
import { validateCapabilityLedger } from '../capability-ledger.mjs';
import { validateCorpusInventory } from '../test-corpus-inventory.mjs';
import { validateArtifactRelease } from '../artifact-release-gate.mjs';
import { validateRoleCards } from './role-cards.mjs';
import { auditSpecialistContracts } from './specialist-contracts.mjs';
import { validateAllGoldenArtifactGates } from './artifact-gates.mjs';
import { validateSkillScenarioFixture } from './skill-scenarios.mjs';
import { validateSpecialistScenarioFixture } from './specialist-scenarios.mjs';
import { runSpecialistBehaviorLive } from './specialist-behavior.mjs';
import { runTeamArbitrationLive } from './team-arbitration.mjs';
import { validateAllRoleOverlays } from './role-overlays.mjs';
import { measurePromptBudgetChains } from './prompt-budget.mjs';
import { validateAllArtifactProvenance } from './artifact-provenance.mjs';
import { validateDocumentWorkflowCertification } from './document-workflow.mjs';
import { buildDemoParityReport } from './demo-parity.mjs';
import { redactRealLlmGateEvidence, runRealLlmS3, runRealLlmS8 } from './real-llm-scenarios.mjs';
import { decidePromotion } from '../evals/gates.mjs';
import { buildScenarioEvaluationReport, runScenarioEvalGates } from './eval-bridge.mjs';
import {
  formatModelRoutingSummary,
  listCertificationModels,
  resolveCertificationModel,
} from './model-routing.mjs';
import { deriveVerdictFromExecution } from './run.mjs';
import { fixtureDigest, getScenario, newRunId } from './scenarios.mjs';
import { writeCertificationRun } from './store.mjs';

export const LIVE_OPT_IN_ENV = 'CONSTRUCT_CERTIFY_LIVE';

function liveOptInEnabled(env = process.env) {
  return env[LIVE_OPT_IN_ENV] === '1';
}

async function runGate(gate, { root, scenario, env = process.env, fetchImpl = globalThis.fetch }) {
  if (gate.type === 'capability-ledger-audit') {
    const result = validateCapabilityLedger({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'corpus-inventory-audit') {
    const result = validateCorpusInventory({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'artifact-release-gate') {
    const rel = scenario.fixture.path;
    const result = validateArtifactRelease({
      filePath: path.join(root, rel),
      type: gate.artifactType ?? 'prd',
      rootDir: root,
    });
    return { id: gate.id, pass: result.ok === true, detail: result.errors?.[0] ?? null };
  }
  if (gate.type === 'role-cards-audit') {
    const result = validateRoleCards({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'specialist-contracts-audit') {
    const result = auditSpecialistContracts({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.failures[0]?.specialistId ?? null };
  }
  if (gate.type === 'skill-scenario-audit') {
    const rel = scenario.fixture.path;
    const fixture = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    const result = validateSkillScenarioFixture(fixture, { rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'artifact-golden-audit') {
    const result = validateAllGoldenArtifactGates({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'specialist-scenario-audit') {
    const rel = scenario.fixture.path;
    const fixture = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    const result = validateSpecialistScenarioFixture(fixture, { rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'specialist-behavior-live') {
    const result = await runSpecialistBehaviorLive(scenario, { rootDir: root, env, fetchImpl });
    if (result.inconclusive) {
      return { id: gate.id, pass: false, inconclusive: true, detail: result.detail };
    }
    return {
      id: gate.id,
      pass: result.pass,
      detail: result.pass ? `behavior ok (${result.checks.length} checks)` : `failed: ${result.failedChecks.join(', ')}`,
    };
  }
  if (gate.type === 'team-arbitration-live') {
    const result = await runTeamArbitrationLive({ env, fetchImpl });
    if (result.inconclusive) {
      return { id: gate.id, pass: false, inconclusive: true, detail: result.detail };
    }
    return { id: gate.id, pass: result.pass, detail: result.detail };
  }
  if (gate.type === 'role-overlays-audit') {
    const result = validateAllRoleOverlays({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'prompt-budget-audit') {
    const result = measurePromptBudgetChains({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'artifact-provenance-audit') {
    const result = validateAllArtifactProvenance({ rootDir: root, strict: gate.strict !== false });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'document-workflow-audit') {
    const result = validateDocumentWorkflowCertification({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.errors[0] ?? null };
  }
  if (gate.type === 'demo-parity-audit') {
    const result = buildDemoParityReport({ rootDir: root });
    return { id: gate.id, pass: result.pass, detail: result.mismatches[0]?.detail ?? null };
  }
  if (gate.type === 'real-llm-scenario') {
    const runner = gate.scenario === 's8' ? runRealLlmS8 : runRealLlmS3;
    const result = await runner({ env: process.env });
    if (result.status === 'inconclusive') {
      const evidence = redactRealLlmGateEvidence(result);
      return {
        id: gate.id,
        pass: false,
        detail: result.skip ?? result.detail ?? 'inconclusive',
        ...(evidence ? { evidence } : {}),
        inconclusive: true,
      };
    }
    return { id: gate.id, pass: result.status === 'pass', detail: result.detail ?? result.status };
  }
  if (gate.type === 'live-provider-smoke') {
    return { id: gate.id, pass: false, detail: 'live provider gate not executed in hermetic mode' };
  }
  return { id: gate.id, pass: false, detail: `unknown gate type: ${gate.type}` };
}

function deriveVerdictWithEval({ scenarioGates = [], evalReport = null, providerSkipped = false, qualitative = null, error = null } = {}) {
  if (providerSkipped || error) {
    return deriveVerdictFromExecution({ providerSkipped, error });
  }

  const scenarioFailed = scenarioGates.some((gate) => gate?.pass === false && !gate?.inconclusive);
  const inconclusiveGate = scenarioGates.find((gate) => gate?.inconclusive);
  if (inconclusiveGate) {
    return deriveVerdictFromExecution({ providerSkipped: true, error: inconclusiveGate.detail });
  }
  if (scenarioFailed) {
    return deriveVerdictFromExecution({ gates: scenarioGates });
  }

  const promotion = evalReport?.decision ?? decidePromotion({
    deterministic: evalReport?.blocked != null
      ? { blocked: evalReport.blocked, regressions: (evalReport.gates ?? []).filter((g) => !g.pass).map((g) => g.gate), gates: evalReport.gates ?? [] }
      : null,
    judges: evalReport?.evaluators ?? [],
  });

  if (!promotion.promotable) {
    const source = evalReport?.blocked ? 'deterministic' : (evalReport?.evaluators?.some((j) => j.verdict === 'fail') ? 'qualitative' : 'deterministic');
    return {
      status: 'fail',
      source,
      reason: promotion.reason,
    };
  }

  if (qualitative?.abstained) {
    return deriveVerdictFromExecution({ gates: scenarioGates, qualitative });
  }
  if (typeof qualitative?.score === 'number' && qualitative.score < 0.5) {
    return deriveVerdictFromExecution({ gates: scenarioGates, qualitative });
  }

  return deriveVerdictFromExecution({ gates: scenarioGates, qualitative });
}

export function previewCertificationRun(scenarioId, { repoRoot = process.cwd(), env = process.env, now = () => new Date().toISOString() } = {}) {
  const { scenario } = getScenario(scenarioId, { repoRoot });
  const model = resolveCertificationModel(scenario.model ?? {}, { env, now });
  const mode = scenario.mode ?? 'hermetic';
  const requiresLive = mode === 'live' || scenario.requiresEnv === LIVE_OPT_IN_ENV;
  return {
    scenarioId,
    mode,
    model,
    modelSummary: formatModelRoutingSummary(model),
    requiresLive,
    liveOptIn: liveOptInEnabled(env),
    modelsAvailable: listCertificationModels({ env }),
  };
}

export async function runCertificationScenario(scenarioId, {
  projectDir = process.cwd(),
  repoRoot = projectDir,
  env = process.env,
  now = () => new Date().toISOString(),
  dryRun = false,
  judges = [],
  fetchImpl = globalThis.fetch,
} = {}) {
  const startedAt = now();
  const startMs = Date.now();
  const { root, scenario } = getScenario(scenarioId, { repoRoot });
  const fixturePath = scenario.fixture.path;
  const sha256 = fixtureDigest(root, fixturePath);
  const mode = scenario.mode ?? 'hermetic';
  const requiresLive = mode === 'live' || scenario.requiresEnv === LIVE_OPT_IN_ENV;
  const resolvedModel = resolveCertificationModel(scenario.model ?? {}, { env, now });

  if (resolvedModel.blocked) {
    const verdict = deriveVerdictFromExecution({
      providerSkipped: true,
      error: resolvedModel.blockReason,
    });
    const run = {
      schemaVersion: 1,
      id: newRunId(scenarioId),
      scenarioId,
      capabilityId: scenario.capabilityId,
      model: {
        provider: resolvedModel.provider,
        requestedId: resolvedModel.requestedId,
        resolvedId: resolvedModel.resolvedId,
        tier: resolvedModel.tier,
        paidOptIn: resolvedModel.paidOptIn,
        operatorAckAt: resolvedModel.operatorAckAt,
      },
      fixture: { path: fixturePath, sha256 },
      verdict: { ...verdict, reason: resolvedModel.blockReason },
      gates: [],
      evaluation: null,
      qualitative: null,
      timing: { latencyMs: Date.now() - startMs, startedAt, finishedAt: now() },
      cost: null,
      artifacts: null,
      evidenceVersion: 'corpus-inventory:1',
      createdAt: startedAt,
    };
    if (dryRun) return { dryRun: true, run, exitCode: 2, modelSummary: formatModelRoutingSummary(resolvedModel) };
    writeCertificationRun(run, { rootDir: projectDir });
    return { run, exitCode: 2, modelSummary: formatModelRoutingSummary(resolvedModel) };
  }

  if (requiresLive && !liveOptInEnabled(env)) {
    const verdict = deriveVerdictFromExecution({
      providerSkipped: true,
      gates: [],
    });
    const run = {
      schemaVersion: 1,
      id: newRunId(scenarioId),
      scenarioId,
      capabilityId: scenario.capabilityId,
      model: {
        provider: resolvedModel.provider,
        requestedId: resolvedModel.requestedId,
        resolvedId: resolvedModel.resolvedId,
        tier: resolvedModel.tier,
        paidOptIn: resolvedModel.paidOptIn,
        operatorAckAt: resolvedModel.operatorAckAt,
      },
      fixture: { path: fixturePath, sha256 },
      verdict: { ...verdict, reason: `${LIVE_OPT_IN_ENV}=1 required for live scenarios` },
      gates: [],
      evaluation: null,
      qualitative: null,
      timing: { latencyMs: Date.now() - startMs, startedAt, finishedAt: now() },
      cost: null,
      artifacts: null,
      evidenceVersion: 'corpus-inventory:1',
      createdAt: startedAt,
    };
    if (dryRun) return { dryRun: true, run, exitCode: 2, modelSummary: formatModelRoutingSummary(resolvedModel) };
    writeCertificationRun(run, { rootDir: projectDir });
    return { run, exitCode: 2, modelSummary: formatModelRoutingSummary(resolvedModel) };
  }

  const scenarioGates = [];
  for (const gate of scenario.gates ?? []) {
    scenarioGates.push(await runGate(gate, { root, scenario, env, fetchImpl }));
  }

  const { deterministic, evalGates } = runScenarioEvalGates(scenario);
  const evaluation = buildScenarioEvaluationReport({
    scenario,
    deterministic,
    judges,
  });
  const gates = [...scenarioGates, ...evalGates];

  const qualitative = judges.length > 0
    ? {
      judgeModel: judges[0]?.model ?? null,
      score: judges.every((j) => j.verdict !== 'fail') ? 1 : 0,
      abstained: judges.every((j) => j.verdict === 'abstain'),
    }
    : null;

  const verdict = deriveVerdictWithEval({
    scenarioGates,
    evalReport: evaluation,
    qualitative,
  });

  const run = {
    schemaVersion: 1,
    id: newRunId(scenarioId),
    scenarioId,
    capabilityId: scenario.capabilityId,
    model: {
      provider: resolvedModel.provider,
      requestedId: resolvedModel.requestedId,
      resolvedId: resolvedModel.resolvedId,
      tier: resolvedModel.tier,
      paidOptIn: resolvedModel.paidOptIn,
      operatorAckAt: resolvedModel.operatorAckAt,
    },
    fixture: { path: fixturePath, sha256 },
    verdict,
    gates,
    evaluation,
    qualitative,
    timing: { latencyMs: Date.now() - startMs, startedAt, finishedAt: now() },
    cost: null,
    artifacts: null,
    evidenceVersion: 'corpus-inventory:1',
    createdAt: startedAt,
  };

  if (dryRun) {
    return {
      dryRun: true,
      run,
      exitCode: verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : 2,
      modelSummary: formatModelRoutingSummary(resolvedModel),
    };
  }
  const persisted = writeCertificationRun(run, { rootDir: projectDir });
  const exitCode = verdict.status === 'pass' ? 0 : verdict.status === 'fail' ? 1 : 2;
  return { ...persisted, exitCode, modelSummary: formatModelRoutingSummary(resolvedModel) };
}
