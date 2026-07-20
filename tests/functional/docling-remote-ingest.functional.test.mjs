/**
 * docling-remote-ingest.functional.test.mjs — opt-in remote conversion (ADR-0036, construct-n1f8).
 *
 * Drives the docling-remote extractor against a real local HTTP server stubbing
 * Docling Serve's POST /v1/convert/file contract (multipart `files`, markdown at
 * document.md_content). Pins the fail-loud rules: missing DOCLING_SERVE_URL,
 * HTTP error, and failure status all throw — the user chose remote, so silently
 * degrading to the sidecar would hide misconfiguration.
 *
 * @capability ingest.docling-remote
 */
import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractViaDoclingRemote, resolveDoclingServeUrl } from '../../lib/ingest/docling-remote.mjs';
import { INGEST_STRATEGIES } from '../../lib/ingest/strategy.mjs';
import { INGEST_STRATEGIES as SCHEMA_STRATEGIES } from '../../lib/config/schema.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function tmpDoc() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-docling-remote-'));
  const file = join(dir, 'doc.pdf');
  writeFileSync(file, 'fake pdf bytes');
  return { file, cleanup: () => rmTmpDir(dir) };
}

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/health')) {
        res.statusCode = 200;
        res.end('ok');
        return;
      }
      handler(req, res);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('the docling-remote strategy is registered consistently in both enums', () => {
  assert.ok(INGEST_STRATEGIES.includes('docling-remote'));
  assert.ok(SCHEMA_STRATEGIES.includes('docling-remote'));
});

test('converts via the Docling Serve contract and returns the extractor shape', async () => {
  const { file, cleanup } = tmpDoc();
  let seen = null;
  const srv = await serve((req, res) => {
    seen = { method: req.method, url: req.url, contentType: req.headers['content-type'] || '' };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'success', document: { md_content: '# Converted\n\nbody text' } }));
  });
  try {
    const r = await extractViaDoclingRemote({ filePath: file, env: { DOCLING_SERVE_URL: srv.url } });
    assert.equal(seen.method, 'POST');
    assert.equal(seen.url, '/v1/convert/file');
    assert.match(seen.contentType, /multipart\/form-data/);
    assert.equal(r.extractionMethod, 'docling-remote');
    assert.match(r.text, /# Converted/);
    assert.equal(r.truncated, false);
    assert.deepEqual(r.droppedInfo, []);
  } finally {
    await srv.close();
    cleanup();
  }
});

test('fails loud when DOCLING_SERVE_URL is unset', async () => {
  const { file, cleanup } = tmpDoc();
  try {
    await assert.rejects(
      () => extractViaDoclingRemote({ filePath: file, env: {} }),
      (e) => e.code === 'DOCLING_REMOTE_UNCONFIGURED',
    );
  } finally { cleanup(); }
});

test('fails loud on HTTP error and on failure status', async () => {
  const { file, cleanup } = tmpDoc();
  const srv500 = await serve((req, res) => { res.statusCode = 500; res.end('boom'); });
  const srvFail = await serve((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'failure', errors: [{ message: 'bad doc' }] }));
  });
  try {
    await assert.rejects(
      () => extractViaDoclingRemote({ filePath: file, env: { DOCLING_SERVE_URL: srv500.url } }),
      (e) => e.code === 'DOCLING_REMOTE_HTTP',
    );
    await assert.rejects(
      () => extractViaDoclingRemote({ filePath: file, env: { DOCLING_SERVE_URL: srvFail.url } }),
      (e) => e.code === 'DOCLING_REMOTE_FAILED',
    );
  } finally {
    await srv500.close();
    await srvFail.close();
    cleanup();
  }
});

test('respects maxChars with truncation flagged', async () => {
  const { file, cleanup } = tmpDoc();
  const srv = await serve((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'success', document: { md_content: 'x'.repeat(500) } }));
  });
  try {
    const r = await extractViaDoclingRemote({ filePath: file, maxChars: 100, env: { DOCLING_SERVE_URL: srv.url } });
    assert.equal(r.characters, 100);
    assert.equal(r.truncated, true);
  } finally {
    await srv.close();
    cleanup();
  }
});

test('trailing slashes on the serve URL are normalized', () => {
  assert.equal(resolveDoclingServeUrl({ DOCLING_SERVE_URL: 'http://x:5001///' }), 'http://x:5001');
  assert.equal(resolveDoclingServeUrl({}), null);
});
