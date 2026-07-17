/**
 * tests/functional/document-export-providers.functional.test.mjs — Pandoc/Typst
 * Provider Card routing for lib/document-export.mjs (construct-tsyfe.6.5).
 *
 * Touches more than one component (registry/provider-cards.json data +
 * lib/providers/document-export-providers.mjs + lib/document-export.mjs's
 * spawn/installHint wiring), so per the repo's multi-component rule this
 * lives here rather than only as a lib-level unit test. Uses stub pandoc/
 * typst binaries on a tmpdir PATH (same convention as
 * tests/functional/document-export.functional.test.mjs) so it runs without
 * either binary installed.
 *
 * Covers acceptance criteria 1-2 from the bead:
 *   1. resolveDocumentExportProvider()'s path/version/installHint for
 *      pandoc and typst match detect()/installHint()'s output for the same
 *      environment.
 *   2. lib/document-export.mjs's export spawn is routed through
 *      spawnDocumentExportProvider() rather than a bare spawnFn(config.engine, ...)
 *      call — proven both by grepping the source and by exercising the
 *      real export path end to end.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detect, exportMarkdown, installHint } from '../../lib/document-export.mjs';
import { findProviderCard, validateProviderCard } from '../../lib/providers/provider-card.mjs';
import {
  resolveDocumentExportProvider,
  spawnDocumentExportProvider,
  PANDOC_PROVIDER_ID,
  TYPST_PROVIDER_ID,
} from '../../lib/providers/document-export-providers.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const DOCUMENT_EXPORT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'document-export.mjs'), 'utf8');

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeStubBinary(dir, name, versionLine) {
  const binPath = path.join(dir, name);
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    `if (args[0] === "--version") { console.log(${JSON.stringify(versionLine)}); process.exit(0); }`,
    'const o = args.indexOf("-o");',
    'if (o >= 0 && args[o + 1]) { fs.writeFileSync(args[o + 1], "stub-output\\n"); }',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(binPath, script);
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

function stubToolchainEnv(prefix = 'cx-export-providers-stub-') {
  const dir = tmpDir(prefix);
  writeStubBinary(dir, 'pandoc', 'pandoc 3.0.0-test');
  writeStubBinary(dir, 'typst', 'typst 0.11.0-test');
  return { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH || ''}` };
}

test('registry/provider-cards.json carries pandoc and typst binary cards that validate against the schema', () => {
  for (const id of [PANDOC_PROVIDER_ID, TYPST_PROVIDER_ID]) {
    const card = findProviderCard(id);
    assert.ok(card, `expected a Provider Card for '${id}'`);
    assert.equal(card.kind, 'binary');
    assert.equal(card.healthCheck.kind, 'subprocess-version');
    assert.equal(card.healthCheck.command, id);
    const result = validateProviderCard(card);
    assert.equal(result.ok, true, result.errors.join('; '));
  }
});

test('resolveDocumentExportProvider matches detect()\'s pandoc path/version for the same environment', () => {
  const env = stubToolchainEnv('cx-export-providers-pandoc-');
  const detection = detect('html', env);
  const pandocStatus = detection.binaries.find((b) => b.name === 'pandoc');
  assert.ok(pandocStatus?.path, 'detect() did not report a pandoc path');

  const resolved = resolveDocumentExportProvider('pandoc', env);
  assert.equal(resolved.path, pandocStatus.path);
  assert.equal(resolved.version, pandocStatus.version);
  assert.equal(resolved.card.id, 'pandoc');
});

test('resolveDocumentExportProvider matches detect()\'s typst path/version for the pdf format\'s extraBinaries entry', () => {
  const env = stubToolchainEnv('cx-export-providers-typst-');
  const detection = detect('pdf', env);
  const typstStatus = detection.binaries.find((b) => b.name === 'typst');
  assert.ok(typstStatus?.path, 'detect() did not report a typst path');

  const resolved = resolveDocumentExportProvider('typst', env);
  assert.equal(resolved.path, typstStatus.path);
  assert.equal(resolved.version, typstStatus.version);
  assert.equal(resolved.card.id, 'typst');
});

test('installHint for pandoc/typst reads the Provider Card fallback.description, unchanged text', () => {
  const pandocCard = findProviderCard('pandoc');
  const typstCard = findProviderCard('typst');
  assert.equal(installHint('pandoc'), pandocCard.fallback.description);
  assert.equal(installHint('typst'), typstCard.fallback.description);
  assert.match(installHint('pandoc'), /brew install pandoc/);
  assert.match(installHint('typst'), /brew install typst/);
});

test('resolveDocumentExportProvider reports null path/version for an empty PATH, matching detect()', () => {
  const emptyPathEnv = { ...process.env, PATH: tmpDir('cx-export-providers-empty-path-') };
  const detection = detect('html', emptyPathEnv);
  assert.equal(detection.present, false);
  assert.deepEqual(detection.missing, ['pandoc']);

  const resolved = resolveDocumentExportProvider('pandoc', emptyPathEnv);
  assert.equal(resolved.path, null);
  assert.equal(resolved.version, null);
});

test('spawnDocumentExportProvider spawns the named binary and returns its Provider Card', () => {
  const env = stubToolchainEnv('cx-export-providers-spawn-');
  const { result, card } = spawnDocumentExportProvider('pandoc', ['--version'], { env });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /pandoc 3\.0\.0-test/);
  assert.equal(card.id, 'pandoc');
});

test('lib/document-export.mjs routes its export spawn through spawnDocumentExportProvider, not a bare spawnFn(config.engine, ...) call', () => {
  assert.match(DOCUMENT_EXPORT_SRC, /spawnDocumentExportProvider\(config\.engine, args,/);
  assert.doesNotMatch(
    DOCUMENT_EXPORT_SRC,
    /const result = spawnFn\(config\.engine, args,/,
    'the direct spawnFn(config.engine, ...) call should be replaced by the Provider-Card-mediated wrapper',
  );
});

test('exportMarkdown html export still succeeds end to end with the export spawn routed through the Provider Card wrapper', () => {
  const env = stubToolchainEnv('cx-export-providers-e2e-');
  const work = tmpDir('cx-export-providers-e2e-work-');
  const inputPath = path.join(work, 'doc.md');
  fs.writeFileSync(inputPath, '# Title\n\nBody paragraph for export.\n', 'utf8');

  const result = exportMarkdown({ inputPath, format: 'html', env });
  assert.equal(result.ok, true, `expected ok; got: ${JSON.stringify(result)}`);
  assert.equal(result.engine, 'pandoc');
  assert.ok(fs.existsSync(result.outputPath));
});
