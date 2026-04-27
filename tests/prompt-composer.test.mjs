/**
 * tests/prompt-composer.test.mjs — composePrompt assembly and role anti-pattern inlining tests
 *
 * Tests lib/prompt-composer.mjs which assembles the final prompt from a core prompt file,
 * task packet, and context digest. Verifies inlineRoleAntiPatterns expands role directives
 * from skills/roles/ and that composePrompt is a no-op when directives are absent.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { composePrompt, resolveBasePrompt, resolvePromptContract, resolveRuntimePromptMetadata } from '../lib/prompt-composer.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('composePrompt assembles prompt from core prompt, task packet, and context digest', () => {
  const result = composePrompt('cx-engineer', {
    rootDir: root,
    intent: 'implementation',
    workCategory: 'deep',
    task: {
      title: 'Implement policy engine',
      owner: 'cx-engineer',
      acceptanceCriteria: ['tests pass', 'policy is code-backed'],
      readFirst: ['lib/orchestration-policy.mjs'],
      doNotChange: ['agents/registry.json'],
    },
    contextState: {
      source: 'test',
      contextSummary: 'Work is focused on replacing prompt routing with code-backed policy.',
      activeWork: ['policy engine'],
      recentDecisions: ['routing moves into code'],
    },
  });

  assert.equal(result.metadata.promptName, 'engineer');
  assert.ok(result.fragments.some((fragment) => fragment.type === 'core'));
  assert.ok(result.fragments.some((fragment) => fragment.type === 'task-packet'));
  assert.ok(result.fragments.some((fragment) => fragment.type === 'context-digest'));
  assert.match(result.prompt, /Implement policy engine/);
  assert.match(result.prompt, /routing moves into code/);
});

test('composePrompt returns empty prompt for unknown agent', () => {
  const result = composePrompt('cx-not-real', { rootDir: root });
  assert.equal(result.prompt, '');
  assert.deepEqual(result.fragments, []);
});

test('resolveBasePrompt uses prompt composition for promptFile-backed entries', () => {
  const prompt = resolveBasePrompt({ name: 'engineer', promptFile: 'agents/prompts/cx-engineer.md' }, { rootDir: root });
  assert.match(prompt, /You read before you write/);
});

test('resolveBasePrompt prefers inline prompt when present', () => {
  const prompt = resolveBasePrompt({ name: 'engineer', prompt: 'inline prompt wins' }, { rootDir: root });
  assert.equal(prompt, 'inline prompt wins');
});

test('resolveBasePrompt resolves persona prompt files by direct entry', () => {
  const prompt = resolveBasePrompt({ name: 'construct', promptFile: 'personas/construct.md' }, { rootDir: root });
  assert.match(prompt, /You are Construct/);
});

test('resolveBasePrompt normalizes cx-prefixed names through composed resolution', () => {
  const prompt = resolveBasePrompt('cx-engineer', { rootDir: root });
  assert.match(prompt, /You read before you write/);
});

test('resolveBasePrompt returns fallback for unresolved prompt sources', () => {
  const prompt = resolveBasePrompt({ name: 'missing', promptFile: 'agents/prompts/nope.md' }, {
    rootDir: root,
    fallback: 'fallback prompt',
  });
  assert.equal(prompt, 'fallback prompt');
});

test('resolvePromptContract returns prompt text and runtime-aligned prompt metadata', () => {
  const result = resolvePromptContract('cx-engineer', { rootDir: root });

  assert.match(result.prompt, /You read before you write/);
  assert.equal(result.metadata.promptName, 'engineer');
  assert.equal(result.metadata.promptFile, 'agents/prompts/cx-engineer.md');
  assert.equal(result.metadata.promptVersion, result.metadata.promptHash.slice(0, 12));
});

test('composePrompt injects dynamic role-flavor overlay when roleFlavors are provided', () => {
  const result = composePrompt('cx-architect', {
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
  const result = composePrompt('cx-engineer', {
    rootDir: root,
    intent: 'implementation',
    roleFlavors: { architect: 'ai-systems' },
  });

  const flavorFragment = result.fragments.find((f) => f.type === 'role-flavor');
  assert.equal(flavorFragment, undefined, 'engineer should not get architect flavor');
});

test('resolveRuntimePromptMetadata includes explicit task packet and routing summary', () => {
  const metadata = resolveRuntimePromptMetadata('cx-engineer', {
    rootDir: root,
    task: {
      key: 'runtime-policy-contract',
      title: 'Implement code-backed orchestration policy and routing contract',
      owner: 'cx-architect',
      phase: 'implement',
      status: 'in-progress',
      acceptanceCriteria: ['Critical orchestration rules exist in code'],
      readFirst: ['lib/orchestration-policy.mjs'],
      doNotChange: ['agents/registry.json'],
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
      specialists: ['cx-architect', 'cx-debugger', 'cx-engineer', 'cx-reviewer', 'cx-qa'],
      dispatchPlan: 'Plan: cx-architect → cx-debugger → cx-engineer → cx-reviewer + cx-qa.',
    },
    hostConstraints: { runtime: 'mcp' },
  });

  assert.equal(metadata.taskPacketKey, 'runtime-policy-contract');
  assert.equal(metadata.taskPacketOwner, 'cx-architect');
  assert.equal(metadata.taskPacketPhase, 'implement');
  assert.equal(metadata.routeIntent, 'fix');
  assert.equal(metadata.routeTrack, 'orchestrated');
  assert.ok(Array.isArray(metadata.routeSpecialists));
  assert.ok(metadata.routeSpecialists.includes('cx-architect'));
  assert.ok(metadata.routeSpecialists.includes('cx-debugger'));
  assert.ok(metadata.promptHasTaskPacket);
  assert.ok(metadata.promptHasContextDigest);
  assert.ok(metadata.promptHasHostConstraints);
  assert.equal(metadata.composedPromptVersion.length, 12);
});
