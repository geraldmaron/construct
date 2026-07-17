/**
 * tests/intake-eml-extraction.test.mjs — .eml support for
 * `lib/document-extract.mjs#extractDocumentText` and the mailparser-backed
 * async path (`extractEmlMessageAsync`/`extractEmlAsync`, construct-tsyfe.2.7).
 *
 * Locks the contract for the customer-email-as-signal workflow:
 *   - Plain-text RFC 5322 messages produce text containing Subject, From,
 *     Date, and the body.
 *   - Multipart messages return the first text/plain part, not the html.
 *   - Attachments do not appear in the text and their filenames are exposed
 *     on the result's `attachments` array.
 *   - Messages above the 50 MB hard cap return empty text plus a `skipped`
 *     marker rather than throwing.
 *   - The async path decodes RFC 2047 headers, recovers HTML-only bodies,
 *     recurses into nested message/rfc822 forwards, quarantines
 *     oversized/zip-bomb-suspect attachments and sanitizes unsafe filenames
 *     (construct-tsyfe.2.7 acceptance criteria 1-4), and both the sync and
 *     async paths fail loud on `.msg`/OLE input instead of mis-decoding it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  extractDocumentText,
  extractEmlMessageAsync,
  extractEmlAsync,
  EXTRACTABLE_DOCUMENT_EXTS,
  isExtractableDocumentPath,
} from '../lib/document-extract.mjs';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'email-mime');

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

test('AC4: baseline clean email extracts fully via the mailparser-backed async path', async () => {
  const result = await extractEmlAsync(path.join(FIXTURE_DIR, '01-plain-text.eml'));
  assert.equal(result.method, 'eml-mailparser');
  assert.match(result.text, /Subject: Quarterly numbers attached/);
  assert.match(result.text, /Nothing surprising this quarter/);
  assert.deepEqual(result.attachments, []);
  assert.deepEqual(result.droppedInfo, []);
});

test('async path decodes RFC 2047 encoded-word headers the sync parser leaves raw', async () => {
  const message = await extractEmlMessageAsync(path.join(FIXTURE_DIR, '05-encoded-header-subject.eml'));
  assert.match(message.headers.subject, /École: café project — résumé attached/);
  assert.match(message.headers.from, /Renée Dupont/);
});

test('async path recovers HTML-only bodies the sync parser drops with no plain-text fallback', async () => {
  const message = await extractEmlMessageAsync(path.join(FIXTURE_DIR, '02-html-only.eml'));
  assert.match(message.text, /weekly digest/i);
  assert.doesNotMatch(message.text, /<html>/i);
});

test('async path recurses into a nested message/rfc822 forward instead of dropping it with zero signal', async () => {
  const message = await extractEmlMessageAsync(path.join(FIXTURE_DIR, '06-nested-forward.eml'));
  assert.equal(message.droppedNestedCount, 0);
  assert.equal(message.nestedMessages.length, 1);
  assert.match(message.nestedMessages[0].subject, /Original: budget approval/);
  assert.match(message.nestedMessages[0].text, /Approved, go ahead with the Q3 budget/);
});

test('.msg/OLE input fails loud with a typed error instead of mis-decoding the binary as text', async () => {
  const fixture = path.join(FIXTURE_DIR, '07-synthetic-ole.msg');
  assert.throws(() => extractDocumentText(fixture), (err) => err.code === 'MSG_OLE_UNSUPPORTED');
  await assert.rejects(() => extractEmlAsync(fixture), (err) => err.code === 'MSG_OLE_UNSUPPORTED');
});

test('AC1: an oversized attachment is quarantined and the rest of the message still extracts', async () => {
  const result = await extractEmlAsync(path.join(FIXTURE_DIR, '04-multipart-attachment.eml'), {
    attachmentPolicy: { maxAttachmentBytes: 10 },
  });
  assert.match(result.text, /See the attached report/);
  assert.deepEqual(result.attachments, [], 'the oversized attachment is withheld, not kept');
  assert.equal(result.attachmentProvenance.length, 1);
  assert.equal(result.attachmentProvenance[0].disposition, 'quarantined');
  assert.match(result.attachmentProvenance[0].quarantineReason, /exceeds the 10-byte per-attachment limit/);
  assert.ok(result.droppedInfo.some((d) => d.kind === 'attachment-quarantined'));
});

test('AC2: a path-traversal attachment filename is sanitized before any filesystem write', async () => {
  const result = await extractEmlAsync(path.join(FIXTURE_DIR, '08-attachment-path-traversal.eml'));
  assert.deepEqual(result.attachments, ['passwd'], 'traversal sequence and directory components are stripped');
  assert.ok(!result.attachments.some((name) => name.includes('..') || name.includes('/')));
  assert.equal(result.attachmentProvenance[0].filenameSanitized, true);
  assert.equal(result.attachmentProvenance[0].originalFilename, '../../../../etc/passwd');
});

test('AC3: an attachment at/over the zip-bomb ratio threshold is refused, not silently expanded', async () => {
  const result = await extractEmlAsync(path.join(FIXTURE_DIR, '09-zip-bomb-suspect.eml'));
  assert.deepEqual(result.attachments, []);
  assert.equal(result.attachmentProvenance[0].disposition, 'quarantined');
  assert.match(result.attachmentProvenance[0].quarantineReason, /zip-bomb threshold/);
});
