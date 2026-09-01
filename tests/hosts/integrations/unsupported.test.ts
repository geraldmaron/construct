/**
 * tests/hosts/integrations/unsupported.test.ts — stub integration honesty.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnsupportedIntegrationAdapter } from '../../../src/hosts/integrations/unsupported.ts';
import { integrationAdapterFor } from '../../../src/hosts/integrations/registry.ts';

test('unsupported adapter refuses install and reports maturity', async () => {
  const adapter = createUnsupportedIntegrationAdapter('opencode');
  assert.equal(adapter.capabilities().maturity, 'unsupported');
  const view = await adapter.inspect('/repo');
  assert.equal(view.status, 'absent');
  await assert.rejects(() => adapter.install('/repo'), /unsupported/);
  const verify = await adapter.verify('/repo');
  assert.equal(verify.ok, false);
});

test('registry returns stubs for unwired clients; vscode has a writer', () => {
  assert.equal(integrationAdapterFor('opencode')?.id, 'opencode');
  assert.equal(integrationAdapterFor('bob')?.id, 'bob');
  assert.equal(integrationAdapterFor('codex')?.id, 'codex');
  assert.equal(integrationAdapterFor('vscode')?.capabilities().maturity, 'documented');
  assert.equal(integrationAdapterFor('nope'), null);
});
