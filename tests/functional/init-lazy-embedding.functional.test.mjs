/**
 * tests/functional/init-lazy-embedding.functional.test.mjs
 *
 * construct-rf26.17: a fresh `construct init` must perform zero embedding
 * work — no ONNX/transformers model cache populated, no LanceDB vector
 * index directory created — since a project that never runs semantic
 * search should never pay for either. Spawns the real `construct init`
 * against an isolated HOME/CX_HOME_OVERRIDE (sterileSpawnEnv) so the
 * assertions read the same machine-scoped roots ADR-0066 resolves at
 * runtime, never the developer machine's real ~/.construct or ~/.cache.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'init-lazy-embed-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, HOME, project, cleanup() { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

function runInit(env) {
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: env.project });
  spawnSync('git', ['config', 'user.email', 'lazy-embed@example.com'], { cwd: env.project });
  spawnSync('git', ['config', 'user.name', 'Lazy Embed Test'], { cwd: env.project });
  return spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start'],
    {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 120_000,
      env: sterileSpawnEnv({
        HOME: env.HOME,
        USERPROFILE: env.HOME,
        CX_HOME_OVERRIDE: env.HOME,
        XDG_CONFIG_HOME: join(env.HOME, '.config'),
        XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
        XDG_CACHE_HOME: join(env.HOME, '.cache'),
        XDG_RUNTIME_DIR: join(env.HOME, 'run'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
      }),
    },
  );
}

test('construct init performs zero embedding work: no model cache, no vector index', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  const result = runInit(env);
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

  // No ONNX/transformers model cache populated under the isolated cache dir —
  // proves embedText/embedBatch was never reached (embeddings-local.mjs's
  // getExtractor() is the only writer of this directory).
  const embeddingsCacheDir = join(env.HOME, '.cache', 'construct', 'embeddings');
  assert.equal(existsSync(embeddingsCacheDir), false, 'no embedding model cache dir should exist after a fresh init');

  // No LanceDB vector index directory anywhere under the isolated machine
  // state root — proves VectorClient._getDb() was never reached. Walk every
  // per-project state dir rather than deriving the exact project key so the
  // assertion holds regardless of how the key is derived.
  const projectsRoot = join(env.HOME, '.construct', 'projects');
  if (existsSync(projectsRoot)) {
    const { readdirSync } = await import('node:fs');
    for (const key of readdirSync(projectsRoot)) {
      const lancedbDir = join(projectsRoot, key, 'lancedb');
      assert.equal(existsSync(lancedbDir), false, `no lancedb/ dir should exist under projects/${key} after a fresh init`);
    }
  }
});

test('construct init with --seed-index still opts into vector-index seeding (regression guard for the opt-in flag)', async (t) => {
  const env = sandbox();
  t.after(env.cleanup);

  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: env.project });
  spawnSync('git', ['config', 'user.email', 'lazy-embed@example.com'], { cwd: env.project });
  spawnSync('git', ['config', 'user.name', 'Lazy Embed Test'], { cwd: env.project });
  const result = spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start', '--seed-index'],
    {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 120_000,
      env: sterileSpawnEnv({
        HOME: env.HOME,
        USERPROFILE: env.HOME,
        CX_HOME_OVERRIDE: env.HOME,
        XDG_CONFIG_HOME: join(env.HOME, '.config'),
        XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
        XDG_CACHE_HOME: join(env.HOME, '.cache'),
        XDG_RUNTIME_DIR: join(env.HOME, 'run'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_EMBEDDING_MODEL: 'hashing',
      }),
    },
  );
  assert.equal(result.status, 0, `init --seed-index exited ${result.status}: ${result.stderr}`);

  const projectsRoot = join(env.HOME, '.construct', 'projects');
  assert.ok(existsSync(projectsRoot), '--seed-index opts back into machine-scoped state creation');
  const { readdirSync } = await import('node:fs');
  const keys = readdirSync(projectsRoot);
  assert.equal(keys.length, 1, 'exactly one project key resolves for this sandboxed repo');
  assert.ok(existsSync(join(projectsRoot, keys[0], 'lancedb')), '--seed-index provisions the vector index eagerly, as requested');
});

test('construct init with --seed-index and the default (local ONNX) embedding model populates the model cache dir', async (t) => {
  // Proves the cache-dir assertion in the first test is not vacuous: the
  // same getExtractor() code path that a fresh init must never reach does
  // create <cache>/embeddings the moment it is (opt-in) exercised, even
  // though there is no cached model here and the call ultimately degrades
  // to the hashing fallback.
  const env = sandbox();
  t.after(env.cleanup);

  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: env.project });
  spawnSync('git', ['config', 'user.email', 'lazy-embed@example.com'], { cwd: env.project });
  spawnSync('git', ['config', 'user.name', 'Lazy Embed Test'], { cwd: env.project });
  const result = spawnSync(
    process.execPath,
    [BIN, 'init', '--yes', '--no-start', '--seed-index'],
    {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 120_000,
      env: sterileSpawnEnv({
        HOME: env.HOME,
        USERPROFILE: env.HOME,
        CX_HOME_OVERRIDE: env.HOME,
        XDG_CONFIG_HOME: join(env.HOME, '.config'),
        XDG_DATA_HOME: join(env.HOME, '.local', 'share'),
        XDG_CACHE_HOME: join(env.HOME, '.cache'),
        XDG_RUNTIME_DIR: join(env.HOME, 'run'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
      }),
    },
  );
  assert.equal(result.status, 0, `init --seed-index exited ${result.status}: ${result.stderr}`);
  assert.equal(existsSync(join(env.HOME, '.cache', 'construct', 'embeddings')), true, '--seed-index with the default model reaches getExtractor() and populates the cache dir');
});
