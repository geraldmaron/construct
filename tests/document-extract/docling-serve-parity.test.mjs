/**
 * tests/document-extract/docling-serve-parity.test.mjs — Docling Serve parity certification (construct-tsyfe.2.5).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runDoclingServeParityCertification,
  buildCorpusSidecarStubExtract,
  buildCorpusServeStubExtract,
  tokenDiceSimilarity,
  DEFAULT_PARITY_TOLERANCE,
} from '../../lib/document-extract/docling-serve-parity.mjs';
import {
  checkDoclingServeHealth,
  extractViaDoclingRemote,
  resolveDoclingServeAuthHeaders,
} from '../../lib/ingest/docling-remote.mjs';
import { validateExtractionProviderResult } from '../../lib/document-extract/extraction-result-contract.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('tokenDiceSimilarity flags divergent markdown beyond tolerance', () => {
  assert.equal(tokenDiceSimilarity('hello construct world', 'hello construct world'), 1);
  assert.ok(tokenDiceSimilarity('hello construct world', 'goodbye other text') < DEFAULT_PARITY_TOLERANCE);
});

test('runDoclingServeParityCertification passes with matched stub providers', async () => {
  const report = await runDoclingServeParityCertification({
    localExtract: buildCorpusSidecarStubExtract(),
    remoteExtract: buildCorpusServeStubExtract(),
  });
  assert.equal(report.pass, true);
  assert.ok(report.fixtures.length >= 7);
  for (const row of report.fixtures) {
    assert.equal(row.withinTolerance, true, `${row.id} diverged`);
    assert.equal(row.localContractOk, true);
    assert.equal(row.remoteContractOk, true);
  }
});

test('runDoclingServeParityCertification fails when remote output diverges', async () => {
  const report = await runDoclingServeParityCertification({
    localExtract: buildCorpusSidecarStubExtract(),
    remoteExtract: async () => ({
      text: 'completely unrelated remote body with no shared tokens',
      extractionMethod: 'docling-remote',
      characters: 50,
      truncated: false,
      droppedInfo: [],
    }),
    tolerance: 0.85,
  });
  assert.equal(report.pass, false);
  assert.ok(report.errors.some((err) => err.includes('fidelity')));
});

test('checkDoclingServeHealth returns degraded state when endpoint is unreachable', async () => {
  const health = await checkDoclingServeHealth({
    env: { DOCLING_SERVE_URL: 'http://127.0.0.1:1' },
    timeoutMs: 500,
  });
  assert.equal(health.ok, false);
  assert.equal(health.degraded, true);
  assert.ok(health.reason);
});

test('extractViaDoclingRemote throws DOCLING_REMOTE_DEGRADED when health probe fails', async () => {
  await assert.rejects(
    () => extractViaDoclingRemote({
      filePath: join(repoRoot, 'tests/fixtures/document-extraction-corpus/01-digital-simple.pdf'),
      env: { DOCLING_SERVE_URL: 'http://127.0.0.1:1' },
      timeoutMs: 500,
    }),
    (err) => err.code === 'DOCLING_REMOTE_DEGRADED' && err.degraded === true,
  );
});

test('extractViaDoclingRemote forwards bearer auth and validates remote contract shape', async () => {
  let authHeader = null;
  const srv = await serve((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    authHeader = req.headers.authorization || null;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'success', document: { md_content: '# Remote\n\nparity body text' } }));
  });
  try {
    const filePath = join(repoRoot, 'tests/fixtures/document-extraction-corpus/01-digital-simple.pdf');
    const result = await extractViaDoclingRemote({
      filePath,
      env: {
        DOCLING_SERVE_URL: srv.url,
        DOCLING_SERVE_BEARER_TOKEN: 'secret-token',
      },
      timeoutMs: 10_000,
    });
    assert.equal(authHeader, 'Bearer secret-token');
    assert.equal(resolveDoclingServeAuthHeaders({ DOCLING_SERVE_BEARER_TOKEN: 'secret-token' }).Authorization, 'Bearer secret-token');
    const contract = validateExtractionProviderResult(result);
    assert.equal(contract.ok, true);
    assert.match(result.text, /parity body text/);
  } finally {
    await srv.close();
  }
});

test('extractViaDoclingRemote reads fixture-specific markdown from stub serve handler', async () => {
  const fixturePath = join(repoRoot, 'tests/fixtures/document-extraction-corpus/05-docx-simple.docx');
  const expected = readFileSync(fixturePath);
  const srv = await serve((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/health')) {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    res.setHeader('content-type', 'application/json');
    const marker = expected.includes('Construct corpus')
      ? 'Construct corpus serve markdown body'
      : 'Docling serve OCR markdown body';
    res.end(JSON.stringify({ status: 'success', document: { md_content: `# ${marker}` } }));
  });
  try {
    const localExtract = buildCorpusSidecarStubExtract();
    const remoteExtract = async ({ filePath, env }) => extractViaDoclingRemote({ filePath, env, timeoutMs: 10_000 });
    const report = await runDoclingServeParityCertification({
      localExtract,
      remoteExtract,
      tolerance: 0.5,
      env: { DOCLING_SERVE_URL: srv.url },
    });
    const docxRow = report.fixtures.find((row) => row.id === '05-docx-simple');
    assert.ok(docxRow);
    assert.equal(docxRow.withinTolerance, true);
  } finally {
    await srv.close();
  }
});
