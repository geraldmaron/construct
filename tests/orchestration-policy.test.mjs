/**
 * tests/orchestration-policy.test.mjs — routeRequest dispatch classification tests
 *
 * Tests the orchestration routing policy in lib/orchestrate.mjs. Verifies that
 * routeRequest correctly classifies requests into immediate, focused, or orchestrated
 * dispatch modes and produces the expected Worker Profile assignments. Also covers the
 * orchestrationPolicy MCP tool (auto-workflow-intake: draftTask generation).
 *
 * The retired buildDispatchPlan/buildDispatchSummary
 * functions and the route.dispatchPlan/route.dispatchSummary fields they
 * populated are gone — sequencing a resolved route is not prose the route
 * object carries for a caller to read and self-sequence. dispatchReasons stays:
 * the per-assignment reason data attached to each proactive trigger, not the
 * retired prose.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTION_TRACKS,
  INTENT_CLASSES,
  WORK_CATEGORIES,
  buildConstructToOrchestratorPacket,
  detectRiskFlags,
  requiresExecutiveApproval,
  routeRequest,
  routeRequestVerified,
} from '../lib/orchestration-policy.mjs';

const assigned = (route) => route.assignments.map((assignment) => assignment.workerProfileId);
import { resetCache as resetIntentCache } from '../lib/intent-classifier.mjs';
import { orchestrationPolicy } from '../lib/mcp/tools/skills.mjs';

test('routeRequest classifies simple explanation as immediate research', () => {
  const route = routeRequest({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.equal(route.intent, INTENT_CLASSES.research);
  assert.equal(route.track, EXECUTION_TRACKS.immediate);
  assert.equal(route.workCategory, WORK_CATEGORIES.quick);
  assert.deepEqual(assigned(route), []);
});

test('routeRequest sends external research requests through a workflow-backed research path', () => {
  const route = routeRequest({ request: 'do research on oidc', fileCount: 1, moduleCount: 1 });
  assert.equal(route.intent, INTENT_CLASSES.research);
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.equal(route.suggestedWorkflowType, 'research-synthesis');
  assert.deepEqual(assigned(route), ['researcher']);
  assert.equal(route.researchExecutionPolicy?.mode, 'evidence-first');
  assert.equal(route.researchExecutionPolicy?.canResearchInsideOrOutsideProject, true);
});

test('routeRequest returns a docs fallback ladder for library research', () => {
  const route = routeRequest({ request: 'research the latest Next.js caching docs', fileCount: 1, moduleCount: 1 });
  assert.equal(route.intent, INTENT_CLASSES.research);
  assert.equal(route.researchExecutionPolicy?.domain, 'library-docs');
  assert.match(JSON.stringify(route.researchExecutionPolicy?.toolRouting || []), /Context7/i);
  assert.match(JSON.stringify(route.researchExecutionPolicy?.toolRouting || []), /official docs/i);
});

test('routeRequest routes typed artifact drafting through the matching workflow and owner', () => {
  const route = routeRequest({ request: 'draft a PRD for onboarding', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.equal(route.suggestedWorkflowType, 'prd-draft');
  assert.ok(assigned(route).includes('product-manager'));
  assert.ok(assigned(route).includes('reviewer'));
});

test('routeRequest classifies feature build as orchestrated implementation', () => {
  const route = routeRequest({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  assert.equal(route.intent, INTENT_CLASSES.implementation);
  assert.equal(route.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(assigned(route).includes('architect'));
  assert.ok(assigned(route).includes('engineer'));
  assert.ok(assigned(route).includes('reviewer'));
  assert.ok(assigned(route).includes('qa'));
});

test('detectRiskFlags fires on infrastructure-as-code vocabulary', () => {
  const flags = detectRiskFlags('design our terraform agent strategy with blast radius controls, OIDC credential handling, and a phased production rollout');
  assert.equal(flags.architecture, true, 'terraform/blast radius/rollout must fire architecture');
  assert.equal(flags.security, true, 'OIDC/credential must fire security');
});

test('routeRequest sends a loosely-scoped Terraform agent strategy to orchestrated with adversarial review', () => {
  // Regression: this exact shape (new architectural direction + credential
  // handling + phased rollout) was mis-classified as immediate and
  // solo-authored. It must land orchestrated and pull the adversarial chain
  // even when the file/module estimate is small.
  const route = routeRequest({
    request: 'design our terraform agent strategy with blast radius controls, OIDC credential handling, and a phased production rollout',
    fileCount: 1,
    moduleCount: 1,
  });
  assert.equal(route.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(assigned(route).includes('architect'), 'architect owns the structure');
  assert.ok(assigned(route).includes('security'), 'security challenges the credential/state model');
  assert.ok(assigned(route).includes('reviewer'), 'reviewer pressure-tests the approach (devil-advocate overlay)');
});

test('routeRequest classifies fix requests through debugger path', () => {
  const route = routeRequest({ request: 'fix the login redirect bug', fileCount: 2, moduleCount: 1 });
  assert.equal(route.intent, INTENT_CLASSES.fix);
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(assigned(route), ['debugger', 'engineer']);
});

test('requiresExecutiveApproval respects approval boundaries', () => {
  assert.equal(requiresExecutiveApproval({}), false);
  assert.equal(requiresExecutiveApproval({ irreversibleAction: true }), true);
  assert.equal(requiresExecutiveApproval({ productDecision: true }), true);
});

test('routeRequest no longer carries a prose dispatch plan or summary (ADR-0067)', () => {
  const route = routeRequest({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  assert.equal('dispatchPlan' in route, false, 'sequencing prose is retired — the flow engine owns sequencing now');
  assert.equal('dispatchSummary' in route, false, 'sequencing prose is retired — the flow engine owns sequencing now');
});

test('orchestrationPolicy includes draftTask for non-immediate requests', async () => {
  const result = await orchestrationPolicy({ request: 'fix the login redirect bug', fileCount: 2, moduleCount: 1 });
  assert.ok(result.draftTask, 'draftTask should be present for focused/orchestrated requests');
  assert.equal(result.draftTask.status, 'todo');
  assert.ok(result.draftTask.owner, 'draftTask should have an owner');
  assert.ok(result.draftTask.phase, 'draftTask should have a phase');
  assert.ok(Array.isArray(result.draftTask.acceptanceCriteria), 'draftTask should have acceptanceCriteria array');
  assert.equal(result.draftTask.source.intent, INTENT_CLASSES.fix);
  assert.equal(result.draftTask.source.track, EXECUTION_TRACKS.focused);
  assert.equal('handoffPacket' in result, false, 'retired agent-contract packet must not cross the MCP boundary');
});

test('buildConstructToOrchestratorPacket returns null for immediate track', () => {
  const packet = buildConstructToOrchestratorPacket({ request: 'explain how caching works', fileCount: 1, moduleCount: 1 });
  assert.equal(packet, null);
});

test('orchestrationPolicy omits draftTask for immediate requests', async () => {
  const result = await orchestrationPolicy({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.equal(result.track, EXECUTION_TRACKS.immediate);
  assert.equal(result.draftTask, null);
  assert.equal('handoffPacket' in result, false);
});

test('orchestrationPolicy hands back an explicit orchestration_run nextAction for orchestrated work, null for immediate', async () => {
  const research = await orchestrationPolicy({ request: 'Research agentic platforms and cite primary sources' });
  assert.notEqual(research.track, EXECUTION_TRACKS.immediate);
  assert.ok(research.nextAction, 'a non-immediate plan carries a next action');
  assert.equal(research.nextAction.tool, 'orchestration_run', 'routes to the governed run, not a workflow-type-as-tool');
  assert.equal(research.nextAction.arguments.request, 'Research agentic platforms and cite primary sources');
  assert.match(research.nextAction.instruction, /not a tool|do not call/i, 'warns against inventing a tool from the workflow type');

  const immediate = await orchestrationPolicy({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.equal(immediate.track, EXECUTION_TRACKS.immediate);
  assert.equal(immediate.nextAction, null, 'immediate requests need no orchestration_run hop');
});

test('orchestrationPolicy includes approvalRequired and terminalStates', async () => {
  const result = await orchestrationPolicy({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  assert.equal(typeof result.approvalRequired, 'boolean');
  assert.ok(Array.isArray(result.terminalStates));
  assert.ok(result.terminalStates.includes('DONE'));
});

test('orchestrationPolicy does not embed a duplicate Worker Profile catalog', async () => {
  const result = await orchestrationPolicy({ request: 'explain caching', fileCount: 1, moduleCount: 1 });
  assert.equal('specialistCatalog' in result, false);
  assert.equal('workerProfileCatalog' in result, false, 'catalog discovery stays on the registry tools');
});

test('routeRequest dispatches security on compliance keyword (focused track)', () => {
  const route = routeRequest({ request: 'review GDPR compliance of our consent flow', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(assigned(route), ['security']);
});

test('routeRequest prepends security pre-architect on orchestrated track (legal-compliance keyword)', () => {
  const route = routeRequest({ request: 'build the SOC 2 attestation evidence pipeline end to end', fileCount: 4, moduleCount: 2 });
  assert.equal(route.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(assigned(route).includes('security'));
  assert.ok(assigned(route).indexOf('security') < assigned(route).indexOf('architect'));
});

test('routeRequest dispatches product-manager on GTM keyword (focused track)', () => {
  const route = routeRequest({ request: 'sketch the go-to-market positioning for the new tier', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(assigned(route), ['product-manager']);
});

test('routeRequest dispatches operations on dependency-sequencing keyword', () => {
  const route = routeRequest({ request: 'work out the critical path through the multi-quarter plan', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(assigned(route), ['operations']);
});

test('routeRequest dispatches architect on hypothesis keyword (rd-lead framing gate folded into architect)', () => {
  const focused = routeRequest({ request: 'frame the hypothesis we should be testing', fileCount: 2, moduleCount: 1 });
  assert.equal(focused.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(assigned(focused), ['architect']);

  const orchestrated = routeRequest({ request: 'build a falsifiable proof of concept system end to end', fileCount: 4, moduleCount: 2 });
  assert.equal(orchestrated.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(assigned(orchestrated).includes('architect'));
});

test('routeRequest dispatches researcher on recon keyword (focused track; explorer overlay)', () => {
  const route = routeRequest({ request: 'do a scoping pass on the auth module — orient me', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(assigned(route), ['researcher']);
});

test('routeRequestVerified returns the keyword route synchronously without waiting on the LLM', () => {
  resetIntentCache();
  let callerInvocations = 0;
  const caller = async () => {
    callerInvocations += 1;
    return new Promise(() => { /* never resolves — pins that dispatch does not await */ });
  };
  const route = routeRequestVerified({
    request: 'design a better cache architecture for the data model with the test plan attached',
    fileCount: 4,
    moduleCount: 2,
    modelCaller: caller,
  });
  assert.equal(route.roleFlavors.architect, 'data', 'flavor stays whatever the keyword classifier matched');
  assert.equal(typeof route.verificationsPending, 'number', 'count of background verifications attached');
  assert.ok(route.verificationsPending >= 1);
  assert.equal(callerInvocations >= 1, true, 'verifier still fires — just in the background');
});

