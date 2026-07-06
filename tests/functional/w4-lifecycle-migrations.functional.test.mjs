/**
 * tests/functional/w4-lifecycle-migrations.functional.test.mjs —
 *
 * Exercises the schema migration runtime: planning, dry-run, applied writes,
 * compatibility checks (older / newer), and the CLI `construct migrate` path.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_SCHEMA_VERSION,
  planMigrations,
  runMigrations,
  checkCompatibility,
} from '../../lib/migrations/index.mjs';
import { compareSemver, parseSemver, getInstalledVersion } from '../../lib/version.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freshTmp() {
  const root = mkdtempSync(join(tmpdir(), 'construct-migrate-'));
  return {
    root,
    cleanup() { try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ } },
  };
}

test('CURRENT_SCHEMA_VERSION is exactly 2 at this release', () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 2);
});

test('planMigrations from v0 to current returns two steps; v2→v2 returns empty', () => {
  const v0ToCurrent = planMigrations(0);
  assert.equal(Array.isArray(v0ToCurrent) && v0ToCurrent.length, 2);
  assert.equal(v0ToCurrent[0].from, 0);
  assert.equal(v0ToCurrent[0].to, 1);
  assert.equal(v0ToCurrent[1].from, 1);
  assert.equal(v0ToCurrent[1].to, 2);

  const noop = planMigrations(2);
  assert.deepEqual(noop, []);
});

test('planMigrations refuses a downgrade path', () => {
  const result = planMigrations(2, 1);
  assert.equal(result, null);
});

test('checkCompatibility surfaces needsMigration when artifact is older', () => {
  const result = checkCompatibility(0);
  assert.equal(result.compatible, false);
  assert.equal(result.needsMigration, true);
});

test('checkCompatibility surfaces needsUpgrade when artifact is newer', () => {
  const result = checkCompatibility(99);
  assert.equal(result.compatible, false);
  assert.equal(result.needsUpgrade, true);
});

test('checkCompatibility is happy when versions match', () => {
  assert.deepEqual(checkCompatibility(2), { compatible: true });
});

test('runMigrations dry-run reports changes without writing', async () => {
  const { root, cleanup } = freshTmp();
  try {
    const artifact = join(root, 'config.json');
    writeFileSync(artifact, JSON.stringify({ alias: 'demo' }));
    const result = await runMigrations({ artifactPath: artifact, fromVersion: 0, dryRun: true });
    assert.equal(result.ok, true);
    assert.equal(result.applied.length, 2);
    assert.equal(result.applied[0].changed, true);
    // dry-run must not write
    const onDisk = JSON.parse(readFileSync(artifact, 'utf8'));
    assert.equal(onDisk.version, undefined);
  } finally { cleanup(); }
});

test('runMigrations write-mode stamps version: 2', async () => {
  const { root, cleanup } = freshTmp();
  try {
    const artifact = join(root, 'config.json');
    writeFileSync(artifact, JSON.stringify({ alias: 'demo' }));
    const result = await runMigrations({ artifactPath: artifact, fromVersion: 0 });
    assert.equal(result.ok, true);
    const onDisk = JSON.parse(readFileSync(artifact, 'utf8'));
    assert.equal(onDisk.version, 2);
    assert.equal(onDisk.alias, 'demo');
  } finally { cleanup(); }
});

test('runMigrations is idempotent — running twice does not double-stamp', async () => {
  const { root, cleanup } = freshTmp();
  try {
    const artifact = join(root, 'config.json');
    writeFileSync(artifact, JSON.stringify({ alias: 'demo' }));
    await runMigrations({ artifactPath: artifact, fromVersion: 0 });
    const result = await runMigrations({ artifactPath: artifact, fromVersion: CURRENT_SCHEMA_VERSION });
    assert.equal(result.ok, true);
    assert.deepEqual(result.applied, []);
  } finally { cleanup(); }
});

test('construct --version matches package.json', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'construct-version-home-'));
  try {
    const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'construct'), '--version'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOME: tmpHome, CX_HOME_OVERRIDE: tmpHome },
    });
    assert.equal(result.status, 0);
    const { version } = getInstalledVersion();
    assert.match(result.stdout, new RegExp(version.replace(/\./g, '\\.')));
  } finally {
    rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('construct migrate --dry-run runs end-to-end against a fixture cwd', () => {
  const { root, cleanup } = freshTmp();
  try {
    const cxDir = join(root, '.cx');
    mkdirSync(cxDir, { recursive: true });
    writeFileSync(join(cxDir, 'config.json'), JSON.stringify({ alias: 'demo' }));

    const result = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'construct'), 'migrate', '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOME: root },
    });

    assert.equal(result.status, 0, `expected exit 0; stderr: ${result.stderr}`);
    assert.match(result.stdout, /step\(s\)|already at/, `expected migrate report; stdout: ${result.stdout}`);
    // dry-run must not write
    const onDisk = JSON.parse(readFileSync(join(cxDir, 'config.json'), 'utf8'));
    assert.equal(onDisk.version, undefined);
  } finally { cleanup(); }
});

test('parseSemver + compareSemver behave correctly', () => {
  assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.equal(compareSemver('1.0.6', '1.0.7'), -1);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
  assert.equal(compareSemver('1.0.6', '1.0.6'), 0);
});
