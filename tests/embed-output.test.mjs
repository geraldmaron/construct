/**
 * tests/embed-output.test.mjs — dispatchOutputs() slack target contract
 * (lib/embed/output.mjs).
 *
 * A registered slack provider that does not implement write() must surface
 * as a structured `{status:'error'}` result naming the real cause, not an
 * opaque "provider.write is not a function" TypeError from calling it
 * directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchOutputs } from '../lib/embed/output.mjs';

function registryWith(provider) {
  return { get: () => provider };
}

describe('dispatchOutputs — slack target', () => {
  it('reports a structured error when the registered provider has no write()', async () => {
    const registry = registryWith({});
    const results = await dispatchOutputs(
      { generatedAt: new Date().toISOString(), summary: 'x', errors: [], sections: [] },
      [{ type: 'slack', channel: '#general' }],
      registry,
      null,
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].type, 'slack');
    assert.equal(results[0].status, 'error');
    assert.match(results[0].error, /does not implement write/);
  });

  it('reports a structured error when the provider is not registered at all', async () => {
    const registry = registryWith(null);
    const results = await dispatchOutputs(
      { generatedAt: new Date().toISOString(), summary: 'x', errors: [], sections: [] },
      [{ type: 'slack', channel: '#general' }],
      registry,
      null,
    );
    assert.equal(results[0].status, 'error');
    assert.match(results[0].error, /not registered/);
  });

  it('posts through a provider that does implement write()', async () => {
    const calls = [];
    const provider = { write: async (payload) => { calls.push(payload); } };
    const registry = registryWith(provider);
    const results = await dispatchOutputs(
      { generatedAt: new Date().toISOString(), summary: 'x', errors: [], sections: [] },
      [{ type: 'slack', channel: '#general' }],
      registry,
      null,
    );
    assert.equal(results[0].status, 'ok');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].channel, '#general');
  });
});
