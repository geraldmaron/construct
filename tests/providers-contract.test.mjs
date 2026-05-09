/**
 * tests/providers-contract.test.mjs — provider contract + registry tests.
 *
 * Verifies:
 *   - assertProviderContract enforces every required field and capability.
 *   - The registry resolves the five built-in providers.
 *   - Plugin overrides from .cx/providers.json load and validate.
 *   - A plugin that misses a required method fails contract assertion and
 *     is reported in errors[] without breaking the rest of the resolution.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { assertProviderContract, checkProviderContract, CAPABILITIES } from '../lib/providers/contract.mjs';
import { resolveProviders } from '../lib/providers/registry.mjs';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-providers-'));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('assertProviderContract', () => {
  it('rejects null / non-object inputs', () => {
    assert.throws(() => assertProviderContract(null));
    assert.throws(() => assertProviderContract(42));
  });

  it('requires meta with id, displayName, and capabilities', () => {
    assert.throws(() => assertProviderContract({}));
    assert.throws(() => assertProviderContract({ meta: {} }));
    assert.throws(() => assertProviderContract({ meta: { id: 'x' } }));
    assert.throws(() => assertProviderContract({
      meta: { id: 'x', displayName: 'X' },
    }));
  });

  it('rejects unknown capabilities', () => {
    assert.throws(() => assertProviderContract({
      meta: { id: 'x', displayName: 'X', capabilities: ['not-a-capability'] },
      health: () => ({ ok: true }),
    }));
  });

  it('requires the matching method for each declared capability', () => {
    assert.throws(() => assertProviderContract({
      meta: { id: 'x', displayName: 'X', capabilities: ['read'] },
      health: () => ({ ok: true }),
    }));
  });

  it('accepts a minimal happy-path provider', () => {
    assertProviderContract({
      meta: { id: 'x', displayName: 'X', capabilities: ['search'] },
      health: () => ({ ok: true }),
      search: () => [],
    });
  });

  it('exposes the canonical capability set', () => {
    assert.deepEqual(
      [...CAPABILITIES].sort(),
      ['read', 'search', 'watch', 'webhook', 'write']
    );
  });

  it('checkProviderContract returns ok=false with errors instead of throwing', () => {
    const r = checkProviderContract({});
    assert.equal(r.ok, false);
    assert.ok(r.errors[0]);
  });
});

describe('provider registry', () => {
  it('loads all five built-in providers', async () => {
    const { providers, errors } = await resolveProviders({ rootDir: tmpRoot });
    assert.deepEqual(errors, []);
    for (const id of ['github', 'atlassian-jira', 'atlassian-confluence', 'slack', 'salesforce']) {
      assert.ok(providers[id], `expected built-in ${id}`);
      assertProviderContract(providers[id]);
    }
  });

  it('loads a plugin override from .cx/providers.json', async () => {
    const cxDir = path.join(tmpRoot, '.cx');
    fs.mkdirSync(cxDir, { recursive: true });
    const pluginPath = path.join(tmpRoot, 'fake-provider.mjs');
    fs.writeFileSync(pluginPath, `
      export function create() {
        return {
          meta: { id: 'fake', displayName: 'Fake', capabilities: ['search'] },
          health: () => ({ ok: true, detail: 'fake-ok' }),
          search: () => [{ id: 1 }, { id: 2 }],
        };
      }
    `);
    fs.writeFileSync(
      path.join(cxDir, 'providers.json'),
      JSON.stringify({ providers: [{ id: 'fake', package: pluginPath }] })
    );
    const { providers, errors, sources } = await resolveProviders({ rootDir: tmpRoot });
    assert.deepEqual(errors, []);
    assert.ok(providers['fake']);
    const items = await providers['fake'].search({});
    assert.equal(items.length, 2);
    assert.match(sources['fake'], /^plugin:/);
  });

  it('captures a broken plugin in errors[] without breaking other providers', async () => {
    const cxDir = path.join(tmpRoot, '.cx');
    fs.mkdirSync(cxDir, { recursive: true });
    const brokenPath = path.join(tmpRoot, 'broken-provider.mjs');
    fs.writeFileSync(brokenPath, `
      export function create() {
        return {
          meta: { id: 'broken', displayName: 'Broken', capabilities: ['read'] },
          // missing required 'health' AND missing 'read'
        };
      }
    `);
    fs.writeFileSync(
      path.join(cxDir, 'providers.json'),
      JSON.stringify({ providers: [{ id: 'broken', package: brokenPath }] })
    );
    const { providers, errors } = await resolveProviders({ rootDir: tmpRoot });
    assert.ok(!providers['broken']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].id, 'broken');
    assert.match(errors[0].error, /missing|required/);
    // Built-ins are still loaded
    assert.ok(providers['github']);
  });
});
