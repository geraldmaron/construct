/**
 * tests/hosts/integrations/unsupported.test.ts — stub integration honesty.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnsupportedIntegrationAdapter } from '../../../src/hosts/integrations/unsupported.ts';
import { integrationAdapterFor } from '../../../src/hosts/integrations/registry.ts';

test('unsupported adapter refuses install and reports maturity', async () => {
  const adapter = createUnsupportedIntegrationAdapter('codex');
  assert.equal(adapter.capabilities().maturity, 'unsupported');
  const view = await adapter.inspect('/repo');
  assert.equal(view.status, 'absent');
  await assert.rejects(() => adapter.install('/repo'), /unsupported/);
  const verify = await adapter.verify('/repo');
  assert.equal(verify.ok, false);
});

test('registry: writers for cursor/claude/vscode/opencode; stubs for bob/codex', () => {
  assert.equal(integrationAdapterFor('opencode')?.capabilities().maturity, 'documented');
  assert.equal(integrationAdapterFor('vscode')?.capabilities().maturity, 'documented');
  assert.equal(integrationAdapterFor('bob')?.capabilities().maturity, 'unsupported');
  assert.equal(integrationAdapterFor('codex')?.capabilities().maturity, 'unsupported');
  assert.equal(integrationAdapterFor('nope'), null);
});
