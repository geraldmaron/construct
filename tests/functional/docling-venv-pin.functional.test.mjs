/**
 * tests/functional/docling-venv-pin.functional.test.mjs — docling venv installs
 * the exact pinned lockfile version, not whatever is newest upstream
 * (construct-tsyfe.10.3).
 *
 * Touches more than one component (a committed pyproject.toml/uv.lock pair,
 * lib/runtime/uv-bootstrap.mjs's provisioning code, and the Provider Card
 * registry's recorded expectedVersion), so per the repo's multi-component
 * rule this lives here rather than only as an in-process unit test.
 *
 * Static checks (no `uv` binary required) assert DOCLING_PIN,
 * pyproject.toml's `docling==` pin, uv.lock's resolved docling package
 * version, and the "docling" Provider Card's versionPolicy.expectedVersion
 * all agree — a drift between any of the four would mean uv-bootstrap.mjs
 * provisions a different docling than the one Construct claims to run.
 *
 * The real-`uv`-gated checks prove the lockfile is honored: `uv sync
 * --frozen --dry-run` against the committed project resolves to exactly
 * `docling==<DOCLING_PIN>`, and `uv lock --locked` confirms uv.lock is not
 * stale relative to pyproject.toml. Skipped (not failed) when `uv` is not on
 * PATH — docling provisioning already degrades gracefully without it
 * (lib/runtime/uv-bootstrap.mjs's ensureUv), so this test does too.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DOCLING_PIN, DOCLING_PROJECT_DIR } from '../../lib/runtime/uv-bootstrap.mjs';
import { loadProviderCards } from '../../lib/providers/provider-card.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PYPROJECT_PATH = join(DOCLING_PROJECT_DIR, 'pyproject.toml');
const LOCKFILE_PATH = join(DOCLING_PROJECT_DIR, 'uv.lock');

function hasUv() {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', ['uv'], { encoding: 'utf8' }).status === 0;
}

test('lib/runtime/docling-runtime/pyproject.toml pins docling== to DOCLING_PIN', () => {
  const text = readFileSync(PYPROJECT_PATH, 'utf8');
  const match = text.match(/"docling==([0-9.]+)"/);
  assert.ok(match, 'pyproject.toml must declare a docling== dependency pin');
  assert.equal(match[1], DOCLING_PIN, 'pyproject.toml\'s docling pin must match lib/runtime/uv-bootstrap.mjs\'s DOCLING_PIN');
});

test('lib/runtime/docling-runtime/uv.lock resolves docling to DOCLING_PIN', () => {
  const text = readFileSync(LOCKFILE_PATH, 'utf8');
  const packageBlock = text.match(/\[\[package\]\]\nname = "docling"\nversion = "([0-9.]+)"/);
  assert.ok(packageBlock, 'uv.lock must contain a resolved docling package entry');
  assert.equal(packageBlock[1], DOCLING_PIN, 'uv.lock\'s resolved docling version must match DOCLING_PIN');
});

test('the "docling" Provider Card records the same pin as DOCLING_PIN', () => {
  const { ok, providers, errors } = loadProviderCards();
  assert.equal(ok, true, errors.join('; '));
  const docling = providers.find((p) => p.id === 'docling');
  assert.ok(docling, 'registry/provider-cards.json must carry a "docling" card');
  assert.equal(docling.versionPolicy.type, 'external-pinned');
  assert.equal(docling.versionPolicy.expectedVersion, DOCLING_PIN);
});

test('uv sync --frozen --dry-run resolves the committed project to exactly docling==DOCLING_PIN', (t) => {
  if (!hasUv()) {
    t.skip('uv not installed on PATH — docling provisioning degrades gracefully without it (lib/runtime/uv-bootstrap.mjs)');
    return;
  }
  const venvTarget = mkdtempSync(join(tmpdir(), 'docling-venv-pin-dryrun-'));
  t.after(() => rmTmpDir(venvTarget));

  const result = spawnSync('uv', ['sync', '--project', DOCLING_PROJECT_DIR, '--frozen', '--no-install-project', '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: venvTarget },
    timeout: 60_000,
  });

  assert.equal(result.status, 0, `uv sync --frozen --dry-run must succeed against the committed lockfile: ${result.stderr || result.stdout}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, new RegExp(`docling==${DOCLING_PIN.replace(/\./g, '\\.')}`), 'the frozen sync plan must resolve docling to exactly DOCLING_PIN, not a re-resolved newer release');
});

test('uv lock --locked confirms uv.lock is not stale relative to pyproject.toml', (t) => {
  if (!hasUv()) {
    t.skip('uv not installed on PATH — docling provisioning degrades gracefully without it (lib/runtime/uv-bootstrap.mjs)');
    return;
  }
  const result = spawnSync('uv', ['lock', '--project', DOCLING_PROJECT_DIR, '--locked'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `committed uv.lock must already satisfy pyproject.toml (no re-resolve needed): ${result.stderr || result.stdout}`);
});
