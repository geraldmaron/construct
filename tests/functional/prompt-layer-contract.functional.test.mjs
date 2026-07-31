/**
 * tests/functional/prompt-layer-contract.functional.test.mjs —
 * lib/prompt-layer-contract.mjs vs. lib/prompt-composer.mjs's real fragment
 * assembly.
 *
 * Drives the real composePrompt() against the repo's own prompt/role/registry
 * files (rootDir = repo root, matching tests/prompt-composer.test.mjs's
 * convention) and checks the resulting fragment sequence against
 * PROMPT_LAYER_ORDER from lib/prompt-layer-model.mjs, including a
 * token-constrained ('small' model profile) request that exercises
 * pruneFragments' budget-drop path, the live path an assembly-order
 * regression can hide in undetected (fragments.indexOf() against a spread
 * copy always returns -1, collapsing pruned output to priority-sort order
 * instead of declared assembly order unless pruneFragments carries its own
 * index tiebreaker).
 * A second block proves validateFragmentOrder() itself is a real tripwire:
 * a synthetic, deliberately reordered fragment-type sequence must fail it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { composePrompt } from '../../lib/prompt-composer.mjs';
import {
  PRIORITY,
  PROMPT_LAYER_ORDER,
  PROMPT_LAYER_CONTRACT,
  mergeRoleFlavorOverrides,
  validateFragmentOrder,
} from '../../lib/prompt-layer-contract.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('composePrompt() assembles a full-layer request in declared PROMPT_LAYER_ORDER', () => {
  const result = composePrompt('engineer', {
    rootDir: root,
    intent: 'implementation',
    workCategory: 'deep',
    task: { title: 'Formalize the prompt-layer precedence contract' },
    roleFlavors: { platformEngineer: 'core' },
    contextState: {
      source: 'test',
      contextSummary: 'Formalizing fragment order and priority as a validated contract.',
      activeWork: ['prompt-layer-contract'],
    },
    hostConstraints: { runtime: 'mcp' },
  });

  const types = result.fragments.map((f) => f.type);
  assert.ok(types.length >= 4, `expected several fragment types, got ${types.join(', ')}`);
  assert.deepEqual(validateFragmentOrder(types), { ok: true, reason: null });
});

test('composePrompt() preserves declared order under token-constrained pruning', () => {
  const result = composePrompt('engineer', {
    rootDir: root,
    intent: 'implementation',
    workCategory: 'deep',
    task: { title: 'Formalize the prompt-layer precedence contract' },
    roleFlavors: { platformEngineer: 'core' },
    contextState: {
      source: 'test',
      contextSummary: 'Formalizing fragment order and priority as a validated contract.',
      activeWork: ['prompt-layer-contract'],
    },
    hostConstraints: { runtime: 'mcp' },
    executionContractModel: {
      profile: { id: 'small' },
      selectedModel: 'ollama/llama3.1:8b',
    },
  });

  const types = result.fragments.map((f) => f.type);
  assert.ok(types.includes('core'), 'core must survive pruning (priority 1)');
  const check = validateFragmentOrder(types);
  assert.equal(check.ok, true, check.reason || '');
});

test('validateFragmentOrder() rejects a fragment sequence reordered relative to PROMPT_LAYER_CONTRACT', () => {
  const inOrder = ['core', 'role-flavor', 'task-packet', 'context-digest', 'host-constraints'];
  assert.deepEqual(validateFragmentOrder(inOrder), { ok: true, reason: null });

  const reordered = ['core', 'task-packet', 'role-flavor', 'context-digest', 'host-constraints'];
  const result = validateFragmentOrder(reordered);
  assert.equal(result.ok, false);
  assert.match(result.reason, /role-flavor.*appears after.*task-packet/);
});

test('validateFragmentOrder() rejects a fragment type absent from PROMPT_LAYER_ORDER', () => {
  const result = validateFragmentOrder(['core', 'made-up-layer']);
  assert.equal(result.ok, false);
  assert.match(result.reason, /made-up-layer.*not declared/);
});

test('explicit roleFlavors override workspaceType-derived defaults end to end', () => {
  const withoutOverride = composePrompt('product-manager', {
    rootDir: root,
    intent: 'implementation',
    workspaceType: 'platform',
  });
  const autoSelected = withoutOverride.fragments.find((f) => f.type === 'role-flavor');
  assert.match(autoSelected.label, /product-manager\.platform/);

  const withOverride = composePrompt('product-manager', {
    rootDir: root,
    intent: 'implementation',
    workspaceType: 'platform',
    roleFlavors: { productManager: 'growth' },
  });
  const explicit = withOverride.fragments.find((f) => f.type === 'role-flavor');
  assert.match(explicit.label, /product-manager\.growth/, 'explicit roleFlavors must win over workspaceType default');
});

test('mergeRoleFlavorOverrides() prefers the explicit key over a conflicting workspace default', () => {
  const merged = mergeRoleFlavorOverrides(
    { architect: 'ai-systems' },
    { architect: 'platform', productManager: 'platform' },
  );
  assert.equal(merged.architect, 'ai-systems');
  assert.equal(merged.productManager, 'platform');
});

test('PROMPT_LAYER_CONTRACT declares every PROMPT_LAYER_ORDER layer exactly once, with a valid priority', () => {
  assert.equal(PROMPT_LAYER_CONTRACT.length, PROMPT_LAYER_ORDER.length);
  const layers = PROMPT_LAYER_CONTRACT.map((r) => r.layer);
  assert.deepEqual(layers, PROMPT_LAYER_ORDER);
  for (const record of PROMPT_LAYER_CONTRACT) {
    assert.equal(record.priority, PRIORITY[record.layer]);
    assert.ok(Number.isInteger(record.priority) && record.priority >= 1 && record.priority <= 5);
  }
});

test('host-constraints carries non-empty, documented mayOverride and neverOverride sets', () => {
  const hostConstraints = PROMPT_LAYER_CONTRACT.find((r) => r.layer === 'host-constraints');
  assert.ok(hostConstraints);
  assert.ok(hostConstraints.mayOverride.length > 0, 'mayOverride must not be an empty placeholder array');
  assert.ok(hostConstraints.neverOverride.length > 0, 'neverOverride must not be an empty placeholder array');
  assert.ok(hostConstraints.neverOverride.includes('core'));
  assert.ok(hostConstraints.neverOverride.includes('task-packet'));
});

test('task-packet may override learned-patterns; learned-patterns may never override task-packet or core', () => {
  const taskPacket = PROMPT_LAYER_CONTRACT.find((r) => r.layer === 'task-packet');
  const learnedPatterns = PROMPT_LAYER_CONTRACT.find((r) => r.layer === 'learned-patterns');
  assert.ok(taskPacket.mayOverride.includes('learned-patterns'));
  assert.ok(learnedPatterns.neverOverride.includes('task-packet'));
  assert.ok(learnedPatterns.neverOverride.includes('core'));
});

test('lib/prompt-composer.mjs imports PRIORITY from prompt-layer-contract.mjs', () => {
  const composerSrc = fs.readFileSync(path.join(root, 'lib', 'prompt-composer.mjs'), 'utf8');
  assert.doesNotMatch(composerSrc, /const PRIORITY = \{/, 'PRIORITY must be imported from prompt-layer-contract.mjs, not redeclared');
  assert.match(composerSrc, /from '\.\/prompt-layer-contract\.mjs'/);

  const contractSrc = fs.readFileSync(path.join(root, 'lib', 'prompt-layer-contract.mjs'), 'utf8');
  assert.match(contractSrc, /PRIORITY = Object\.freeze\(\{/, 'contract module must declare the literal PRIORITY map');
});
