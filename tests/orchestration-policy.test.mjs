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
