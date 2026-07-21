/**
 * lib/document-extract/email-extract.mjs — mailparser-backed RFC 5322/MIME email
 * extraction (construct-tsyfe.2.7, ADR-0098). Shared by async callers and the
 * sync subprocess worker so legacy sync paths do not re-implement MIME parsing.
 */
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { makeDropInfo } from '../extractors/shared/drop-info.mjs';
import { classifyAttachments } from '../extractors/shared/attachment-policy.mjs';

export const MAX_EML_BYTES = 50 * 1024 * 1024;

const OLE_COMPOUND_FILE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_NESTED_MESSAGE_DEPTH = 3;

function normalizeText(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isOleCompoundFile(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(OLE_COMPOUND_FILE_MAGIC);
}

function makeMsgOleUnsupportedError(filePath) {
  const err = new Error(
    `${filePath}: .msg (OLE/CFBF compound-file) parsing is not supported. Convert to .eml, or use a dedicated OLE-aware tool. See docs/notes/research/2026-07-mailparser-benchmark/decision.md.`,
  );
  err.code = 'MSG_OLE_UNSUPPORTED';
  err.filePath = filePath;
  return err;
}

async function loadSimpleParser() {
  const mod = await import('mailparser');
  return mod.simpleParser;
}

async function parseNestedMessage(buffer, depth) {
  if (depth > MAX_NESTED_MESSAGE_DEPTH) return null;
  const simpleParser = await loadSimpleParser();
  const nested = await simpleParser(buffer);
  return {
    subject: nested.subject || '',
    from: nested.from?.text || '',
    date: nested.date ? nested.date.toISOString() : '',
    text: nested.text || '',
  };
}

export async function extractEmlMessageAsync(filePath, { attachmentPolicy = {} } = {}) {
  const stat = statSync(filePath);
  if (stat.size > MAX_EML_BYTES) {
    return {
      text: '',
      headers: {},
      attachments: [],
      attachmentProvenance: [],
      nestedMessages: [],
      droppedNestedCount: 0,
      skipped: 'too large',
    };
  }
  const rawBuffer = readFileSync(filePath);
  if (extname(filePath).toLowerCase() === '.msg' || isOleCompoundFile(rawBuffer)) {
    throw makeMsgOleUnsupportedError(filePath);
  }

  const simpleParser = await loadSimpleParser();
  const parsed = await simpleParser(rawBuffer);
  const subject = parsed.subject || '';
  const from = parsed.from?.text || '';
  const date = parsed.date ? parsed.date.toISOString() : '';
  const to = parsed.to?.text || '';
  const bodyText = parsed.text || '';

  const allAttachments = parsed.attachments || [];
  const nestedParts = allAttachments.filter((a) => a.contentType === 'message/rfc822');
  const plainAttachments = allAttachments.filter((a) => a.contentType !== 'message/rfc822');

  const nestedMessages = [];
  for (const part of nestedParts) {
    try {
      const nested = await parseNestedMessage(part.content, 1);
      if (nested) nestedMessages.push(nested);
    } catch { /* malformed nested envelope */ }
  }

  const { kept, provenance } = classifyAttachments(
    plainAttachments.map((a) => ({
      filename: a.filename,
      size: a.size ?? a.content?.length ?? 0,
      content: a.content,
    })),
    attachmentPolicy,
  );

  const text = normalizeText(
    `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${bodyText}`,
  );

  return {
    text,
    headers: { subject, from, date, to },
    attachments: kept.map((a) => a.sanitizedFilename),
    attachmentProvenance: provenance,
    nestedMessages,
    droppedNestedCount: nestedParts.length - nestedMessages.length,
    structured: {
      subject,
      from,
      date,
      to,
      attachments: kept.map((a) => ({ filename: a.sanitizedFilename })),
      nestedMessages,
    },
  };
}

export async function extractEmlAsync(filePath, { attachmentPolicy = {} } = {}) {
  const message = await extractEmlMessageAsync(filePath, { attachmentPolicy });
  const droppedInfo = [];
  const quarantined = (message.attachmentProvenance || []).filter((a) => a.disposition === 'quarantined');
  for (const item of quarantined) {
    droppedInfo.push(makeDropInfo({
      kind: 'attachment-quarantined',
      count: 1,
      reason: `${item.originalFilename}: ${item.quarantineReason}`,
      recoverable: false,
    }));
  }
  if ((message.attachments || []).length > 0) {
    droppedInfo.push(makeDropInfo({
      kind: 'attachment',
      count: message.attachments.length,
      reason: `Attachment bodies not extracted (filenames preserved): ${message.attachments.join(', ')}`,
      recoverable: true,
    }));
  }
  if (message.droppedNestedCount > 0) {
    droppedInfo.push(makeDropInfo({
      kind: 'nested-message',
      count: message.droppedNestedCount,
      reason: 'Nested message/rfc822 part failed to parse',
      recoverable: false,
    }));
  }
  return {
    text: message.text,
    method: message.skipped ? 'eml-skipped' : 'eml-mailparser',
    skipped: message.skipped || null,
    attachments: message.attachments,
    attachmentProvenance: message.attachmentProvenance || [],
    droppedInfo,
    structured: message.structured || null,
  };
}
