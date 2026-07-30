/**
 * tests/functional/fixtures/docling-sidecar-hang-fixture.mjs — stub sidecar
 * child for docling-client.mjs's timeout-kill handling.
 *
 * Answers the spawnSidecar version `ping`, then reads and discards further
 * stdin without responding and keeps its event loop alive so it only exits
 * when killed — standing in for a docling convert() call that
 * docling-client.mjs's own timeout gave up waiting on.
 */

import { DOCLING_PIN } from '../../../lib/runtime/uv-bootstrap.mjs';

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const req = JSON.parse(line);
    if (req.method === 'ping') {
      process.stdout.write(`${JSON.stringify({ id: req.id, result: { ok: true, doclingVersion: DOCLING_PIN } })}\n`);
    }
  }
});
setInterval(() => {}, 60_000);
