/**
 * tests/functional/fixtures/docling-sidecar-orphan-id-fixture.mjs — stub
 * sidecar child for docling-client.mjs's unmatched-response-id handling
 * (construct-4uxq0.9.13).
 *
 * Answers the spawnSidecar version `ping`, then on each later request first
 * writes a well-formed response addressed to an id no caller is waiting on,
 * then writes the real response for the request's own id — proving an orphan
 * message gets logged rather than silently dropped.
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
      continue;
    }
    process.stdout.write(`${JSON.stringify({ id: 999999, result: { ok: true, orphan: true } })}\n`);
    process.stdout.write(`${JSON.stringify({ id: req.id, result: { ok: true } })}\n`);
  }
});
