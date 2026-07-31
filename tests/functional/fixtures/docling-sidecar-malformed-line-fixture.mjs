/**
 * tests/functional/fixtures/docling-sidecar-malformed-line-fixture.mjs — stub
 * sidecar child for docling-client.mjs's malformed-stdout-line handling.
 *
 * Answers the spawnSidecar version `ping` with the pinned Docling version,
 * then on the next stdin request writes one non-JSON stdout line and exits
 * without answering — forces docling-client.mjs's child `exit` handler to
 * reject the pending request, carrying the malformed-message counter/preview.
 */

import { DOCLING_PIN } from '../../../lib/runtime/uv-bootstrap.mjs';

let buf = '';
let answeredPing = false;
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    const req = JSON.parse(line);
    if (!answeredPing && req.method === 'ping') {
      answeredPing = true;
      process.stdout.write(`${JSON.stringify({ id: req.id, result: { ok: true, doclingVersion: DOCLING_PIN } })}\n`);
      continue;
    }
    process.stdout.write('not-json-at-all-{{{\n', () => {
      process.exit(7);
    });
    return;
  }
});
