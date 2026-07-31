/**
 * tests/functional/docling-sidecar-fault-handling.functional.test.mjs —
 * docling-client.mjs surfaces malformed sidecar messages, orphan response
 * ids, and timeouts truthfully instead of silently dropping them.
 *
 * Drives the real `spawnSidecar()` from lib/document-extract/docling-client.mjs
 * against small Node fixture processes standing in for the Python sidecar —
 * the client's newline-delimited-JSON parsing, pending-request bookkeeping,
 * and process-lifecycle logic (timers, `child.kill`, the `exit` handler) are
 * exactly what production spawns and drives. Only the program on the other
 * end of the pipe is substituted, via `spawnSidecar`'s pythonBin/scriptPath
 * override points, so the suite needs neither a real docling venv nor
 * multi-minute waits on the real REQUEST_TIMEOUT_MS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnSidecar } from '../../lib/document-extract/docling-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

test('a malformed sidecar stdout line is counted and surfaced in the eventual failure, not a generic timeout', async () => {
  const sidecar = await spawnSidecar({
    pythonBin: process.execPath,
    scriptPath: path.join(FIXTURES, 'docling-sidecar-malformed-line-fixture.mjs'),
    requestTimeoutMs: 5_000,
  });
  await assert.rejects(
    sidecar.send('extract', { path: '/tmp/whatever.pdf' }),
    (err) => {
      assert.match(err.message, /exited/i, 'failure is attributed to the sidecar exiting, not a bare timeout');
      assert.equal(err.malformedMessageCount, 1);
      assert.equal(err.malformedMessagePreviews.length, 1);
      assert.match(err.malformedMessagePreviews[0], /not-json-at-all/);
      return true;
    },
  );
});

test('an unmatched-id sidecar response is logged as a warning and does not corrupt the real response', async () => {
  const writes = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, ...args) => { writes.push(String(chunk)); return true; };
  let sidecar;
  try {
    sidecar = await spawnSidecar({
      pythonBin: process.execPath,
      scriptPath: path.join(FIXTURES, 'docling-sidecar-orphan-id-fixture.mjs'),
      requestTimeoutMs: 5_000,
    });
    const result = await sidecar.send('extract', { path: '/tmp/orphan-check.pdf' });
    assert.equal(result.ok, true);
  } finally {
    process.stderr.write = originalWrite;
    if (sidecar) sidecar.child.kill('SIGKILL');
  }
  const warning = writes.find((w) => /orphan|desync/i.test(w) && w.includes('999999'));
  assert.ok(warning, `expected an orphan-id warning line, got: ${JSON.stringify(writes)}`);
});

test('a request timeout kills the sidecar child process rather than leaving it running', async () => {
  const sidecar = await spawnSidecar({
    pythonBin: process.execPath,
    scriptPath: path.join(FIXTURES, 'docling-sidecar-hang-fixture.mjs'),
    requestTimeoutMs: 100,
  });
  await assert.rejects(
    sidecar.send('extract', { path: '/tmp/whatever.pdf' }),
    (err) => {
      assert.equal(err.code, 'DOCLING_SIDECAR_TIMEOUT');
      return true;
    },
  );
  const [, signal] = await once(sidecar.child, 'exit');
  assert.equal(signal, 'SIGTERM', 'timeout must send a real kill signal to the sidecar process');
  assert.equal(sidecar.child.killed, true);
});
