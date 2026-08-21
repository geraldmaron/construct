/**
 * tests/hosts/family.test.ts — family identity is read off the adapter that
 * declares it, never guessed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf } from '../../src/hosts/family.ts';
import type { HostAdapter, HostResult } from '../../src/kernel/hosts/interface.ts';

function stubHost(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    name: 'stub',
    kind: 'general',
    capabilities: [],
    init: async () => {},
    invoke: async (): Promise<HostResult> => ({ id: 'x', status: 'ok', output: {}, error: null }),
    health: async () => ({ live: true }),
    cancel: async () => ({ cancelled: false }),
    ...overrides,
  };
}

test('a host that declares a tuned family reports it', () => {
  const host = stubHost({ model: 'claude-sonnet-5', modelTuning: () => ({ family: 'claude', tuned: true }) });
  assert.equal(familyOf(host), 'claude');
});

test('a host that will not say reports null, not a guess', () => {
  const host = stubHost();
  assert.equal(familyOf(host), null);
});

test('a host whose modelTuning answers null for this model reports null', () => {
  const host = stubHost({ model: 'unknown-model', modelTuning: () => null });
  assert.equal(familyOf(host), null);
});
