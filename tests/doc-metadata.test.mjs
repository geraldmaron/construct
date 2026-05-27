/**
 * tests/doc-metadata.test.mjs — extractDocumentMetadata from various formats.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { extractDocumentMetadata } from '../lib/document-extract.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-docmeta-'));
  tmpDirs.push(dir);
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}

test('extracts title and authors from markdown frontmatter', () => {
  const f = tmpFile('readme.md', [
    '---',
    'title: Architecture Guide',
    'author: Jane Doe',
    'date: 2026-01-15',
    '---',
    '',
    '# Architecture Guide',
    '',
    'Some content with a link: https://example.com/docs',
  ].join('\n'));
  const meta = extractDocumentMetadata(f);
  assert.equal(meta.title, 'Architecture Guide');
  assert.deepEqual(meta.authors, ['Jane Doe']);
  assert.equal(meta.dates.date, '2026-01-15');
  assert.ok(meta.links.includes('https://example.com/docs'));
});

test('falls back to H1 when no frontmatter title', () => {
  const f = tmpFile('notes.md', '# My Project Notes\n\nSome text.\n');
  const meta = extractDocumentMetadata(f);
  assert.equal(meta.title, 'My Project Notes');
});

test('falls back to filename when no title found', () => {
  const f = tmpFile('some-doc.txt', 'Just plain text.\n');
  const meta = extractDocumentMetadata(f);
  assert.equal(meta.title, 'some doc');
});

test('extracts multiple authors from array frontmatter', () => {
  const f = tmpFile('multi.md', [
    '---',
    'authors: [Alice, Bob, Charlie]',
    '---',
    '',
    '# Team doc',
  ].join('\n'));
  const meta = extractDocumentMetadata(f);
  assert.deepEqual(meta.authors, ['Alice', 'Bob', 'Charlie']);
});

test('returns file dates for non-text files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-docmeta-'));
  tmpDirs.push(dir);
  const f = path.join(dir, 'data.pdf');
  fs.writeFileSync(f, 'fake pdf content');
  const meta = extractDocumentMetadata(f);
  assert.ok(meta.dates.modified);
  assert.ok(meta.dates.created);
  assert.equal(meta.title, 'data');
});

test('returns error for missing file', () => {
  const meta = extractDocumentMetadata('/tmp/nonexistent-cx-test-file.md');
  assert.equal(meta.error, 'file not found');
});

test('deduplicates extracted links', () => {
  const f = tmpFile('links.md', [
    '# Links',
    '',
    'See https://example.com and also https://example.com again.',
    'And https://other.com too.',
  ].join('\n'));
  const meta = extractDocumentMetadata(f);
  assert.equal(meta.links.filter((l) => l === 'https://example.com').length, 1);
  assert.ok(meta.links.includes('https://other.com'));
});
