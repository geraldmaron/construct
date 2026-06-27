/**
 * tests/orchestration-policy.test.mjs — routeRequest dispatch classification tests
 *
 * Tests the orchestration routing policy in lib/orchestrate.mjs. Verifies that
 * routeRequest correctly classifies requests into immediate, focused, or orchestrated
 * dispatch modes and routes to the expected specialist agents. Also covers the
 * orchestrationPolicy MCP tool (auto-workflow-intake: draftTask generation).
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXECUTION_TRACKS,
  INTENT_CLASSES,
  WORK_CATEGORIES,
  buildConstructToOrchestratorPacket,
  buildDispatchPlan,
  detectRiskFlags,
  requiresExecutiveApproval,
  routeRequest,
  routeRequestVerified,
} from '../lib/orchestration-policy.mjs';
import { validateHandoff } from '../lib/contracts/validate.mjs';
import { resetCache as resetIntentCache } from '../lib/intent-classifier.mjs';
import { orchestrationPolicy } from '../lib/mcp/tools/skills.mjs';

test('routeRequest classifies simple explanation as immediate research', () => {
  const route = routeRequest({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.equal(route.intent, INTENT_CLASSES.research);
  assert.equal(route.track, EXECUTION_TRACKS.immediate);
  assert.equal(route.workCategory, WORK_CATEGORIES.quick);
  assert.deepEqual(route.specialists, []);
});

test('routeRequest classifies feature build as orchestrated implementation', () => {
  const route = routeRequest({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  assert.equal(route.intent, INTENT_CLASSES.implementation);
  assert.equal(route.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(route.specialists.includes('cx-architect'));
  assert.ok(route.specialists.includes('cx-engineer'));
  assert.ok(route.specialists.includes('cx-reviewer'));
  assert.ok(route.specialists.includes('cx-qa'));
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
  assert.ok(route.specialists.includes('cx-architect'), 'architect owns the structure');
  assert.ok(route.specialists.includes('cx-security'), 'security challenges the credential/state model');
  assert.ok(route.specialists.includes('cx-devil-advocate'), 'devil-advocate pressure-tests the approach');
});

test('routeRequest classifies fix requests through debugger path', () => {
  const route = routeRequest({ request: 'fix the login redirect bug', fileCount: 2, moduleCount: 1 });
  assert.equal(route.intent, INTENT_CLASSES.fix);
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(route.specialists, ['cx-debugger', 'cx-engineer']);
});

test('requiresExecutiveApproval respects approval boundaries', () => {
  assert.equal(requiresExecutiveApproval({}), false);
  assert.equal(requiresExecutiveApproval({ irreversibleAction: true }), true);
  assert.equal(requiresExecutiveApproval({ productDecision: true }), true);
});

test('buildDispatchPlan returns concise policy-driven plan text', () => {
  assert.equal(buildDispatchPlan({ track: EXECUTION_TRACKS.immediate, intent: INTENT_CLASSES.research }), 'Plan: respond directly.');
  assert.equal(buildDispatchPlan({ track: EXECUTION_TRACKS.focused, intent: INTENT_CLASSES.fix, specialists: ['cx-debugger', 'cx-engineer'] }), 'Plan: cx-debugger → cx-engineer.');
  assert.match(buildDispatchPlan({ track: EXECUTION_TRACKS.orchestrated, intent: INTENT_CLASSES.implementation, specialists: ['cx-architect', 'cx-engineer', 'cx-reviewer', 'cx-qa'] }), /cx-architect/);
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
  assert.ok(result.handoffPacket, 'handoffPacket should be present for focused/orchestrated requests');
  assert.equal(result.handoffPacket.goal, 'fix the login redirect bug');
  assert.equal(result.handoffPacket.intent, INTENT_CLASSES.fix);
  const verdict = validateHandoff({
    producer: 'construct',
    consumer: 'cx-orchestrator',
    id: 'construct-to-orchestrator',
    artifact: result.handoffPacket,
    enforcement: 'block',
  });
  assert.equal(verdict.ok, true, `handoffPacket must satisfy construct-to-orchestrator: ${verdict.errors?.join('; ')}`);
});

test('buildConstructToOrchestratorPacket returns null for immediate track', () => {
  const packet = buildConstructToOrchestratorPacket({ request: 'explain how caching works', fileCount: 1, moduleCount: 1 });
  assert.equal(packet, null);
});

test('orchestrationPolicy omits draftTask for immediate requests', async () => {
  const result = await orchestrationPolicy({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.equal(result.track, EXECUTION_TRACKS.immediate);
  assert.equal(result.draftTask, null);
  assert.equal(result.handoffPacket, null);
});

test('orchestrationPolicy includes approvalRequired and terminalStates', async () => {
  const result = await orchestrationPolicy({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  assert.equal(typeof result.approvalRequired, 'boolean');
  assert.ok(Array.isArray(result.terminalStates));
  assert.ok(result.terminalStates.includes('DONE'));
});

test('orchestrationPolicy returns a lazy specialistCatalog (construct-ymp5)', async () => {
  const result = await orchestrationPolicy({ request: 'explain caching', fileCount: 1, moduleCount: 1 });
  assert.ok(Array.isArray(result.specialistCatalog));
  assert.ok(result.specialistCatalog.length >= 20);
  assert.ok(result.specialistCatalog.every((row) => row.id.startsWith('cx-') && row.whenToUse));
});

test('routeRequest dispatches cx-legal-compliance on compliance keyword (focused track)', () => {
  const route = routeRequest({ request: 'review GDPR compliance of our consent flow', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(route.specialists, ['cx-legal-compliance']);
});

test('routeRequest prepends cx-legal-compliance pre-architect on orchestrated track', () => {
  const route = routeRequest({ request: 'build the SOC 2 attestation evidence pipeline end to end', fileCount: 4, moduleCount: 2 });
  assert.equal(route.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(route.specialists.includes('cx-legal-compliance'));
  assert.ok(route.specialists.indexOf('cx-legal-compliance') < route.specialists.indexOf('cx-architect'));
});

test('routeRequest dispatches cx-business-strategist on GTM keyword (focused track)', () => {
  const route = routeRequest({ request: 'sketch the go-to-market positioning for the new tier', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(route.specialists, ['cx-business-strategist']);
});

test('routeRequest dispatches cx-operations on dependency-sequencing keyword', () => {
  const route = routeRequest({ request: 'work out the critical path through the multi-quarter plan', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(route.specialists, ['cx-operations']);
});

test('routeRequest dispatches cx-rd-lead on hypothesis keyword and prepends on orchestrated', () => {
  const focused = routeRequest({ request: 'frame the hypothesis we should be testing', fileCount: 2, moduleCount: 1 });
  assert.equal(focused.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(focused.specialists, ['cx-rd-lead']);

  const orchestrated = routeRequest({ request: 'build a falsifiable proof of concept system end to end', fileCount: 4, moduleCount: 2 });
  assert.equal(orchestrated.track, EXECUTION_TRACKS.orchestrated);
  assert.ok(orchestrated.specialists.includes('cx-rd-lead'));
  assert.ok(orchestrated.specialists.indexOf('cx-rd-lead') < orchestrated.specialists.indexOf('cx-architect'));
});

test('routeRequest dispatches cx-explorer on recon keyword (focused track)', () => {
  const route = routeRequest({ request: 'do a scoping pass on the auth module — orient me', fileCount: 1, moduleCount: 1 });
  assert.equal(route.track, EXECUTION_TRACKS.focused);
  assert.deepEqual(route.specialists, ['cx-explorer']);
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

test('proactiveTriggers fires cx-security pre-dispatch on auth + wide blast', async () => {
  const { proactiveTriggers, requestSignals } = await import('../lib/orchestration-policy.mjs');
  const signals = requestSignals('migrate all users to the new auth flow — destructive backfill');
  const triggers = proactiveTriggers(signals);
  const security = triggers.find((t) => t.specialist === 'cx-security');
  assert.ok(security, 'expected cx-security in triggers');
  assert.match(security.reason, /auth|threat|payments/i);
});

test('routeRequest surfaces dispatchSummary with reasons for proactive triggers', async () => {
  const { routeRequest } = await import('../lib/orchestration-policy.mjs');
  const route = routeRequest({
    request: 'migrate all users to the new auth flow with a destructive backfill end to end',
    fileCount: 4,
    moduleCount: 2,
  });
  assert.ok(route.dispatchSummary.startsWith('Engaging:'));
  assert.ok(route.specialists.includes('cx-security'));
  assert.match(route.dispatchReasons['cx-security'] || '', /auth|payments|threat/i);
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

test('proactiveTriggers fires cx-security pre-dispatch on auth + wide blast', async () => {
  const { proactiveTriggers, requestSignals } = await import('../lib/orchestration-policy.mjs');
  const signals = requestSignals('migrate all users to the new auth flow — destructive backfill');
  const triggers = proactiveTriggers(signals);
  const security = triggers.find((t) => t.specialist === 'cx-security');
  assert.ok(security, 'expected cx-security in triggers');
  assert.match(security.reason, /auth|threat|payments/i);
});

test('routeRequest surfaces dispatchSummary with reasons for proactive triggers', async () => {
  const { routeRequest } = await import('../lib/orchestration-policy.mjs');
  const route = routeRequest({
    request: 'migrate all users to the new auth flow with a destructive backfill end to end',
    fileCount: 4,
    moduleCount: 2,
  });
  assert.ok(route.dispatchSummary.startsWith('Engaging:'));
  assert.ok(route.specialists.includes('cx-security'));
  assert.match(route.dispatchReasons['cx-security'] || '', /auth|payments|threat/i);
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
    'cx-engineer: loaded engineer.platform overlay',
    'cx-architect: loaded architect.ai-systems overlay',
    'cx-data-analyst: loaded data-analyst.experiment overlay',
  ]);
});

test('formatOverlaySelection returns an empty list when no flavors match or input is malformed', async () => {
  const { formatOverlaySelection } = await import('../lib/orchestration-policy.mjs');
  assert.deepEqual(formatOverlaySelection(null), []);
  assert.deepEqual(formatOverlaySelection({}), []);
  assert.deepEqual(formatOverlaySelection({ engineer: null, architect: null }), []);
  assert.deepEqual(formatOverlaySelection('not-an-object'), []);
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

test('proactiveTriggers fires cx-security pre-dispatch on auth + wide blast', async () => {
  const { proactiveTriggers, requestSignals } = await import('../lib/orchestration-policy.mjs');
  const signals = requestSignals('migrate all users to the new auth flow — destructive backfill');
  const triggers = proactiveTriggers(signals);
  const security = triggers.find((t) => t.specialist === 'cx-security');
  assert.ok(security, 'expected cx-security in triggers');
  assert.match(security.reason, /auth|threat|payments/i);
});

test('routeRequest surfaces dispatchSummary with reasons for proactive triggers', async () => {
  const { routeRequest } = await import('../lib/orchestration-policy.mjs');
  const route = routeRequest({
    request: 'migrate all users to the new auth flow with a destructive backfill end to end',
    fileCount: 4,
    moduleCount: 2,
  });
  assert.ok(route.dispatchSummary.startsWith('Engaging:'));
  assert.ok(route.specialists.includes('cx-security'));
  assert.match(route.dispatchReasons['cx-security'] || '', /auth|payments|threat/i);
});
