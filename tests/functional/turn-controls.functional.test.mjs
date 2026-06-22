/**
 * tests/functional/turn-controls.functional.test.mjs — the live control-wiring seam
 * (construct-rv2x).
 *
 * The owned loop now derives its per-turn streamText controls — step cap, output
 * cap, caching eligibility, and the tool-group / schema budget — from the compiled
 * execution policy instead of a hardcoded maxSteps and the full tool set. This
 * proves the seam across the real modules (capability profile -> execution policy
 * -> turn controls -> tool budget -> degraded telemetry):
 *   - hosted-direct stays behavior-preserving: 16 steps, no output cap, full tools.
 *   - turn intent drives the step cap (code-change adds iterations).
 *   - an operator CX_CHAT_MAX_STEPS override wins over the policy.
 *   - a degraded / non-hosted class enforces a tighter envelope (fewer steps, a
 *     trimmed tool set with no shell, a bounded output cap).
 *   - the degraded telemetry sink records and bounds events.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTurnControls } from '../../apps/chat/engine/turn-controls.mjs';
import { applyToolBudget } from '../../lib/mcp/tool-budget.mjs';
import {
  recordPolicyTelemetry, recentPolicyTelemetry, clearPolicyTelemetry,
} from '../../lib/chat/policy-telemetry.mjs';

const AGENT_TOOLS = { read: {}, glob: {}, grep: {}, write: {}, edit: {}, shell: {}, construct_tool: {} };

const HOSTED_DIRECT = ['anthropic/claude-opus-4-6', 'openai/gpt-5.1', 'github-copilot/gpt-5.5'];

function budgetFor(controls) {
  return applyToolBudget(AGENT_TOOLS, {
    allowedToolGroups: controls.allowedToolGroups,
    maxToolSchemas: controls.maxToolSchemas,
  });
}

test('hosted-direct stays behavior-preserving: 16 steps, no output cap, full tools', () => {
  for (const model of HOSTED_DIRECT) {
    const controls = resolveTurnControls({ model });
    assert.equal(controls.policy.source.capabilityClass, 'hosted-direct', `${model}: not hosted-direct`);
    assert.equal(controls.degraded, false, `${model}: unexpectedly degraded`);
    assert.equal(controls.iterations, 16, `${model}: step cap drifted`);
    assert.equal(controls.outputCap, null, `${model}: output capped`);
    assert.deepEqual(Object.keys(budgetFor(controls)), Object.keys(AGENT_TOOLS), `${model}: tool set trimmed`);
  }
});

test('only the cache-capable provider is caching-eligible', () => {
  assert.equal(resolveTurnControls({ model: 'anthropic/claude-opus-4-6' }).cacheEligible, true);
  assert.equal(resolveTurnControls({ model: 'openai/gpt-5.1' }).cacheEligible, false);
});

test('turn intent drives the step cap on hosted-direct', () => {
  const general = resolveTurnControls({ model: 'anthropic/claude-opus-4-6' });
  const codeChange = resolveTurnControls({ model: 'anthropic/claude-opus-4-6', turnOverlay: { intent: 'implementation' } });
  assert.equal(general.iterations, 16);
  assert.equal(codeChange.iterations, 20);
  assert.equal(codeChange.outputCap, null, 'code-change must not cap hosted-direct output');
});

test('an operator CX_CHAT_MAX_STEPS override wins over the policy step cap', () => {
  const controls = resolveTurnControls({ model: 'anthropic/claude-opus-4-6', env: { CX_CHAT_MAX_STEPS: '5' } });
  assert.equal(controls.iterations, 5);
});

test('a degraded / non-hosted class enforces a tighter envelope', () => {
  for (const model of ['ollama/llama3.1:8b', 'mystery/x']) {
    const controls = resolveTurnControls({ model });
    assert.equal(controls.degraded, true, `${model}: expected degraded`);
    assert.ok(controls.iterations < 16, `${model}: step cap not tightened`);
    assert.ok(controls.outputCap > 0, `${model}: output not bounded`);
    assert.ok(!controls.allowedToolGroups.includes('shell'), `${model}: shell not dropped`);
    const tools = budgetFor(controls);
    assert.ok(!('shell' in tools) && !('edit' in tools), `${model}: edit/shell survived the budget`);
    assert.ok('read' in tools && 'construct_tool' in tools, `${model}: core tools dropped`);
  }
});

test('a routed class enforces its own budget distinct from the constrained floor', () => {
  const controls = resolveTurnControls({ model: 'openrouter/qwen/qwen3-coder:free' });
  assert.equal(controls.policy.source.capabilityClass, 'hosted-routed');
  assert.ok(controls.outputCap > 0);
  assert.ok(!controls.allowedToolGroups.includes('shell'));
});

test('the degraded telemetry sink records and bounds events', () => {
  clearPolicyTelemetry();
  const entry = recordPolicyTelemetry({ kind: 'execution-policy-degraded', model: 'mystery/x', capabilityClass: 'unknown', reasons: ['capability-class-unknown'] });
  assert.equal(entry.capabilityClass, 'unknown');
  assert.deepEqual(recentPolicyTelemetry().at(-1).reasons, ['capability-class-unknown']);
  for (let i = 0; i < 60; i += 1) recordPolicyTelemetry({ model: `m${i}` });
  assert.ok(recentPolicyTelemetry().length <= 50, 'telemetry buffer not bounded');
  clearPolicyTelemetry();
  assert.equal(recentPolicyTelemetry().length, 0);
});
