/**
 * tests/bootstrap-resources.test.mjs — resource registry contract tests.
 *
 * Verifies:
 *   - registerResource validates required fields and rejects duplicates.
 *   - probeResource returns a deterministic shape, even when detect() throws.
 *   - probeAll sorts required resources first.
 *   - registerBuiltInResources is idempotent.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import {
  registerResource,
  listResources,
  getResource,
  clearResourceRegistry,
  probeResource,
  probeAll,
  formatProbe,
} from '../lib/bootstrap/resources.mjs';
import { registerBuiltInResources } from '../lib/bootstrap/built-ins.mjs';

beforeEach(() => {
  clearResourceRegistry();
});

describe('resource registry', () => {
  it('registerResource requires id, displayName, detect, consentKey', () => {
    assert.throws(() => registerResource({}));
    assert.throws(() => registerResource({ id: 'x' }));
    assert.throws(() => registerResource({ id: 'x', displayName: 'X' }));
    assert.throws(() => registerResource({
      id: 'x', displayName: 'X', detect: () => ({ present: true }),
    }));
  });

  it('registerResource rejects duplicates', () => {
    registerResource({
      id: 'dup', displayName: 'Dup', consentKey: 'BS_DUP', detect: () => ({ present: true }),
    });
    assert.throws(() => registerResource({
      id: 'dup', displayName: 'Dup2', consentKey: 'BS_DUP', detect: () => ({ present: true }),
    }));
  });

  it('listResources returns the registered set', () => {
    registerResource({ id: 'a', displayName: 'A', consentKey: 'BS_A', detect: () => ({ present: true }) });
    registerResource({ id: 'b', displayName: 'B', consentKey: 'BS_B', detect: () => ({ present: false }) });
    assert.deepEqual(listResources().map((r) => r.id).sort(), ['a', 'b']);
  });

  it('probeResource returns deterministic shape on success', async () => {
    registerResource({
      id: 'happy', displayName: 'Happy', consentKey: 'BS_H',
      detect: async () => ({ present: true, version: '1.0', healthy: true }),
      fallback: () => 'no fallback',
      install: async () => ({ success: true }),
    });
    const r = await probeResource(getResource('happy'));
    assert.equal(r.id, 'happy');
    assert.equal(r.present, true);
    assert.equal(r.version, '1.0');
    assert.equal(r.healthy, true);
    assert.equal(r.installable, true);
    assert.equal(r.fallback, 'no fallback');
  });

  it('probeResource captures detect() throws as { present: false, error }', async () => {
    registerResource({
      id: 'crash', displayName: 'Crash', consentKey: 'BS_C',
      detect: async () => { throw new Error('boom'); },
    });
    const r = await probeResource(getResource('crash'));
    assert.equal(r.present, false);
    assert.match(r.error, /boom/);
  });

  it('probeAll sorts required resources first then by id', async () => {
    registerResource({
      id: 'optional-z', displayName: 'Z', consentKey: 'BS_Z',
      required: false, detect: () => ({ present: true }),
    });
    registerResource({
      id: 'required-b', displayName: 'B', consentKey: 'BS_B',
      required: true, detect: () => ({ present: true }),
    });
    registerResource({
      id: 'optional-a', displayName: 'A', consentKey: 'BS_A',
      required: false, detect: () => ({ present: false }),
    });
    const all = await probeAll();
    assert.deepEqual(all.map((r) => r.id), ['required-b', 'optional-a', 'optional-z']);
  });

  it('formatProbe renders a status, version, and fallback hint', async () => {
    registerResource({
      id: 'ok', displayName: 'OK Tool', consentKey: 'BS_OK',
      detect: () => ({ present: true, version: '2.1' }),
    });
    const p = await probeResource(getResource('ok'));
    const line = formatProbe(p);
    assert.match(line, /OK Tool/);
    assert.match(line, /2\.1/);
  });
});

describe('built-in resources', () => {
  it('registerBuiltInResources adds the canonical set', () => {
    registerBuiltInResources();
    const ids = listResources().map((r) => r.id);
    for (const id of ['node-runtime', 'git', 'docker', 'embedding-model-local', 'postgres-pgvector']) {
      assert.ok(ids.includes(id), `expected ${id} registered`);
    }
  });

  it('registerBuiltInResources is idempotent', () => {
    registerBuiltInResources();
    const first = listResources().length;
    registerBuiltInResources();
    assert.equal(listResources().length, first);
  });
});
