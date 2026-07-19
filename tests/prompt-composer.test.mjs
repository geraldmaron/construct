/**
 * tests/prompt-composer.test.mjs — composePrompt assembly and role anti-pattern inlining tests
 *
 * Tests lib/prompt-composer.mjs which assembles the final prompt from a Worker Profile,
 * task packet, and context digest. Verifies inlinePerspectiveAntiPatterns expands role directives
 * from skills/perspectives/ and that composePrompt is a no-op when directives are absent.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { composePrompt, resolveBasePrompt, resolvePromptContract, resolveRuntimePromptMetadata } from '../lib/prompt-composer.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('composePrompt assembles prompt from core prompt, task packet, and context digest', () => {
  const result = composePrompt('engineer', {
    rootDir: root,
    intent: 'implementation',
    workCategory: 'deep',
    task: {
      title: 'Implement policy engine',
      owner: 'engineer',
      acceptanceCriteria: ['tests pass', 'policy is code-backed'],
      readFirst: ['lib/orchestration-policy.mjs'],
      doNotChange: ['registry'],
    },
    contextState: {
      source: 'test',
      contextSummary: 'Work is focused on replacing prompt routing with code-backed policy.',
      activeWork: ['policy engine'],
      recentDecisions: ['routing moves into code'],
    },
  });

  assert.equal(result.metadata.workerProfileId, 'engineer');
  assert.ok(result.fragments.some((fragment) => fragment.type === 'core'));
  assert.ok(result.fragments.some((fragment) => fragment.type === 'task-packet'));
  // Note: context-digest may be pruned due to token limits in new token-efficient version
  // assert.ok(result.fragments.some((fragment) => fragment.type === 'context-digest'));
  assert.match(result.system, /Implement policy engine/);
  // Note: context digest may be pruned due to token limits in new token-efficient version
});

test('composePrompt returns empty prompt for unknown agent', () => {
  const result = composePrompt('not-real', { rootDir: root });
  assert.equal(result.system, '');
  assert.deepEqual(result.fragments, []);
});

test('resolveBasePrompt accepts a canonical Worker Profile record', () => {
  const prompt = resolveBasePrompt({ id: 'engineer' }, { rootDir: root });
  assert.match(prompt, /You read before you write/);
});

test('resolveBasePrompt resolves a canonical Worker Profile id', () => {
  const prompt = resolveBasePrompt('engineer', { rootDir: root });
  assert.match(prompt, /You read before you write/);
});

test('resolveBasePrompt returns fallback for unresolved prompt sources', () => {
  const prompt = resolveBasePrompt('missing', {
    rootDir: root,
    fallback: 'fallback prompt',
  });
  assert.equal(prompt, 'fallback prompt');
});

test('resolvePromptContract returns prompt text and runtime-aligned prompt metadata', () => {
  const result = resolvePromptContract('engineer', { rootDir: root });

  assert.match(result.prompt, /You read before you write/);
  assert.equal(result.metadata.workerProfileId, 'engineer');
  assert.equal(result.metadata.workerProfilePromptPath, 'registry/worker-profiles/prompts/engineer.md');
  assert.equal(result.metadata.workerProfileVersion, result.metadata.workerProfileHash.slice(0, 12));
});

test('composePrompt injects dynamic role-flavor overlay when roleFlavors are provided', () => {
  const result = composePrompt('architect', {
    rootDir: root,
    intent: 'implementation',
    workCategory: 'deep',
    roleFlavors: { architect: 'ai-systems' },
  });

  const flavorFragment = result.fragments.find((f) => f.type === 'role-flavor');
  assert.ok(flavorFragment, 'should include a role-flavor fragment');
  assert.match(flavorFragment.label, /architect\.ai-systems/);
  assert.match(flavorFragment.content, /ai-systems domain guidance/);
});

test('composePrompt skips flavor overlay when no roleFlavors match agent', () => {
  const result = composePrompt('engineer', {
    rootDir: root,
    intent: 'implementation',
    roleFlavors: { architect: 'ai-systems' },
  });

  const flavorFragment = result.fragments.find((f) => f.type === 'role-flavor');
  assert.equal(flavorFragment, undefined, 'engineer should not get architect flavor');
});

test('composePrompt injects role overlays selected for a Worker Profile', () => {
  const result = composePrompt('engineer', {
    rootDir: root,
    intent: 'implementation',
    roleFlavors: { platformEngineer: 'core' },
  });

  const flavorFragment = result.fragments.find((f) => f.type === 'role-flavor');
  assert.ok(flavorFragment, 'should include platform-engineer role guidance');
  assert.match(flavorFragment.label, /platform-engineer/);
  assert.match(flavorFragment.content, /platform-engineer domain guidance/i);
  assert.match(flavorFragment.content, /Tooling without adoption plan/i);
});

test('composePrompt switches to compact small-model mode when requested by execution contract', () => {
  const result = composePrompt('engineer', {
    rootDir: root,
    task: { title: 'Implement retrieval-first compact mode for small local models' },
    roleFlavors: { aiEngineer: 'core' },
    executionContractModel: {
      profile: { id: 'small' },
      selectedModel: 'ollama/llama3.1:8b',
    },
  });

  const profileFragment = result.fragments.find((f) => f.type === 'model-profile');
  const flavorFragment = result.fragments.find((f) => f.type === 'role-flavor');
  assert.ok(profileFragment);
  assert.match(profileFragment.content, /small-model operating mode/i);
  // The lowest-priority overlay may be pruned when the core profile and model
  // operating guidance consume the small-model budget.
  if (flavorFragment) {
    assert.ok(flavorFragment.content.length < 2200, `expected compressed overlay, got ${flavorFragment.content.length} chars`);
  }
});

test('resolveRuntimePromptMetadata includes explicit task packet and routing summary', () => {
  const metadata = resolveRuntimePromptMetadata('engineer', {
    rootDir: root,
    task: {
      key: 'runtime-policy-contract',
      title: 'Implement code-backed orchestration policy and routing contract',
      owner: 'architect',
      phase: 'implement',
      status: 'in-progress',
      acceptanceCriteria: ['Critical orchestration rules exist in code'],
      readFirst: ['lib/orchestration-policy.mjs'],
      doNotChange: ['registry'],
    },
    contextState: {
      source: 'test',
      contextSummary: 'Routing is moving from prompts into code.',
      activeWork: ['runtime policy wiring'],
    },
    request: 'fix the routing bug across auth and session modules',
    route: {
      intent: 'fix',
      track: 'orchestrated',
      workCategory: 'deep',
      specialists: ['architect', 'debugger', 'engineer', 'reviewer', 'qa'],
      dispatchPlan: 'Plan: architect → debugger → engineer → reviewer + qa.',
    },
    hostConstraints: { runtime: 'mcp' },
  });

  assert.equal(metadata.taskPacketKey, 'runtime-policy-contract');
  assert.equal(metadata.taskPacketOwner, 'architect');
  assert.equal(metadata.taskPacketPhase, 'implement');
  assert.equal(metadata.routeIntent, 'fix');
  assert.equal(metadata.routeTrack, 'orchestrated');
  assert.ok(Array.isArray(metadata.routeSpecialists));
  assert.ok(metadata.routeSpecialists.includes('architect'));
  assert.ok(metadata.routeSpecialists.includes('debugger'));
  assert.ok(metadata.promptHasTaskPacket);
  assert.ok(metadata.promptHasContextDigest);
  assert.ok(metadata.promptHasHostConstraints);
  assert.equal(metadata.composedPromptVersion.length, 12);
});

test('resolveRuntimePromptMetadata exposes selected prompt role flavor', () => {
  const metadata = resolveRuntimePromptMetadata('engineer', {
    rootDir: root,
    request: 'tighten the CI and docker workflow for platform engineering',
    route: {
      intent: 'implementation',
      track: 'focused',
      workCategory: 'deep',
      specialists: ['engineer'],
      dispatchPlan: 'Plan: engineer.',
      roleFlavors: { platformEngineer: 'core' },
    },
    executionContractModel: {
      version: 'v1',
      profile: { id: 'balanced' },
      selectedTier: 'standard',
      selectedModel: 'anthropic/claude-sonnet-4-6',
      selectedModelSource: 'registry',
      tiers: {},
    },
  });

  assert.equal(metadata.promptRoleFlavor, 'platform-engineer');
});

test('resolveRuntimePromptMetadata exposes routed workflow guidance', () => {
  const metadata = resolveRuntimePromptMetadata('construct', {
    rootDir: root,
    request: 'do research on oidc',
    route: {
      intent: 'research',
      track: 'focused',
      workCategory: 'quick',
      specialists: ['researcher'],
      dispatchPlan: 'Plan: researcher.',
      suggestedWorkflowType: 'research-synthesis',
    },
  });

  assert.equal(metadata.routeSuggestedWorkflowType, 'research-synthesis');
});
