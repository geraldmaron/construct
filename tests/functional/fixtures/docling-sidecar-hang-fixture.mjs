/**
 * tests/functional/fixtures/docling-sidecar-hang-fixture.mjs — stub sidecar
 * child for docling-client.mjs's timeout-kill handling (construct-4uxq0.9.13).
 *
 * Reads and discards stdin, never responds, and keeps its own event loop
 * alive so it only exits when killed — standing in for a docling convert()
 * call that docling-client.mjs's own timeout gave up waiting on.
 */

process.stdin.resume();
setInterval(() => {}, 60_000);
