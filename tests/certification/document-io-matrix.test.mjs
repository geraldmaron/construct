/**
 * tests/certification/document-io-matrix.test.mjs — certified document I/O matrix contract.
 *
 * @capability ingest.document-io
 *
 * The distinction under test is local (graceful) vs certified (release) mode: a format whose engine
 * is absent skips cleanly in local mode but is a hard failure in certified mode — certification
 * cannot be earned with an engine quietly missing. Engine presence is simulated by stripping PATH so
 * the assertion holds on any runner regardless of what is actually installed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDocumentIoMatrix, DOCUMENT_IO_EXPORT_MATRIX } from '../../lib/certification/document-io-matrix.mjs';
import { validateExportProviderResult } from '../../lib/export-provider-contract.mjs';
import { validateDiagramRendered } from '../../lib/export-validate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the matrix declares every RichDocument output format with an engine and a validator', () => {
  const formats = new Set(DOCUMENT_IO_EXPORT_MATRIX.map((e) => e.format));
  for (const required of ['html', 'htmlfrag', 'pdf', 'docx', 'doc', 'odt', 'odp', 'pptx', 'deck', 'rtf', 'epub', 'txt', 'tex', 'md', 'mdx']) {
    assert.ok(formats.has(required), `matrix is missing declared format: ${required}`);
  }
  for (const entry of DOCUMENT_IO_EXPORT_MATRIX) {
    assert.ok(['pdf', 'archive', 'html', 'bytes'].includes(entry.validate), `${entry.format}: unknown validator ${entry.validate}`);
  }
});

test('certified mode hard-fails a format skipped for a missing engine; local mode skips it', () => {
  const noEngines = { ...process.env, PATH: '', CONSTRUCT_LIBREOFFICE_BIN: '', SOFFICE_BIN: '' };

  const local = runDocumentIoMatrix({ mode: 'local', env: noEngines, repoRoot: REPO });
  const certified = runDocumentIoMatrix({ mode: 'certified', env: noEngines, repoRoot: REPO });

  const pandocFormat = (report) => report.results.find((r) => r.format === 'pdf');
  assert.equal(pandocFormat(local).status, 'skipped', 'a missing engine must skip in local mode');
  assert.equal(pandocFormat(certified).status, 'failed', 'a missing engine must hard-fail in certified mode');
  assert.match(pandocFormat(certified).detail, /missing engine/i);

  assert.equal(certified.pass, false, 'certified mode cannot pass with engines absent');
  assert.equal(certified.summary.failed > 0, true);

  const engineFree = local.results.filter((r) => r.engines.length === 0);
  for (const r of engineFree) {
    assert.notEqual(r.status, 'skipped', `${r.format} needs no engine and must run even with PATH stripped`);
  }
});

test('report identifies exact format, engines, and detail for every row', () => {
  const report = runDocumentIoMatrix({ mode: 'local', env: { ...process.env, PATH: '' }, repoRoot: REPO });
  for (const r of report.results) {
    assert.ok(typeof r.format === 'string' && r.format.length);
    assert.ok(Array.isArray(r.engines));
    assert.ok(typeof r.detail === 'string' && r.detail.length, `${r.format}: missing detail`);
    assert.ok(['certified', 'skipped', 'failed'].includes(r.status));
  }
  assert.ok(report.fixtureAudit.pass, `intake fixtures incomplete: ${report.fixtureAudit.errors.join(', ')}`);
});

test('validateExportProviderResult rejects export results missing fidelity evidence', () => {
  const broken = {
    ok: true,
    format: 'md',
    outputPath: '/tmp/x',
    provider: { name: 'construct', version: '1' },
    contentHash: `sha256:${'a'.repeat(64)}`,
    fidelity: undefined,
  };
  assert.equal(validateExportProviderResult(broken).ok, false);
});

test('validateDiagramRendered fails when mermaid source is left as raw text without img/svg', () => {
  const dir = path.join(REPO, '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, 'diagram-placeholder.html');
  fs.writeFileSync(htmlPath, '<html><body><pre>flowchart TD\nA-->B</pre></body></html>');
  try {
    const result = validateDiagramRendered(htmlPath, 'html');
    assert.equal(result.ok, false);
    assert.match(result.message, /diagram/i);
  } finally {
    try { fs.unlinkSync(htmlPath); } catch { /* skip */ }
  }
});
