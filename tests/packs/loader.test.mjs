/**
 * tests/packs/loader.test.mjs — pack loader unit tests.
 */

import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadPacksFromDir, mergePackTiers, resolvePackDirs, loadAllPacks } from '../../lib/packs/loader.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..', '..');

test('loadPacksFromDir', async (t) => {
  await t.test('non-existent dir returns empty packs with no errors', () => {
    const result = loadPacksFromDir('/tmp/non-existent-packs-dir');
    assert.deepEqual(result.packs, []);
    assert.deepEqual(result.errors, []);
  });
});

test('mergePackTiers', async (t) => {
  const builtin = [{ id: 'pack-a', version: '1.0.0', name: 'builtin-a' }];
  const user = [{ id: 'pack-a', version: '2.0.0', name: 'user-a' }];
  const project = [{ id: 'pack-a', version: '3.0.0', name: 'project-a' }];

  await t.test('project takes precedence over user and builtin', () => {
    const merged = mergePackTiers(builtin, user, project);
    const packA = merged.find(p => p.id === 'pack-a');
    assert.equal(packA.name, 'project-a');
    assert.equal(packA.version, '3.0.0');
  });

  await t.test('user takes precedence over builtin', () => {
    const merged = mergePackTiers(builtin, user, []);
    const packA = merged.find(p => p.id === 'pack-a');
    assert.equal(packA.name, 'user-a');
    assert.equal(packA.version, '2.0.0');
  });

  await t.test('deduplicates by id across tiers', () => {
    const merged = mergePackTiers(builtin, user, project);
    const matches = merged.filter(p => p.id === 'pack-a');
    assert.equal(matches.length, 1);
  });

  await t.test('packs from different tiers with different ids are all kept', () => {
    const b = [{ id: 'pack-b', version: '1.0.0' }];
    const u = [{ id: 'pack-u', version: '1.0.0' }];
    const p = [{ id: 'pack-p', version: '1.0.0' }];
    const merged = mergePackTiers(b, u, p);
    assert.equal(merged.length, 3);
  });
});

test('resolvePackDirs', async (t) => {
  await t.test('returns object with builtin, user, project keys', () => {
    const dirs = resolvePackDirs({ rootDir: '/tmp', homeDir: '/home/user' });
    assert.ok(dirs.builtin.includes('lib/packs/manifests'));
    assert.ok(dirs.user.includes('.config/construct/packs'));
    assert.ok(dirs.project.includes('.construct/packs'));
  });
});

test('loadAllPacks', async (t) => {
  await t.test('includes core pack in result', () => {
    const result = loadAllPacks();
    const core = result.packs.find(p => p.id === '@construct/core');
    assert.ok(core, 'core pack should be present');
    assert.equal(core._tier, 'builtin');
  });

  await t.test('packs and errors arrays are returned', () => {
    const result = loadAllPacks();
    assert.ok(Array.isArray(result.packs));
    assert.ok(Array.isArray(result.errors));
  });

  await t.test('core pack embedBindings validate cleanly against real extension manifests (LMCP-E4)', () => {
    const result = loadAllPacks();
    const core = result.packs.find(p => p.id === '@construct/core');
    assert.ok(core.embedBindings, 'core pack should carry embedBindings');
    assert.ok(Object.keys(core.embedBindings).length > 0);
    assert.ok(!result.errors.some(e => e.includes('embedBindings')), `expected no embedBindings errors, got: ${JSON.stringify(result.errors)}`);
  });
});

test('loadPacksFromDir embedBindings validation (LMCP-E4)', async (t) => {
  function makeTmpPacksDir(manifestBody) {
    const base = mkdtempSync(join(tmpdir(), 'construct-pack-embed-'));
    const packDir = join(base, 'test-pack');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'pack.manifest.json'), JSON.stringify(manifestBody, null, 2));
    return base;
  }

  await t.test('unknown provider id fails pack validation with a path', () => {
    const dir = makeTmpPacksDir({
      id: 'test-pack',
      version: '1.0.0',
      compatVersion: 1,
      embedBindings: {
        'cx-operations': { providers: [{ id: 'not-a-real-provider', capabilities: ['read'] }] },
      },
    });
    try {
      const result = loadPacksFromDir(dir, { packageRoot: PACKAGE_ROOT });
      assert.equal(result.packs.length, 0);
      assert.ok(result.errors.some(e => e.includes('embedBindings.cx-operations.providers[0].id') && e.includes('not-a-real-provider')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('undeclared capability fails pack validation with a path', () => {
    const dir = makeTmpPacksDir({
      id: 'test-pack',
      version: '1.0.0',
      compatVersion: 1,
      embedBindings: {
        // github manifest does not declare "write".
        'cx-engineer': { providers: [{ id: 'github', capabilities: ['write'] }] },
      },
    });
    try {
      const result = loadPacksFromDir(dir, { packageRoot: PACKAGE_ROOT });
      assert.equal(result.packs.length, 0);
      assert.ok(result.errors.some(e => e.includes('embedBindings.cx-engineer.providers[0].capabilities[0]')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('valid embedBindings against a real provider passes', () => {
    const dir = makeTmpPacksDir({
      id: 'test-pack',
      version: '1.0.0',
      compatVersion: 1,
      embedBindings: {
        'cx-engineer': { providers: [{ id: 'github', capabilities: ['read', 'search'] }], proposals: ['github.createIssue'] },
      },
    });
    try {
      const result = loadPacksFromDir(dir, { packageRoot: PACKAGE_ROOT });
      assert.equal(result.errors.length, 0);
      assert.equal(result.packs.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});