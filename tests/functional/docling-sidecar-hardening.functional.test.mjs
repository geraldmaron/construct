/**
 * tests/functional/docling-sidecar-hardening.functional.test.mjs — bounded queue, protocol truth, cleanup.
 *
 * Drives the real docling-client against controllable Node stub sidecars (no docling venv).
 * Covers construct-tsyfe.2.4 acceptance: concurrency cap, malformed-message visibility,
 * version pin failure, and parent-exit cleanup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  configureDoclingClientForTests,
  resetDoclingSidecarForTests,
  extractViaDocling,
  spawnSidecar,
  cleanupDoclingSidecarOnExit,
  getDoclingSidecarQueueStats,
  getActiveDoclingSidecarForTests,
} from '../../lib/document-extract/docling-client.mjs';
import { DOCLING_PIN } from '../../lib/runtime/uv-bootstrap.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const STUB_SCRIPT = join(repoRoot, 'tests/functional/fixtures/docling-sidecar-stub-fixture.mjs');

function stubEnv(overrides = {}) {
  return {
    STUB_DOCLING_VERSION: DOCLING_PIN,
    STUB_DELAY_MS: '0',
    STUB_EMIT_MALFORMED: '0',
    STUB_EMIT_ORPHAN: '0',
    STUB_HANG: '0',
    ...overrides,
  };
}

function applyStubEnv(overrides = {}) {
  const merged = stubEnv(overrides);
  for (const [key, value] of Object.entries(merged)) {
    process.env[key] = value;
  }
}

function makeSourceFile() {
  const dir = mkdtempSync(join(tmpdir(), 'docling-hardening-'));
  const filePath = join(dir, 'sample.md');
  writeFileSync(filePath, '# sample\n');
  return { dir, filePath };
}

test.afterEach(async () => {
  await resetDoclingSidecarForTests();
});

test('concurrent extracts respect the configured concurrency cap', async () => {
  const { filePath } = makeSourceFile();
  configureDoclingClientForTests({
    pythonBin: process.execPath,
    scriptPath: STUB_SCRIPT,
    maxConcurrency: 2,
    maxQueueSize: 16,
    requestTimeoutMs: 30_000,
    pinnedVersion: DOCLING_PIN,
  });
  applyStubEnv({ STUB_DELAY_MS: '100' });

  const inflightSamples = [];
  const poll = setInterval(() => {
    const stats = getDoclingSidecarQueueStats();
    if (stats) inflightSamples.push(stats.inFlight);
  }, 5);

  const requests = Array.from({ length: 6 }, () => extractViaDocling(filePath));
  const results = await Promise.all(requests);
  clearInterval(poll);

  assert.equal(results.length, 6);
  assert.ok(results.every((r) => r.markdown.includes('stub extract')));
  assert.ok(inflightSamples.length > 0, 'sampled in-flight queue depth');
  assert.ok(Math.max(...inflightSamples) <= 2, `max in-flight ${Math.max(...inflightSamples)} exceeded cap 2`);
  assert.ok(Math.max(...inflightSamples) >= 2, 'expected at least two concurrent extracts while load was active');
});

test('malformed sidecar stdout is counted and surfaced in droppedInfo', async () => {
  const { filePath } = makeSourceFile();
  const warnings = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    const text = String(chunk);
    if (text.includes('[docling sidecar]')) warnings.push(text);
    return origWrite(chunk, ...rest);
  };

  configureDoclingClientForTests({
    pythonBin: process.execPath,
    scriptPath: STUB_SCRIPT,
    maxConcurrency: 1,
    maxQueueSize: 8,
    requestTimeoutMs: 10_000,
    pinnedVersion: DOCLING_PIN,
  });
  applyStubEnv({ STUB_EMIT_MALFORMED: '1' });

  try {
    const result = await extractViaDocling(filePath);
    const protocolDrop = result.droppedInfo?.find((d) => d.kind === 'sidecar-protocol-warning');
    assert.ok(protocolDrop, 'malformed protocol lines surface in droppedInfo');
    assert.ok(protocolDrop.count >= 1);
    assert.ok(warnings.some((w) => w.includes('malformed sidecar stdout line')));
  } finally {
    process.stderr.write = origWrite;
  }
});

test('version mismatch fails loud at spawn time', async () => {
  applyStubEnv({ STUB_DOCLING_VERSION: '9.9.9' });

  await assert.rejects(
    () => spawnSidecar({
      pythonBin: process.execPath,
      scriptPath: STUB_SCRIPT,
      requestTimeoutMs: 5_000,
      pinnedVersion: DOCLING_PIN,
    }),
    (err) => {
      assert.equal(err.code, 'DOCLING_VERSION_MISMATCH');
      assert.match(err.message, /version mismatch/);
      return true;
    },
  );
});

test('exit cleanup leaves no orphaned sidecar child', async () => {
  const { filePath } = makeSourceFile();
  configureDoclingClientForTests({
    pythonBin: process.execPath,
    scriptPath: STUB_SCRIPT,
    maxConcurrency: 1,
    maxQueueSize: 4,
    requestTimeoutMs: 10_000,
    pinnedVersion: DOCLING_PIN,
  });
  applyStubEnv();

  await extractViaDocling(filePath);
  const sidecar = getActiveDoclingSidecarForTests();
  assert.ok(sidecar);
  assert.equal(sidecar.child.exitCode, null);
  assert.equal(sidecar.child.killed, false);

  const exited = new Promise((resolve) => {
    sidecar.child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  cleanupDoclingSidecarOnExit();
  const outcome = await exited;
  assert.ok(outcome.code !== null || outcome.signal, 'child process terminated after cleanup');
});

test('request timeout kills the sidecar child', async () => {
  applyStubEnv({ STUB_HANG: '1' });
  const { filePath } = makeSourceFile();

  const sidecar = await spawnSidecar({
    pythonBin: process.execPath,
    scriptPath: STUB_SCRIPT,
    requestTimeoutMs: 200,
    pinnedVersion: DOCLING_PIN,
  });

  const exitSignal = new Promise((resolve) => {
    sidecar.child.once('exit', (_code, signal) => resolve(signal));
  });

  await assert.rejects(
    () => sidecar.send('extract', { path: filePath }),
    (err) => {
      assert.equal(err.code, 'DOCLING_SIDECAR_TIMEOUT');
      return true;
    },
  );

  const signal = await Promise.race([
    exitSignal,
    new Promise((_, reject) => setTimeout(() => reject(new Error('sidecar did not exit after timeout')), 5_000)),
  ]);
  assert.ok(signal === 'SIGTERM' || signal === 'SIGKILL', `child received kill signal, got ${signal}`);
});
