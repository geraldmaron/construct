/**
 * tests/functional/richdoc-production-export.functional.test.mjs — production export wiring
 * through RichDocument with provider evidence (construct-tsyfe.6.2 / construct-tsyfe.3.5).
 *
 * Spawns the real publish orchestrator against a markdown fixture with a stubbed pandoc on PATH,
 * asserting the ledger export record carries exportPath, provider, contentHash, and fidelity fields.
 * A second case forces the markdown fallback and confirms export still succeeds.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runPublish } from '../../lib/publish.mjs';
import { exportFromSource, buildRichDocumentFromFile } from '../../lib/export-from-source.mjs';
import { validateExportProviderResult } from '../../lib/export-provider-contract.mjs';
import { makeParagraphBlock, makeRun } from '../../lib/rich-document.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-prd-platform.md');

const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function stubPandocPath() {
  const dir = tmpDir('richdoc-export-stub-');
  const pandocPath = path.join(dir, process.platform === 'win32' ? 'pandoc.cmd' : 'pandoc');
  const script = [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'if (args[0] === "--version") { console.log("pandoc 3.0.0-test"); process.exit(0); }',
    'const o = args.indexOf("-o");',
    'if (o >= 0 && args[o + 1]) fs.writeFileSync(args[o + 1], "stub-output\\n");',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(pandocPath, script);
  fs.chmodSync(pandocPath, 0o755);
  return dir;
}

function writeMinimalFixture(dir) {
  const file = path.join(dir, 'sample.md');
  fs.writeFileSync(file, [
    '---',
    'title: Export wiring fixture',
    'artifactType: adr',
    '---',
    '',
    '# Export wiring fixture',
    '',
    'Body paragraph for production export evidence.',
    '',
  ].join('\n'), 'utf8');
  return file;
}

test('runPublish records RichDocument export evidence on the ledger', () => {
  const fixtureDir = tmpDir('richdoc-fixture-');
  const fixture = writeMinimalFixture(fixtureDir);
  const outDir = tmpDir('richdoc-publish-');
  const result = runPublish({
    inputPath: fixture,
    format: 'md',
    outputPath: path.join(outDir, 'out.md'),
    strict: false,
    gate: false,
    demos: [],
    recordings: [],
    cwd: fixtureDir,
    repoRoot: REPO,
  });
  assert.equal(result.ledger.export?.ok, true, result.message || result.ledger.export?.message);
  assert.equal(result.ledger.export.exportPath, 'richdocument');
  const validation = validateExportProviderResult(result.ledger.export);
  assert.equal(validation.ok, true, validation.errors?.join('; '));
  assert.ok(result.ledger.export.provider?.name);
  assert.ok(result.ledger.export.provider?.version);
  assert.match(result.ledger.export.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(Array.isArray(result.ledger.export.fidelity.droppedBlocks));
});

test('exportFromSource falls back to markdown when RichDocument construction is forced off', () => {
  const stubDir = stubPandocPath();
  const outDir = tmpDir('richdoc-fallback-');
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}` };
  const result = exportFromSource({
    inputPath: FIXTURE,
    outputPath: path.join(outDir, 'fallback.html'),
    format: 'html',
    exportPath: 'markdown',
    env,
    cwd: REPO,
    repoRoot: REPO,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.exportPath, 'markdown');
  assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
});

test('identical RichDocument exports produce equal content hashes', () => {
  const stubDir = stubPandocPath();
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}` };
  const rich = buildRichDocumentFromFile(FIXTURE);
  assert.equal(rich.ok, true);
  const outDir = tmpDir('richdoc-hash-');
  const first = exportFromSource({
    doc: rich.doc,
    format: 'md',
    outputPath: path.join(outDir, 'a.md'),
    env,
    cwd: REPO,
    repoRoot: REPO,
  });
  const second = exportFromSource({
    doc: rich.doc,
    format: 'md',
    outputPath: path.join(outDir, 'b.md'),
    env,
    cwd: REPO,
    repoRoot: REPO,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.contentHash, second.contentHash);
  const modified = structuredClone(rich.doc);
  modified.sections[0].blocks.push(makeParagraphBlock({ runs: [makeRun({ text: 'extra line' })] }));
  const third = exportFromSource({
    doc: modified,
    format: 'md',
    outputPath: path.join(outDir, 'c.md'),
    env,
    cwd: REPO,
    repoRoot: REPO,
  });
  assert.notEqual(first.contentHash, third.contentHash);
});
