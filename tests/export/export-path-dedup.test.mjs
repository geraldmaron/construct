/**
 * tests/export/export-path-dedup.test.mjs — canonical export entry point audit (construct-tsyfe.6.8).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ALLOWED_EXPORT_MARKDOWN = [
  { file: 'lib/rich-document-export.mjs', reason: 'internal HTML-pivot engine path for Pandoc/Typst formats' },
  { file: 'lib/export-from-source.mjs', reason: 'markdown fallback when RichDocument construction fails' },
  { file: 'lib/document-export.mjs', reason: 'exportMarkdown definition and recursive docx helper' },
];

const TEST_OR_SCRIPT_PREFIXES = ['tests/', 'scripts/', 'examples/'];

function grepExportMarkdownCallSites(rootDir) {
  const hits = [];
  const scanDirs = ['lib', 'bin'];
  for (const dir of scanDirs) {
    const base = path.join(rootDir, dir);
    for (const file of walk(base)) {
      if (!file.endsWith('.mjs')) continue;
      const rel = path.relative(rootDir, file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (/\bexportMarkdown\s*\(/.test(line)) {
          hits.push({ file: rel, line: index + 1, text: trimmed });
        }
      });
    }
  }
  return hits;
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test('production lib/ and bin/ call sites use exportFromSource or internal rich-document-export path', () => {
  const hits = grepExportMarkdownCallSites(REPO);
  const production = hits.filter((hit) => !TEST_OR_SCRIPT_PREFIXES.some((prefix) => hit.file.startsWith(prefix)));
  for (const hit of production) {
    const allowed = ALLOWED_EXPORT_MARKDOWN.some((entry) => hit.file === entry.file);
    assert.ok(allowed, `${hit.file}:${hit.line} calls exportMarkdown outside allowed internal paths: ${hit.text}`);
  }
});

test('exportMarkdown header documents internal-only status', () => {
  const source = fs.readFileSync(path.join(REPO, 'lib/document-export.mjs'), 'utf8');
  assert.match(source, /internal\/low-level helper/i);
  assert.match(source, /exportFromSource\(\)/);
  assert.match(source, /exportRichDocument\(\)/);
});
