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
  buildDispatchPlan,
  requiresExecutiveApproval,
  routeRequest,
} from '../lib/orchestration-policy.mjs';
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

test('orchestrationPolicy includes draftTask for non-immediate requests', () => {
  const result = orchestrationPolicy({ request: 'fix the login redirect bug', fileCount: 2, moduleCount: 1 });
  assert.ok(result.draftTask, 'draftTask should be present for focused/orchestrated requests');
  assert.equal(result.draftTask.status, 'todo');
  assert.ok(result.draftTask.owner, 'draftTask should have an owner');
  assert.ok(result.draftTask.phase, 'draftTask should have a phase');
  assert.ok(Array.isArray(result.draftTask.acceptanceCriteria), 'draftTask should have acceptanceCriteria array');
  assert.equal(result.draftTask.source.intent, INTENT_CLASSES.fix);
  assert.equal(result.draftTask.source.track, EXECUTION_TRACKS.focused);
});

test('orchestrationPolicy omits draftTask for immediate requests', () => {
  const result = orchestrationPolicy({ request: 'explain how the caching layer works', fileCount: 1, moduleCount: 1 });
  assert.equal(result.track, EXECUTION_TRACKS.immediate);
  assert.equal(result.draftTask, null);
});

test('orchestrationPolicy includes approvalRequired and terminalStates', () => {
  const result = orchestrationPolicy({ request: 'build this feature end to end and ship it', fileCount: 4, moduleCount: 2 });
  assert.equal(typeof result.approvalRequired, 'boolean');
  assert.ok(Array.isArray(result.terminalStates));
  assert.ok(result.terminalStates.includes('DONE'));
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
