/**
 * tests/providers/provider-commands.test.mjs — LMCP-B8 CLI parity tests.
 *
 * Spawns the real `bin/construct` binary against an isolated tmpdir project
 * so `provider health`, `provider status`, and `provider validate` are
 * exercised end to end: real process spawn, real exit codes, real stdout.
 * A project-scoped `.cx/providers.json` override registers the
 * always-unhealthy fixture provider (fixtures/failing-provider.mjs) so the
 * non-zero exit path is proven without touching any real built-in provider.
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(ROOT, 'bin', 'construct');
const FIXTURE_PROVIDER = join(ROOT, 'tests', 'providers', 'fixtures', 'failing-provider.mjs');

// The spawned `construct` binary resolves the machine-scoped state root
// (ADR-0066) from process.env.CX_HOME_OVERRIDE / HOME in its own process, so
// every spawn below must be pinned to a throwaway home or it leaks a
// project-key directory into the real developer machine's ~/.construct/projects/.
const HOME_DIR = mkdtempSync(join(tmpdir(), 'construct-provider-cli-home-'));
after(() => { rmSync(HOME_DIR, { recursive: true, force: true }); });

function run(args, { cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: HOME_DIR, CX_HOME_OVERRIDE: HOME_DIR, ...env },
    encoding: 'utf8',
  });
}

function withFailingProviderProject() {
  const dir = mkdtempSync(join(tmpdir(), 'construct-provider-cli-'));
  mkdirSync(join(dir, '.cx'), { recursive: true });
  writeFileSync(
    join(dir, '.cx', 'providers.json'),
    JSON.stringify({ providers: [{ id: 'fixture-failing', package: FIXTURE_PROVIDER, options: {} }] }, null, 2),
  );
  return dir;
}

test('provider health <id> exits non-zero on a failing provider', () => {
  const dir = withFailingProviderProject();
  try {
    const res = run(['provider', 'health', 'fixture-failing'], { cwd: dir });
    assert.notEqual(res.status, 0, `expected non-zero exit, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /fixture-failing/);
    assert.match(res.stdout, /unhealthy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider health <id> --json exits non-zero and reports ok:false', () => {
  const dir = withFailingProviderProject();
  try {
    const res = run(['provider', 'health', 'fixture-failing', '--json'], { cwd: dir });
    assert.notEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    const entry = parsed.results.find((r) => r.id === 'fixture-failing');
    assert.ok(entry, 'expected fixture-failing in results');
    assert.equal(entry.ok, false);
    assert.match(entry.detail, /intentionally unhealthy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider health (no id) aggregates all providers and fails if any is unhealthy', () => {
  const dir = withFailingProviderProject();
  try {
    const res = run(['provider', 'health', '--json'], { cwd: dir });
    assert.notEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.ok(parsed.results.some((r) => r.id === 'fixture-failing' && r.ok === false));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider health <unknown-id> exits non-zero with a clear error', () => {
  const res = run(['provider', 'health', 'totally-unknown-provider-id', '--json']);
  assert.notEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /unknown provider/);
});

test('provider status shows breaker and degradation columns (text)', () => {
  const res = run(['provider', 'status']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /BREAKER/);
  assert.match(res.stdout, /DEGRADED/);
});

test('provider status --json includes breaker state per provider', () => {
  const res = run(['provider', 'status', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.ok(Array.isArray(parsed.providers));
  assert.ok(parsed.providers.length > 0);
  for (const row of parsed.providers) {
    assert.ok('breaker' in row);
    assert.ok('degraded' in row);
    assert.ok('enabled' in row);
  }
});

test('provider validate <id> validates a known built-in manifest', () => {
  const res = run(['provider', 'validate', 'github', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.valid, true);
});

test('provider validate <path> reports errors for a broken manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-provider-manifest-'));
  try {
    const badManifestPath = join(dir, 'broken.manifest.json');
    writeFileSync(badManifestPath, JSON.stringify({ id: 'Not Valid!', kind: 'not-a-real-kind' }));
    const res = run(['provider', 'validate', badManifestPath, '--json']);
    assert.notEqual(res.status, 0);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.valid, false);
    assert.ok(parsed.errors.length > 0);
    assert.ok(parsed.errors.some((e) => /missing required field: version/.test(e)));
    assert.ok(parsed.errors.some((e) => /unknown kind/.test(e)));
    assert.ok(parsed.errors.some((e) => /id must match/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('provider validate <unknown-id> exits non-zero', () => {
  const res = run(['provider', 'validate', 'totally-unknown-provider-id', '--json']);
  assert.notEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.valid, false);
  assert.match(parsed.errors[0], /no manifest found/);
});
