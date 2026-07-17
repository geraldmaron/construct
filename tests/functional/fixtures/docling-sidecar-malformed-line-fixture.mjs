/**
 * tests/functional/fixtures/docling-sidecar-malformed-line-fixture.mjs — stub
 * sidecar child for docling-client.mjs's malformed-stdout-line handling
 * (construct-4uxq0.9.13).
 *
 * On the first stdin line (the real request), writes one non-JSON stdout
 * line, then exits without ever answering the request — forces
 * docling-client.mjs's child `exit` handler to reject the pending request,
 * carrying the malformed-message counter/preview docling-client.mjs attaches
 * to that error.
 */

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  if (!buf.includes('\n')) return;
  process.stdout.write('not-json-at-all-{{{\n', () => {
    process.exit(7);
  });
});
