/**
 * tests/kernel/execution/precedence.test.ts — execution precedence contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExecutor } from '../../../src/kernel/execution/precedence.ts';

test('interactive session wins over headless default and never selects resources', () => {
  let selected = false;
  const resolved = resolveExecutor({
    interactiveSession: { client: 'cursor', host: 'unknown' },
    headlessDefault: 'claude',
    headlessResourceSelection: () => {
      selected = true;
      return 'opencode';
    },
  });
  assert.deepEqual(resolved, {
    executor: 'cursor',
    source: 'active-interactive-session',
    interactive: true,
  });
  assert.equal(selected, false);
});

test('explicit request override outranks session and run pin', () => {
  const resolved = resolveExecutor({
    requestOverride: 'claude',
    runPin: 'codex',
    interactiveSession: { client: 'cursor' },
  });
  assert.equal(resolved.executor, 'claude');
  assert.equal(resolved.source, 'request-override');
  assert.equal(resolved.interactive, true);
});

test('headless resource selection only when no interactive session', () => {
  const resolved = resolveExecutor({
    headlessResourceSelection: () => 'opencode',
  });
  assert.deepEqual(resolved, {
    executor: 'opencode',
    source: 'headless-resource-selection',
    interactive: false,
  });
});