test('routeRequestVerified logs an agreement record to the injected logger', async () => {
  resetIntentCache();
  const logged = [];
  const caller = async () => JSON.stringify({ verified: false, confidence: 0.85, reason: 'incidental keyword' });
  routeRequest({ request: 'plan the test suite for the model evaluation harness' });
  const route = await import('../lib/orchestration-policy.mjs').then((m) =>
    m.routeRequest({ request: 'plan the test suite for the model evaluation harness' }),
  );
  const { verifyRoute } = await import('../lib/intent-classifier.mjs');
  verifyRoute(route, {
    request: 'plan the test suite for the model evaluation harness',
    modelCaller: caller,
    logger: (e) => logged.push(e),
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(logged.length >= 1, 'at least one verification record was emitted');
  const entry = logged[0];
  assert.equal(entry.keywordVerdict, true);
  assert.equal(entry.llmVerdict, false);
  assert.equal(entry.agreed, false, 'keyword=true, llm=false → disagreement');
  assert.equal(entry.confidence, 0.85);
});

test('requestSignals returns structured signals for a vague feature ask', async () => {
  const { requestSignals } = await import('../lib/orchestration-policy.mjs');
  const signals = requestSignals('build me some kind of notifications feature, not sure exactly what');
  assert.ok(signals.ambiguityScore > 0);
  assert.equal(signals.hasSuccessMetric, false);
  assert.equal(signals.blastRadius, 'narrow');
});

test('requestSignals flags wide blast radius and auth surface', async () => {
  const { requestSignals } = await import('../lib/orchestration-policy.mjs');
  const signals = requestSignals('migrate all users to the new auth flow — destructive backfill');
  assert.equal(signals.blastRadius, 'wide');
  assert.equal(signals.authOrPayments, true);
});

test('proactiveTriggers fires security pre-dispatch on auth + wide blast', async () => {
  const { proactiveTriggers, requestSignals } = await import('../lib/orchestration-policy.mjs');
  const signals = requestSignals('migrate all users to the new auth flow — destructive backfill');
  const triggers = proactiveTriggers(signals);
  const security = triggers.find((t) => t.workerProfile === 'security');
  assert.ok(security, 'expected security in triggers');
  assert.match(security.reason, /auth|threat|payments/i);
});

test('routeRequest surfaces dispatchReasons for proactive triggers', async () => {
  const { routeRequest } = await import('../lib/orchestration-policy.mjs');
  const route = routeRequest({
    request: 'migrate all users to the new auth flow with a destructive backfill end to end',
    fileCount: 4,
    moduleCount: 2,
  });
  assert.ok(assigned(route).includes('security'));
  assert.match(route.dispatchReasons['security'] || '', /auth|payments|threat/i);
});

test('formatOverlaySelection emits one line per non-null flavor with the cx-<role>: loaded <role>.<flavor> overlay shape', async () => {
  const { formatOverlaySelection } = await import('../lib/orchestration-policy.mjs');
  const lines = formatOverlaySelection({
    engineer: 'platform',
    architect: 'ai-systems',
    productManager: null,
    dataAnalyst: 'experiment',
    qa: null,
    security: null,
    dataEngineer: null,
  });
  assert.deepEqual(lines, [
    'engineer: loaded engineer.platform overlay',
    'architect: loaded architect.ai-systems overlay',
    'data-analyst: loaded data-analyst.experiment overlay',
  ]);
});

test('formatOverlaySelection returns an empty list when no flavors match or input is malformed', async () => {
  const { formatOverlaySelection } = await import('../lib/orchestration-policy.mjs');
  assert.deepEqual(formatOverlaySelection(null), []);
  assert.deepEqual(formatOverlaySelection({}), []);
  assert.deepEqual(formatOverlaySelection({ engineer: null, architect: null }), []);
  assert.deepEqual(formatOverlaySelection('not-an-object'), []);
});
