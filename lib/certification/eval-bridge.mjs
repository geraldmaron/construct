/**
 * lib/certification/eval-bridge.mjs — connect certification scenarios to eval gates.
 *
 * Maps scenario fixtures to eval dataset items, runs deterministic gates, and
 * builds promotion reports aligned with the improvement-loop semantics.
 */

import {
  buildEvaluationReport,
  recordJudgeMetadata,
  runDeterministicGates,
} from '../evals/gates.mjs';

const DEFAULT_BUDGETS = Object.freeze({ maxCost: 0.5, maxLatencyMs: 30000 });

export function defaultEvalItem(scenario) {
  return {
    schemaVersion: 1,
    id: `cert-${scenario.id}`,
    taskFamily: scenario.capabilityId,
    taskInput: { prompt: scenario.id, intent: 'certification', risk: 'low' },
    capabilitySnapshot: { capabilityClass: 'certification', transport: 'hermetic' },
    allowedTools: ['read', 'search', 'construct'],
    expectedEvidenceBehavior: { requirement: 'none', citationsRequired: false },
    expectedContractResult: { outcome: 'pass' },
    redaction: { state: 'raw', fields: [] },
    sourceTraceIds: [`cert-fixture:${scenario.fixture?.path ?? scenario.id}`],
    humanLabel: { provenance: 'fixture', labeledBy: 'certification', rubricVersion: 'cert-1', correctionId: null },
    split: 'certification',
    expiry: null,
  };
}

// The hermetic candidate is a fixed pass-shaped stub: it exists so a hermetic scenario can
// run the deterministic eval gates without a model call. candidateSource labels it as such,
// so an eval report can never be misread as having graded real specialist output — a live
// scenario supplies a candidate via buildCandidateFromLiveOutput instead.

export function defaultHermeticCandidate(scenario) {
  const traceId = `cert-fixture:${scenario.fixture?.path ?? scenario.id}`;
  return {
    candidateSource: 'hermetic-stub',
    contractResult: { outcome: 'pass' },
    citedSourceIds: [traceId],
    evidence: { provided: true },
    toolsUsed: ['read'],
    permissionViolations: [],
    cost: 0,
    latencyMs: 0,
    output: { scenarioId: scenario.id },
    outputStructured: true,
  };
}

// A candidate built from a real live specialist run, so the eval report reflects measured
// output and its behavioral verdict rather than the always-pass stub.

export function buildCandidateFromLiveOutput(scenario, output, behaviorResult = {}) {
  const traceId = `cert-live:${scenario.fixture?.path ?? scenario.id}`;
  return {
    candidateSource: 'live-output',
    contractResult: { outcome: behaviorResult.pass ? 'pass' : 'fail' },
    citedSourceIds: [traceId],
    evidence: { provided: Boolean(output) },
    toolsUsed: [],
    permissionViolations: [],
    cost: 0,
    latencyMs: 0,
    output: { text: String(output ?? '').slice(0, 4000), failedChecks: behaviorResult.failedChecks ?? [] },
    outputStructured: false,
  };
}

export function buildScenarioEvalContext(scenario) {
  const evalConfig = scenario.eval ?? {};
  const item = evalConfig.item ?? defaultEvalItem(scenario);
  const candidate = evalConfig.candidate ?? defaultHermeticCandidate(scenario);
  const budgets = evalConfig.budgets ?? DEFAULT_BUDGETS;
  return { item, candidate, budgets };
}

export function runScenarioEvalGates(scenario) {
  const { item, candidate, budgets } = buildScenarioEvalContext(scenario);
  const deterministic = runDeterministicGates(candidate, item, budgets);
  const evalGates = deterministic.gates.map((gate) => ({
    id: `eval:${gate.gate}`,
    pass: gate.pass,
    detail: gate.detail,
    evidence: `fixture:${scenario.fixture?.path ?? scenario.id}`,
  }));
  return { deterministic, evalGates, item, candidate, budgets };
}

export function buildScenarioEvaluationReport({ scenario, deterministic, judges = [], baseline = null, candidate = null } = {}) {
  const ctx = buildScenarioEvalContext(scenario);
  return buildEvaluationReport({
    baseline: baseline ?? ctx.candidate,
    candidate: candidate ?? ctx.candidate,
    deterministic,
    judges: judges.map(recordJudgeMetadata),
  });
}
