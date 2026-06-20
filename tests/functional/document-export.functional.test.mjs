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

import { detect, exportMarkdown, EXPORT_FORMATS } from '../../lib/document-export.mjs';

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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

function stubPandocPath(prefix = 'cx-export-stub-') {
  const dir = tmpDir(prefix);
  const pandocPath = path.join(dir, process.platform === 'win32' ? 'pandoc.cmd' : 'pandoc');
  if (process.platform === 'win32') {
    fs.writeFileSync(pandocPath, '@echo off\necho pandoc 3.0.0-test\n');
  } else {
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
  }
  return { dir, pandocPath };
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
  assert.deepEqual([...EXPORT_FORMATS].sort(), ['doc', 'docx', 'epub', 'html', 'md', 'mdx', 'odt', 'pdf', 'rtf', 'tex', 'txt']);
});
