/**
 * tests/functional/document-export.functional.test.mjs — markdown → PDF/DOCX/HTML
 * (plus DOC/RTF/ODT/EPUB/LaTeX/TXT/MD/MDX) export contract (ADR-0024 / construct-yrdd).
 *
 * The export half is bound to external binaries (Pandoc + Typst) discovered at
 * runtime and never bundled (ADR-0001). The tests assert the contract callers
 * (CLI, MCP, SDK) depend on:
 *   - detect() reports availability without spawning the engine for real.
 *   - exportMarkdown returns structured errors for bad input / unsupported
 *     format / missing binary — never throws on absent tooling.
 *   - When pandoc is present (via a stubbed binary on PATH), the engine is
 *     invoked with the expected arg shape and the success result names the
 *     produced file.
 *
 * Cross-platform note: the stub uses `process.execPath` + a small node script
 * shimmed as `pandoc` on a tmpdir PATH, so the test runs on CI runners that
 * lack pandoc without pulling in any system dep.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { detect, exportMarkdown, EXPORT_FORMATS, docxRenderedDiagrams, htmlRenderedDiagrams, assessFigureResolution } from '../../lib/document-export.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function writeMarkdown(dir, name = 'doc.md') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, '# Title\n\nBody paragraph for export.\n', 'utf8');
  return p;
}

// Stub pandoc: a tiny node script on a tmpdir PATH that captures its args and
// writes a recognisable byte sequence to the -o target, so happy-path tests
// don't need real pandoc and don't depend on system state.


function stubFigureBin(dir, name) {
  const binPath = path.join(dir, name);
  const script = [
    '#!/usr/bin/env node',
    'process.exit(0);',
  ].join('\n');
  fs.writeFileSync(binPath, script);
  fs.chmodSync(binPath, 0o755);
}

function stubFigureBins(dir) {
  for (const name of ['d2', 'mmdc', 'dot']) stubFigureBin(dir, name);
}

function stubPandocPath(prefix = 'cx-export-stub-') {
  const dir = tmpDir(prefix);
  const pandocPath = path.join(dir, process.platform === 'win32' ? 'pandoc.cmd' : 'pandoc');
  if (process.platform === 'win32') {
    fs.writeFileSync(pandocPath, '@echo off\necho pandoc 3.0.0-test\n');
  } else {
    const script = [
      '#!/usr/bin/env node',
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      'const args = process.argv.slice(2);',
      'if (args[0] === "--version") { console.log("pandoc 3.0.0-test"); process.exit(0); }',
      'const o = args.indexOf("-o");',
      'if (o >= 0 && args[o + 1]) { fs.writeFileSync(args[o + 1], "stub-output\\n"); fs.writeFileSync(path.join(__dirname, "argv.json"), JSON.stringify(args)); }',
      'process.exit(0);',
    ].join('\n');
    fs.writeFileSync(pandocPath, script);
    fs.chmodSync(pandocPath, 0o755);
  }
  return { dir, pandocPath };
}

function zipCommandPresent() {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(checker, ['zip'], { stdio: 'ignore' }).status === 0;
}

test('detect reports unsupported format clearly without spawning', () => {
  const result = detect('xyz');
  assert.equal(result.ok, false);
  assert.match(result.message, /Unsupported format: xyz/);
});

test('detect on a real format returns availability + actionable install hint when missing', () => {
  // Run with a PATH that cannot contain pandoc, so the result is deterministic
  // regardless of the developer machine.
  const emptyPathEnv = { ...process.env, PATH: tmpDir('cx-empty-path-') };
  const result = detect('html', emptyPathEnv);
  assert.equal(result.ok, true, 'detect itself never errors on missing tools');
  assert.equal(result.present, false);
  assert.deepEqual(result.missing, ['pandoc']);
  assert.match(result.message, /Install pandoc/);
});

test('exportMarkdown rejects bad format BEFORE checking input existence', () => {
  const result = exportMarkdown({ inputPath: '/no/such/path.md', format: 'xyz' });
  assert.equal(result.ok, false);
  assert.match(result.message, /Unsupported format: xyz/);
});

test('exportMarkdown reports a clear error for missing input file', () => {
  const result = exportMarkdown({ inputPath: '/no/such/path.md', format: 'html' });
  assert.equal(result.ok, false);
  assert.match(result.message, /input does not exist/);
});

test('exportMarkdown returns missing+install hint when pandoc is absent (no throw)', () => {
  const dir = tmpDir('cx-export-no-pandoc-');
  const inputPath = writeMarkdown(dir);
  const env = { ...process.env, PATH: tmpDir('cx-empty-path2-') };
  const result = exportMarkdown({ inputPath, format: 'docx', env });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['pandoc']);
  assert.match(result.message, /Install pandoc/);
});

test('construct-branded docx export succeeds without a bundled reference doc (graceful, not blocked)', () => {
  const { dir: stubDir } = stubPandocPath('cx-export-docx-stub-');
  const work = tmpDir('cx-export-docx-work-');
  const emptyRepo = tmpDir('cx-export-docx-norepo-');
  const inputPath = writeMarkdown(work);
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}` };
  const result = exportMarkdown({ inputPath, format: 'docx', branding: 'construct', env, repoRoot: emptyRepo });
  assert.equal(result.ok, true, `expected ok; got: ${JSON.stringify(result)}`);
  assert.equal(result.engine, 'pandoc');
  assert.ok(fs.existsSync(result.outputPath), `output not written: ${result.outputPath}`);
  const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
  assert.ok(!argv.includes('--reference-doc'), 'absent reference doc must not pass --reference-doc');
});

test('construct-branded docx export passes --reference-doc for the bundled reference doc when present', () => {
  const { dir: stubDir } = stubPandocPath('cx-export-refdoc-stub-');
  const work = tmpDir('cx-export-refdoc-work-');
  const inputPath = writeMarkdown(work);
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}` };
  const result = exportMarkdown({ inputPath, format: 'docx', branding: 'construct', env });
  assert.equal(result.ok, true, `expected ok; got: ${JSON.stringify(result)}`);
  const argv = JSON.parse(fs.readFileSync(path.join(stubDir, 'argv.json'), 'utf8'));
  const refIdx = argv.indexOf('--reference-doc');
  assert.ok(refIdx >= 0, `--reference-doc not passed; argv: ${argv.join(' ')}`);
  assert.match(argv[refIdx + 1], /construct-reference\.docx$/);
});

test('happy path: stubbed pandoc on PATH is spawned and the output file is written', () => {
  const { dir: stubDir } = stubPandocPath();
  const work = tmpDir('cx-export-work-');
  const inputPath = writeMarkdown(work);
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH || ''}` };
  const result = exportMarkdown({ inputPath, format: 'html', env });
  assert.equal(result.ok, true, `expected ok; got: ${JSON.stringify(result)}`);
  assert.equal(result.engine, 'pandoc');
  assert.ok(fs.existsSync(result.outputPath), `output not written: ${result.outputPath}`);
  assert.equal(fs.readFileSync(result.outputPath, 'utf8'), 'stub-output\n');
});

test('EXPORT_FORMATS pins the supported export set (contract surface)', () => {
  assert.deepEqual([...EXPORT_FORMATS].sort(), ['deck', 'doc', 'docx', 'epub', 'html', 'md', 'mdx', 'odt', 'pdf', 'pptx', 'rtf', 'tex', 'txt']);
});

test('detect doc format requires pandoc and libreoffice when absent', () => {
  // An empty PATH alone cannot simulate "libreoffice absent" on a machine where it's
  // really installed: resolveLibreOfficeBin also checks a hardcoded well-known install
  // path (e.g. /Applications/LibreOffice.app/...) that bypasses PATH/env entirely by
  // design (so real brew-cask installs are found without extra config). Injecting
  // libreOfficeExistsSyncFn lets this test simulate genuine absence regardless of
  // what's really installed on the machine running the suite.
  const emptyPathEnv = { ...process.env, PATH: tmpDir('cx-empty-path-doc-'), CONSTRUCT_LIBREOFFICE_BIN: '', SOFFICE_BIN: '' };
  const result = detect('doc', emptyPathEnv, { libreOfficeExistsSyncFn: () => false });
  assert.equal(result.ok, true);
  assert.equal(result.present, false);
  assert.ok(result.missing.includes('pandoc'));
  assert.ok(result.missing.includes('libreoffice'));
});

test('detect deck format requires pandoc when absent', () => {
  const emptyPathEnv = { ...process.env, PATH: tmpDir('cx-empty-path-deck-') };
  const result = detect('deck', emptyPathEnv);
  assert.equal(result.ok, true);
  assert.equal(result.present, false);
  assert.ok(result.missing.includes('pandoc'));
});

test('detect pptx format reports pptxgenjs when absent', () => {
  const result = detect('pptx', process.env);
  assert.equal(result.ok, true);
  if (result.present) {
    assert.ok(result.binaries.some((b) => b.name === 'pptxgenjs' && b.path));
  } else {
    assert.ok(result.missing.includes('pptxgenjs'));
  }
});

test('docxRenderedDiagrams rejects unresolved source and accepts embedded figure media', (t) => {
  if (!zipCommandPresent()) {
    t.skip('zip not installed');
    return;
  }
  const dir = tmpDir('cx-docx-render-check-');
  const src = '## Flow\n\n```mermaid\nflowchart TD\nA --> B\n```\n';
  const root = path.join(dir, 'docx');
  fs.mkdirSync(path.join(root, 'word', '_rels'), { recursive: true });
  fs.mkdirSync(path.join(root, '_rels'), { recursive: true });
  fs.writeFileSync(path.join(root, '[Content_Types].xml'), '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  fs.writeFileSync(path.join(root, '_rels', '.rels'), '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  fs.writeFileSync(path.join(root, 'word', 'document.xml'), '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>flowchart TD</w:t></w:r></w:p></w:body></w:document>');
  fs.writeFileSync(path.join(root, 'word', '_rels', 'document.xml.rels'), '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');
  const unresolved = path.join(dir, 'unresolved.docx');
  spawnSync('zip', ['-q', '-r', unresolved, '[Content_Types].xml', '_rels', 'word'], { cwd: root });
  assert.equal(docxRenderedDiagrams(unresolved, src), false);

  fs.mkdirSync(path.join(root, 'word', 'media'), { recursive: true });
  fs.writeFileSync(path.join(root, 'word', 'document.xml'), '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Rendered figure</w:t></w:r></w:p></w:body></w:document>');
  fs.writeFileSync(path.join(root, 'word', '_rels', 'document.xml.rels'), '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');
  fs.writeFileSync(path.join(root, 'word', 'media', 'image1.png'), 'png');
  const resolved = path.join(dir, 'resolved.docx');
  spawnSync('zip', ['-q', '-r', resolved, '[Content_Types].xml', '_rels', 'word'], { cwd: root });
  assert.equal(docxRenderedDiagrams(resolved, src), true);
});

test('htmlRenderedDiagrams rejects raw source and accepts rendered tags', () => {
  const dir = tmpDir('cx-html-render-check-');
  const src = '## Flow\n\n```mermaid\nflowchart TD\nA --> B\n```\n';
  const unresolved = path.join(dir, 'unresolved.html');
  const resolved = path.join(dir, 'resolved.html');
  fs.writeFileSync(unresolved, '<html><body><pre>flowchart TD A --> B</pre></body></html>');
  fs.writeFileSync(resolved, '<html><body><img src="data:image/png;base64,abc" alt="diagram"></body></html>');
  assert.equal(htmlRenderedDiagrams(unresolved, src), false);
  assert.equal(htmlRenderedDiagrams(resolved, src), true);
});

test('assessFigureResolution reports figures:unresolved when HTML keeps diagram source', () => {
  const dir = tmpDir('cx-figure-assess-');
  const src = '## Flow\n\n```mermaid\nflowchart TD\nA --> B\n```\n';
  const htmlPath = path.join(dir, 'unresolved.html');
  fs.writeFileSync(htmlPath, '<html><body><pre>flowchart TD A --> B</pre></body></html>');
  const assessment = assessFigureResolution('html', htmlPath, src);
  assert.equal(assessment.resolved, false);
  assert.equal(assessment.figuresUnresolved, true);
  assert.equal(assessment.figuresExpected, 1);
  assert.equal(assessment.figuresRendered, 0);
});

test('exportMarkdown soft-degrades figures:unresolved when figuresStrict is false', () => {
  const dir = tmpDir('cx-export-soft-figures-');
  const { dir: stubDir } = stubPandocPath('cx-export-soft-');
  stubFigureBins(stubDir);
  const inputPath = path.join(dir, 'diagrams.md');
  const outputPath = path.join(dir, 'diagrams.html');
  fs.writeFileSync(inputPath, '## Flow\n\n```mermaid\nflowchart TD\nA --> B\n```\n');
  fs.writeFileSync(outputPath, '<html><body><pre>flowchart TD A --> B</pre></body></html>');
  const env = { ...process.env, PATH: `${stubDir}:${process.env.PATH || ''}` };
  const spawnFn = (_cmd, args, opts) => {
    const oIdx = args.indexOf('-o');
    if (oIdx >= 0 && args[oIdx + 1]) {
      fs.copyFileSync(outputPath, args[oIdx + 1]);
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = exportMarkdown({
    inputPath,
    outputPath,
    format: 'html',
    figures: true,
    figuresStrict: false,
    env,
    spawnFn,
    repoRoot: REPO,
    cwd: dir,
    branding: 'plain',
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.figuresUnresolved, true);
  assert.match(result.message, /figures:unresolved/);
});
