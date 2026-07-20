/**
 * tests/functional/graph-incremental-update.functional.test.mjs —
 * construct-4uxq0.11.9 multi-component proof: incremental graph refresh on
 * edit, hook wiring, and store merge behavior.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO_ROOT, 'bin', 'construct');
const HOOK = path.join(REPO_ROOT, 'lib', 'hooks', 'graph-impact-advisory.mjs');

const { sqliteAvailable } = await import('../../lib/graph/relational/sqlite-db.mjs');

if (!sqliteAvailable()) {
  test('graph incremental update skipped — node:sqlite unavailable (Node <22.5)', () => {
    assert.equal(sqliteAvailable(), false);
  });
} else {
  const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-inc-fn-home-'));
  const PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-inc-fn-project-'));
  const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  const prevHome = process.env.HOME;
  process.env.CONSTRUCT_HOME_OVERRIDE = SANDBOX_HOME;
  process.env.HOME = SANDBOX_HOME;

  test.after(() => {
    if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
    else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmTmpDir(SANDBOX_HOME);
    rmTmpDir(PROJECT);
  });

  const { updateGraphForFiles } = await import('../../lib/graph/incremental.mjs');
  const { loadGraph } = await import('../../lib/graph/store.mjs');

  function runConstruct(args) {
    return spawnSync(process.execPath, [BIN, ...args], {
      cwd: PROJECT,
      env: { ...process.env, HOME: SANDBOX_HOME, CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  test('construct graph build seeds baseline graph', () => {
    const result = runConstruct(['graph', 'build', '--no-co-change', '--json']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.ok);
    assert.ok(payload.nodeCount > 0);
  });

  test('import-graph edit refreshes import slice without touching registry slice', () => {
    const before = loadGraph(PROJECT);
    const beforeRegistry = before.edges.filter((e) => (e.sources || []).includes('registry') || e.source === 'registry');

    const update = updateGraphForFiles(PROJECT, ['lib/graph/cli.mjs'], { rootDir: REPO_ROOT, coChange: false });
    assert.equal(update.ok, true);
    assert.ok(update.importSlice);
    assert.ok(update.events > 0, 'incremental update should enqueue graph deltas');

    const after = loadGraph(PROJECT);
    const afterRegistry = after.edges.filter((e) => (e.sources || []).includes('registry') || e.source === 'registry');
    assert.deepEqual(afterRegistry, beforeRegistry, 'registry edges should be unchanged');
  });

  test('graph-impact-advisory hook runs incremental refresh on lib edit', () => {
    runConstruct(['graph', 'build', '--no-co-change']);
    const rel = 'lib/graph/incremental.mjs';
    const hook = spawnSync(process.execPath, [HOOK], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: SANDBOX_HOME,
        CONSTRUCT_HOME_OVERRIDE: SANDBOX_HOME,
        CONSTRUCT_PROJECT_ROOT: PROJECT,
        CLAUDE_PROJECT_DIR: PROJECT,
        TOOL_INPUT_FILE_PATH: rel,
      },
      encoding: 'utf8',
    });
    assert.equal(hook.status, 0, hook.stderr || hook.stdout);
  });
}
