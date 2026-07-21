/**
 * tests/export/html-provider.test.mjs — sanitized direct-HTML export provider (construct-tsyfe.6.6).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __hygieneTmpDirs = [];
after(() => {
  for (const dir of __hygieneTmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

import {
  makeRichDocument, makeSection, makeHtmlBlock, makeParagraphBlock, makeRun,
} from '../../lib/rich-document.mjs';
import { sanitizeExportedHtml, isDangerousUrl } from '../../lib/export/html-sanitize.mjs';
import { exportSanitizedHtml, resolveHtmlExportProviderIdentity } from '../../lib/export/html-provider.mjs';
import { validateExportProviderResult } from '../../lib/export-provider-contract.mjs';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-export-'));
  __hygieneTmpDirs.push(dir);
  return path.join(dir, 'out.html');
}

function xssFixture() {
  return makeRichDocument({ title: 'XSS fixture' }, [
    makeSection({
      id: 'hostile',
      level: 1,
      blocks: [
        makeHtmlBlock({ html: '<script>alert(1)</script>' }),
        makeHtmlBlock({ html: '<span onclick="alert(1)">click</span>' }),
        makeHtmlBlock({ html: '<a href="javascript:alert(1)">bad link</a>' }),
        makeHtmlBlock({ html: '<strong>bold</strong>' }),
        makeParagraphBlock({
          runs: [makeRun({ text: 'linked', marks: ['link'], href: 'javascript:alert(2)' })],
        }),
      ],
    }),
  ]);
}

test('sanitizeExportedHtml strips script tags, on* handlers, and javascript: hrefs', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<p onclick="alert(1)">x</p>',
    '<a href="javascript:alert(1)">x</a>',
    '<img src="data:text/html,<script>alert(1)</script>">',
  ].join('\n');
  const out = sanitizeExportedHtml(hostile);
  assert.doesNotMatch(out, /<script/i);
  assert.doesNotMatch(out, /onclick\s*=/i);
  assert.doesNotMatch(out, /javascript:/i);
  assert.doesNotMatch(out, /data:/i);
});

test('sanitizeExportedHtml preserves benign inline markup', () => {
  const out = sanitizeExportedHtml('<p><strong>bold</strong> and <a href="https://example.com">safe</a></p>');
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /href="https:\/\/example\.com"/);
});

test('isDangerousUrl flags javascript and data schemes', () => {
  assert.equal(isDangerousUrl('javascript:alert(1)'), true);
  assert.equal(isDangerousUrl('  data:text/html,abc'), true);
  assert.equal(isDangerousUrl('https://example.com'), false);
});

test('exportSanitizedHtml removes XSS constructs and keeps benign strong markup', () => {
  const target = tmpFile();
  const result = exportSanitizedHtml({ doc: xssFixture(), outputPath: target, variant: 'standalone' });
  assert.equal(result.ok, true, result.message);
  const html = fs.readFileSync(target, 'utf8');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onclick\s*=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.match(html, /<strong>bold<\/strong>/);
});

test('exportSanitizedHtml returns provider contract evidence', () => {
  const target = tmpFile();
  const result = exportSanitizedHtml({ doc: xssFixture(), outputPath: target, variant: 'fragment' });
  assert.equal(result.ok, true, result.message);
  const validation = validateExportProviderResult(result);
  assert.equal(validation.ok, true, validation.errors?.join('; '));
  assert.equal(result.provider.name, resolveHtmlExportProviderIdentity().name);
  assert.ok(result.provider.version);
  assert.match(result.contentHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Array.isArray(result.fidelity.droppedBlocks), true);
  assert.equal(typeof result.fidelity.degraded, 'boolean');
});

test('package.json has no dompurify or sanitize-html dependency', () => {
  const pkg = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  assert.doesNotMatch(pkg, /dompurify/i);
  assert.doesNotMatch(pkg, /sanitize-html/i);
});
