/**
 * tests/functional/ingest-strategy.functional.test.mjs — end-to-end ingest strategy.
 *
 * Spawns the real `bin/construct ingest` binary against a markdown fixture in an
 * isolated tmpdir and asserts the run metadata reflects the selected strategy.
 * The adapter run is the byte-for-byte default path; the provider run with
 * fallback=adapter records the resolved provider/model and the fallback that
 * carried the extraction (never silently dropping the strategy). A provider run
 * with the default fallback=none fails explicitly rather than masking the gap.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', '..', 'bin', 'construct');

function makeProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ingest-strategy-'));
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  const doc = path.join(cwd, 'note.md');
  fs.writeFileSync(doc, '# Note\n\nA short ingestable markdown document.\n');
  return { cwd, doc };
}

function runIngest(cwd, args, env = {}) {
  const result = spawnSync('node', [BIN, 'ingest', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return result;
}

test('adapter strategy: run metadata reports strategy=adapter and null model', () => {
  const { cwd, doc } = makeProject();
  const result = runIngest(cwd, [doc, '--strategy', 'adapter']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ingestion.strategy, 'adapter');
  assert.equal(parsed.ingestion.model, null);
  assert.equal(parsed.ingestion.fallbackApplied, null);
  assert.ok(parsed.files.length >= 1);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('default (no flag, no config) is the adapter path', () => {
  const { cwd, doc } = makeProject();
  const result = runIngest(cwd, [doc]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ingestion.strategy, 'adapter');
  assert.equal(parsed.ingestion.model, null);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('provider strategy with fallback=none fails explicitly, no silent adapter use', () => {
  const { cwd, doc } = makeProject();
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    ingest: { strategy: 'provider', fallback: 'none' },
  }, null, 2));
  const result = runIngest(cwd, [doc], { CX_MODEL_FAST: 'test-fast-model' });
  assert.notEqual(result.status, 0, 'provider+fallback=none should fail explicitly');
  assert.match(result.stderr, /provider/i);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('provider strategy with fallback=adapter records model and the fallback that carried it', () => {
  const { cwd, doc } = makeProject();
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({
    version: 1,
    ingest: { strategy: 'provider', fallback: 'adapter' },
  }, null, 2));
  const result = runIngest(cwd, [doc], { CX_MODEL_FAST: 'test-fast-model' });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ingestion.strategy, 'provider');
  assert.equal(parsed.ingestion.model, 'test-fast-model');
  assert.ok(parsed.ingestion.fallbackApplied, 'expected a recorded fallback');
  assert.equal(parsed.ingestion.fallbackApplied.from, 'provider');
  assert.equal(parsed.ingestion.fallbackApplied.to, 'adapter');
  fs.rmSync(cwd, { recursive: true, force: true });
});
