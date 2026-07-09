/**
 * tests/packs/lifecycle.test.mjs — LMCP-E3 pack enable/disable lifecycle.
 *
 * Pins: the durable enable/disable round trip persists to .cx/packs.json and
 * is reflected by isEnabled/loadEnabledPacks (which gates prompt/framework
 * resolution for callers that opt into it — see enablement.mjs header);
 * an incompatible compatVersion refuses enable with the exact validation
 * error rather than half-enabling; the core pack is always enabled and
 * cannot be disabled; and `construct pack list|enable|disable|info` work
 * end-to-end against the real binary.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

import {
  readEnablementState, writeEnablementState, isEnabled,
  enablePack, disablePack, loadEnabledPacks, isCorePackId,
} from '../../lib/packs/enablement.mjs';
import { loadCorePack } from '../../lib/packs/core-pack.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(PACKAGE_ROOT, 'bin', 'construct');
const CORE_ID = loadCorePack(PACKAGE_ROOT).id;

const tmpDirs = [];
function freshRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-pack-lifecycle-'));
  tmpDirs.push(dir);
  return dir;
}

// The spawned `construct pack` binary resolves the machine-scoped state root
// (ADR-0066) from process.env.CX_HOME_OVERRIDE / HOME in its own process, so
// every spawn below must be pinned to a throwaway home or it leaks a project-key
// directory into the real developer machine's ~/.construct/projects/.
const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-pack-lifecycle-home-'));
tmpDirs.push(HOME_DIR);

after(() => {
  for (const dir of tmpDirs) {
    rmTmpDir(dir);
  }
});

function writeProjectPack(rootDir, dirName, manifest) {
  const packDir = path.join(rootDir, '.cx', 'packs', dirName);
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

test('readEnablementState defaults to empty when no .cx/packs.json exists', () => {
  const root = freshRoot();
  const state = readEnablementState(root);
  assert.deepEqual(state, { version: 1, enabled: {} });
});

test('the core pack is always enabled and cannot be disabled', () => {
  const root = freshRoot();
  const state = readEnablementState(root);
  assert.equal(isEnabled(CORE_ID, state, { packageRoot: PACKAGE_ROOT }), true);
  assert.equal(isCorePackId(CORE_ID, PACKAGE_ROOT), true);

  const result = disablePack(CORE_ID, { rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.equal(result.ok, false);
  assert.match(result.error, /core pack/);
});

test('enable/disable round-trips durably in .cx/packs.json', () => {
  const root = freshRoot();
  writeProjectPack(root, 'sample-pack', { id: '@fixture/sample', version: '1.0.0', compatVersion: 1 });

  const enableResult = enablePack('@fixture/sample', { rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.equal(enableResult.ok, true);
  assert.equal(enableResult.tier, 'project');

  const onDiskAfterEnable = JSON.parse(fs.readFileSync(path.join(root, '.cx', 'packs.json'), 'utf8'));
  assert.ok(onDiskAfterEnable.enabled['@fixture/sample']);
  assert.equal(onDiskAfterEnable.enabled['@fixture/sample'].version, '1.0.0');

  const stateAfterEnable = readEnablementState(root);
  assert.equal(isEnabled('@fixture/sample', stateAfterEnable, { packageRoot: PACKAGE_ROOT }), true);

  const disableResult = disablePack('@fixture/sample', { rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.equal(disableResult.ok, true);
  assert.equal(disableResult.wasEnabled, true);

  const stateAfterDisable = readEnablementState(root);
  assert.equal(isEnabled('@fixture/sample', stateAfterDisable, { packageRoot: PACKAGE_ROOT }), false);
});

test('disabling a pack that was never enabled is a no-op that still returns ok', () => {
  const root = freshRoot();
  const result = disablePack('@fixture/never-enabled', { rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.equal(result.ok, true);
  assert.equal(result.wasEnabled, false);
});

test('an incompatible compatVersion refuses enable with a clear error naming the field', () => {
  const root = freshRoot();
  writeProjectPack(root, 'bad-pack', { id: '@fixture/incompatible', version: '1.0.0', compatVersion: 99 });

  const result = enablePack('@fixture/incompatible', { rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.equal(result.ok, false);
  assert.match(result.error, /compatVersion 99 exceeds supported version/);

  const state = readEnablementState(root);
  assert.equal(isEnabled('@fixture/incompatible', state, { packageRoot: PACKAGE_ROOT }), false, 'a refused pack must not become enabled');
});

test('enabling an unknown pack id fails with a clear not-found error', () => {
  const root = freshRoot();
  const result = enablePack('@fixture/does-not-exist', { rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
});

test('enabling a specific requested version that mismatches the on-disk manifest fails', () => {
  const root = freshRoot();
  writeProjectPack(root, 'sample-pack', { id: '@fixture/sample', version: '1.0.0', compatVersion: 1 });
  const result = enablePack('@fixture/sample', { rootDir: root, packageRoot: PACKAGE_ROOT, requestedVersion: '2.0.0' });
  assert.equal(result.ok, false);
  assert.match(result.error, /requested 2\.0\.0/);
});

test('loadEnabledPacks filters loadAllPacks to core + explicitly enabled packs', () => {
  const root = freshRoot();
  writeProjectPack(root, 'sample-pack', { id: '@fixture/sample', version: '1.0.0', compatVersion: 1 });

  const beforeEnable = loadEnabledPacks({ rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.ok(beforeEnable.packs.some((p) => p.id === CORE_ID));
  assert.ok(!beforeEnable.packs.some((p) => p.id === '@fixture/sample'), 'an unenabled but discovered pack must not be returned');

  enablePack('@fixture/sample', { rootDir: root, packageRoot: PACKAGE_ROOT });

  const afterEnable = loadEnabledPacks({ rootDir: root, packageRoot: PACKAGE_ROOT });
  assert.ok(afterEnable.packs.some((p) => p.id === '@fixture/sample'), 'an enabled pack must be returned');
});

function run(args, { cwd }) {
  return spawnSync('node', [BIN, 'pack', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: HOME_DIR, CX_HOME_OVERRIDE: HOME_DIR },
  });
}

test('construct pack list|enable|disable|info work end-to-end against the real binary', () => {
  const cwd = freshRoot();
  writeProjectPack(cwd, 'sample-pack', { id: '@fixture/sample', version: '1.0.0', compatVersion: 1 });

  const listBefore = run(['list', '--json'], { cwd });
  assert.equal(listBefore.status, 0, listBefore.stderr);
  const before = JSON.parse(listBefore.stdout);
  const sampleBefore = before.packs.find((p) => p.id === '@fixture/sample');
  assert.ok(sampleBefore);
  assert.equal(sampleBefore.enabled, false);

  const enable = run(['enable', '@fixture/sample', '--json'], { cwd });
  assert.equal(enable.status, 0, enable.stderr);
  assert.equal(JSON.parse(enable.stdout).ok, true);

  const info = run(['info', '@fixture/sample', '--json'], { cwd });
  assert.equal(info.status, 0, info.stderr);
  assert.equal(JSON.parse(info.stdout).enabled, true);

  const disable = run(['disable', '@fixture/sample', '--json'], { cwd });
  assert.equal(disable.status, 0, disable.stderr);
  assert.equal(JSON.parse(disable.stdout).ok, true);

  const listAfter = run(['list', '--json'], { cwd });
  const after_ = JSON.parse(listAfter.stdout);
  assert.equal(after_.packs.find((p) => p.id === '@fixture/sample').enabled, false);
});

test('construct pack enable refuses an incompatible pack end-to-end', () => {
  const cwd = freshRoot();
  writeProjectPack(cwd, 'bad-pack', { id: '@fixture/incompatible', version: '1.0.0', compatVersion: 99 });

  const enable = run(['enable', '@fixture/incompatible', '--json'], { cwd });
  assert.equal(enable.status, 1);
  const parsed = JSON.parse(enable.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /compatVersion 99 exceeds supported version/);
});
