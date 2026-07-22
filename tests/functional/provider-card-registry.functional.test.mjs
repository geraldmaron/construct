/**
 * tests/functional/provider-card-registry.functional.test.mjs — Provider Card
 * registry validation end-to-end (construct-4uxq0.13.7).
 *
 * Touches more than one component (schema + registry data + CLI script
 * surface), so per the repo's multi-component rule this lives here rather
 * than only in tests/provider-card-schema.test.mjs. Spawns the real
 * scripts/validate-provider-cards.mjs against durable artifacts in an
 * isolated tmpdir:
 *   1. The full real migrated set (registry/provider-cards.json, generated
 *      by scripts/migrate-provider-cards.mjs from deps/intent.json's
 *      npm-dep/npm-optional entries plus the docling/whisper ingestion-
 *      provider manifests) must validate with exit code 0.
 *   2. An injected malformed card (missing a required field) must make the
 *      same script exit non-zero and name the missing field on stderr —
 *      the "construct doctor (or equivalent) surfaces a validation failure"
 *      acceptance criterion, satisfied by this CLI surface.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { validateProviderCardRegistry } from '../../lib/providers/provider-card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-provider-cards.mjs');
const REAL_REGISTRY = join(ROOT, 'registry', 'provider-cards.json');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'provider-card-registry-'));
  return { root, cleanup: () => rmTmpDir(root) };
}

function runValidator(registryPath, cwd) {
  return spawnSync(process.execPath, [SCRIPT, '--path', registryPath], {
    cwd,
    env: sterileSpawnEnv(),
    encoding: 'utf8',
  });
}

test('the real migrated Provider Card set validates in-process against the schema', () => {
  const doc = JSON.parse(readFileSync(REAL_REGISTRY, 'utf8'));
  const result = validateProviderCardRegistry(doc);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.ok(result.count >= 19, `expected at least the 17 npm-dep/npm-optional entries plus docling+whisper, got ${result.count}`);
  assert.ok(doc.providers.some((p) => p.id === 'docling' && p.kind === 'sidecar'));
  assert.ok(doc.providers.some((p) => p.id === 'whisper' && p.kind === 'sidecar'));
});

test('scripts/validate-provider-cards.mjs exits 0 against the real migrated registry, spawned fresh', (t) => {
  const { root, cleanup } = sandbox();
  t.after(cleanup);
  const copyPath = join(root, 'provider-cards.json');
  copyFileSync(REAL_REGISTRY, copyPath);

  const result = runValidator(copyPath, root);
  assert.equal(result.status, 0, `stderr: ${result.stderr}\nstdout: ${result.stdout}`);
  assert.match(result.stdout, /\[ok\] All \d+ Provider Card\(s\)/);
});

test('scripts/validate-provider-cards.mjs exits non-zero and names the missing field for a malformed card', (t) => {
  const { root, cleanup } = sandbox();
  t.after(cleanup);
  const badPath = join(root, 'broken-provider-cards.json');
  writeFileSync(badPath, JSON.stringify({
    version: 1,
    providers: [
      {
        id: 'injected-broken-provider',
        kind: 'npm-dep',
        versionPolicy: { type: 'npm-semver', range: '^1.0.0' },
        healthCheck: { kind: 'import-check', detail: "require('injected-broken-provider')" },
        fallback: { behavior: 'error' },
        // owner intentionally omitted — required by schemas/provider-card.schema.json
        removalCriteria: 'unknown',
      },
    ],
  }, null, 2));

  const result = runValidator(badPath, root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /injected-broken-provider/);
  assert.match(result.stderr, /missing required field: owner/);
});

test('scripts/validate-provider-cards.mjs exits non-zero when the registry file is missing', (t) => {
  const { root, cleanup } = sandbox();
  t.after(cleanup);
  const missingPath = join(root, 'does-not-exist.json');

  const result = runValidator(missingPath, root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not found/);
});
