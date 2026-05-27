/**
 * tests/intake-eml-extraction.test.mjs — .eml support for
 * `lib/document-extract.mjs#extractDocumentText`.
 *
 * Locks the contract for the customer-email-as-signal workflow:
 *   - Plain-text RFC 5322 messages produce text containing Subject, From,
 *     Date, and the body.
 *   - Multipart messages return the first text/plain part, not the html.
 *   - Attachments do not appear in the text and their filenames are exposed
 *     on the result's `attachments` array.
 *   - Messages above the 50 MB hard cap return empty text plus a `skipped`
 *     marker rather than throwing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  extractDocumentText,
  EXTRACTABLE_DOCUMENT_EXTS,
  isExtractableDocumentPath,
} from '../lib/document-extract.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eml-test-'));
}

test('.eml is registered as an extractable document type', () => {
  assert.ok(EXTRACTABLE_DOCUMENT_EXTS.has('.eml'));
  assert.ok(isExtractableDocumentPath('/some/path/customer.eml'));
});

test('plain-text RFC 5322 email produces Subject + From + Date + body', (t) => {
  const dir = mkTmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'plain.eml');
  fs.writeFileSync(file, [
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    'Subject: Checkout is broken on Safari',
    'Date: Mon, 19 May 2025 14:22:11 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hi team,',
    '',
    'Cart fails to load after the last deploy.',
    'Repro: open the site in Safari 17, add an item, click checkout.',
  ].join('\n'));

  const result = extractDocumentText(file);
  assert.equal(result.extension, '.eml');
  assert.equal(result.extractionMethod, 'eml');
  assert.match(result.text, /Subject: Checkout is broken on Safari/);
  assert.match(result.text, /From: Alice <alice@example.com>/);
  assert.match(result.text, /Date: Mon, 19 May 2025 14:22:11 \+0000/);
  assert.match(result.text, /Cart fails to load after the last deploy\./);
  assert.deepEqual(result.attachments, []);
});

test('multipart email extracts text/plain part and skips html', (t) => {
  const dir = mkTmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'multipart.eml');
  const boundary = 'BOUNDARY-123';
  fs.writeFileSync(file, [
    'From: ops@example.com',
    'Subject: Nightly digest',
    'Date: Tue, 20 May 2025 06:00:00 +0000',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'PLAIN BODY: 3 alerts overnight, all auto-resolved.',
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body><b>HTML BODY</b> 3 alerts overnight.</body></html>',
    '',
    `--${boundary}--`,
  ].join('\n'));

  const result = extractDocumentText(file);
  assert.match(result.text, /PLAIN BODY: 3 alerts overnight/);
  assert.doesNotMatch(result.text, /HTML BODY/);
  assert.doesNotMatch(result.text, /<html>/i);
});

test('email with attachment excludes attachment body and lists filename', (t) => {
  const dir = mkTmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'attach.eml');
  const boundary = 'B=ATTACH';
  const attachmentB64 = Buffer.from('attachment content payload here').toString('base64');
  fs.writeFileSync(file, [
    'From: support@example.com',
    'Subject: Logs from production crash',
    'Date: Wed, 21 May 2025 09:00:00 +0000',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'See attached logs.',
    '',
    `--${boundary}`,
    'Content-Type: application/octet-stream; name="crash.log"',
    'Content-Disposition: attachment; filename="crash.log"',
    'Content-Transfer-Encoding: base64',
    '',
    attachmentB64,
    '',
    `--${boundary}--`,
  ].join('\n'));

  const result = extractDocumentText(file);
  assert.match(result.text, /See attached logs\./);
  assert.doesNotMatch(result.text, /attachment content payload/);
  assert.deepEqual(result.attachments, ['crash.log']);
});

test('email above 50 MB hard cap returns empty text and a skipped marker', (t) => {
  const dir = mkTmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'huge.eml');
  // Build a sparse 51 MB file. The header is valid but the body is empty
  // padding; the extractor must never read past the size guard.
  const fd = fs.openSync(file, 'w');
  try {
    const header = [
      'From: noisy@example.com',
      'Subject: TOO LARGE',
      'Date: Thu, 22 May 2025 12:00:00 +0000',
      '',
      '',
    ].join('\n');
    fs.writeSync(fd, header);
    const padBytes = 51 * 1024 * 1024;
    fs.ftruncateSync(fd, padBytes);
  } finally {
    fs.closeSync(fd);
  }

  let result;
  assert.doesNotThrow(() => {
    result = extractDocumentText(file);
  });
  assert.equal(result.text, '');
  assert.equal(result.skipped, 'too large');
  assert.equal(result.extractionMethod, 'eml-skipped');
});
