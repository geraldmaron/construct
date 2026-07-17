/**
 * lib/document-extract.mjs — shared local document extraction for retrieval and MCP reads.
 *
 * Two extraction paths:
 *   - Async (preferred): `extractDocumentTextAsync` routes PDF/Office/HTML
 *     through the docling Python sidecar, audio/video through whisper.cpp, and
 *     .eml/.msg through the mailparser-backed `extractEmlAsync` (RFC 2047
 *     header decoding, nested message/rfc822 recursion, attachment
 *     quarantine/provenance — construct-tsyfe.2.7). Returns { text, markdown,
 *     metadata, droppedInfo, ... }.
 *   - Sync (legacy): `extractDocumentText` for text/transcript/calendar; email
 *     falls back to the hand-rolled `extractEml` here only for callers that
 *     cannot await (e.g. lib/distill.mjs's synchronous file sampler) and does
 *     not get RFC 2047/nested-message/attachment-policy handling. PDF/Office
 *     zip formats require docling or the node-native unpdf/mammoth path.
 *
 * `extractDocumentMetadata` returns frontmatter + title/authors/dates.
 *
 * All paths return droppedInfo as { kind, count, reason, recoverable }[] so
 * info loss is observable rather than silent.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { simpleParser } from 'mailparser';
import { makeDropInfo } from './extractors/shared/drop-info.mjs';
import { extractTranscript } from './extractors/transcript.mjs';
import { extractCalendar } from './extractors/calendar.mjs';
import { classifyAttachments } from './extractors/shared/attachment-policy.mjs';

// 50 MB hard cap mirrors lib/embed/inbox.mjs and lib/observation-store.mjs.
// Anything larger is intentionally not extracted to keep the daemon path
// bounded; callers receive an empty text plus a `skipped` marker.
const MAX_EML_BYTES = 50 * 1024 * 1024;

// .msg is an OLE/CFBF compound-file container, not RFC 5322/MIME text; neither
// the hand-rolled parser nor mailparser understands that binary format
// (docs/notes/research/2026-07-mailparser-benchmark/decision.md). Detecting the
// signature up front turns the prior silent mis-decode into a typed, catchable
// error rather than returning garbled replacement-character text.
const OLE_COMPOUND_FILE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MAX_NESTED_MESSAGE_DEPTH = 3;

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

export const UTF8_TEXT_EXTS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.sh', '.bash',
  '.html', '.css', '.csv', '.tsv', '.xml', '.env', '.env.example', '.conf', '.ini', '.tf', '.hcl',
  '.sql', '.log',
]);

// Transcript formats — routed to lib/extractors/transcript.mjs for structured extraction.
export const TRANSCRIPT_EXTS = new Set(['.vtt', '.srt', '.lrc', '.transcript']);

// Calendar formats — routed to lib/extractors/calendar.mjs.
export const CALENDAR_EXTS = new Set(['.ics']);

// Audio/video formats — inbox-compatible but require ASR; extractDocumentText
// throws { code: 'ASR_REQUIRED' } so callers can route to needs-asr/ queue.
export const AUDIO_VIDEO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.ogg', '.webm', '.m4v']);

export const ZIP_DOCUMENT_EXTS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp']);

// Office zip formats with no Node-native backend require docling.
const OFFICE_REQUIRES_DOCLING_EXTS = new Set(['.xlsx', '.pptx', '.odt', '.ods', '.odp']);

function makeOfficeRequiresDoclingError(extension) {
  const err = new Error(
    `${extension} extraction requires docling. Run \`construct install --with-docling\` or use high-fidelity ingest.`,
  );
  err.code = 'OFFICE_REQUIRES_DOCLING';
  err.extension = extension;
  return err;
}

function makePdfRequiresDoclingError() {
  const err = new Error(
    'PDF extraction requires docling or the node-native unpdf backend. Run `construct install --with-docling` or ensure unpdf is installed.',
  );
  err.code = 'PDF_REQUIRES_DOCLING';
  return err;
}
function makeImageRequiresDoclingError(extension) {
  const err = new Error(
    `${extension} image extraction requires docling vision support. Run \`construct install --with-docling\` or use high-fidelity ingest.`,
  );
  err.code = 'IMAGE_REQUIRES_DOCLING';
  err.extension = extension;
  return err;
}
export const RICH_TEXT_EXTS = new Set(['.doc', '.rtf']);
export const MDLS_DOCUMENT_EXTS = new Set(['.xls', '.ppt', '.pages', '.numbers', '.key']);
export const EMAIL_DOCUMENT_EXTS = new Set(['.eml', '.msg']);
export const IMAGE_DOCUMENT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);
export const EXTRACTABLE_DOCUMENT_EXTS = new Set([
  ...UTF8_TEXT_EXTS,
  ...TRANSCRIPT_EXTS,
  ...CALENDAR_EXTS,
  ...AUDIO_VIDEO_EXTS,
  ...ZIP_DOCUMENT_EXTS,
  ...RICH_TEXT_EXTS,
  ...MDLS_DOCUMENT_EXTS,
  ...EMAIL_DOCUMENT_EXTS,
  ...IMAGE_DOCUMENT_EXTS,
  '.pdf',
]);


function normalizeText(value) {
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripMarkup(value) {
  return normalizeText(
    decodeXmlEntities(String(value))
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<\/(?:w:p|text:p|table:table-row|tr|p|div|h\d)>/g, '\n')
      .replace(/<\/(?:w:tc|table:table-cell|td)>/g, '\t')
      .replace(/<[^>]+>/g, ' ')
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout;
}

function commandExists(command) {
  // Test seam: a comma-separated deny-list forces a command to read as absent,
  // so the cross-platform fallbacks (e.g. RTF stripping without macOS textutil)
  // are reachable on any host.
  const denied = (process.env.CONSTRUCT_EXTRACT_NO_COMMANDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (denied.includes(command)) return false;
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(checker, [command], { stdio: 'ignore' }).status === 0;
}

function extractUtf8(filePath, extension) {
  const raw = readFileSync(filePath, 'utf8');
  const text = extension === '.html' || extension === '.xml'
    ? stripMarkup(raw)
    : normalizeText(raw);
  return { text, method: 'utf8', droppedInfo: [], structured: null };
}

// Minimal RTF-to-text: strip control words, groups, and escapes. RTF is a
// text format, so this works everywhere; it is the cross-platform fallback when
// textutil (macOS only) is absent. Lossy on complex documents, but never throws.
export function rtfToText(raw) {
  let s = String(raw);
  s = s.replace(/\{(?:\\\*)?\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[\s\S]*?\}/gi, '');
  s = s.replace(/\\u(-?\d+)\s?\??/g, (_, n) => (Number(n) >= 0 ? String.fromCharCode(Number(n)) : ''));
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\par[d]?\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\tab\b/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
  s = s.replace(/\\([{}\\])/g, '$1');
  return s.replace(/[{}]/g, '');
}

function extractRichText(filePath, extension) {
  if (commandExists('textutil')) {
    return {
      text: normalizeText(run('textutil', ['-convert', 'txt', '-stdout', filePath])),
      method: 'textutil',
      droppedInfo: [],
      structured: null,
    };
  }
  if (extension === '.rtf') {
    return {
      text: normalizeText(rtfToText(readFileSync(filePath, 'utf8'))),
      method: 'rtf-strip',
      droppedInfo: [],
      structured: null,
    };
  }
  throw new Error('textutil not available for rich-text extraction');
}

function extractWithMdls(filePath) {
  const text = normalizeText(run('mdls', ['-raw', '-name', 'kMDItemTextContent', filePath]));
  if (!text || text === '(null)') throw new Error('Spotlight text extraction unavailable');
  return text;
}

export function isExtractableDocumentPath(filePath) {
  return EXTRACTABLE_DOCUMENT_EXTS.has(extname(filePath).toLowerCase());
}

// Minimal RFC 5322 header decoder. Unfolds continuation lines (a line that
// begins with whitespace continues the previous header) and splits each
// header into (name, value). Stops at the first blank line, which RFC 5322
// defines as the header/body separator.
function parseRfc5322Headers(headerBlock) {
  const lines = headerBlock.split('\n');
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += ' ' + line.trim();
    } else {
      unfolded.push(line);
    }
  }
  const headers = {};
  for (const line of unfolded) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!name) continue;
    // Multiple Received headers are common; keep the first occurrence of
    // any header so From/Subject/Date pick the outermost value.
    if (!(name in headers)) headers[name] = value;
  }
  return headers;
}

// Split a Content-Type header value into the bare type and a parameter map.
// Returns { type, params } where type is lowercased and stripped, params is
// keyed by lowercased name with values stripped of surrounding quotes.
function parseContentType(value) {
  if (!value) return { type: '', params: {} };
  const parts = value.split(';').map((s) => s.trim()).filter(Boolean);
  const type = (parts.shift() || '').toLowerCase();
  const params = {};
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    let v = part.slice(idx + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    params[k] = v;
  }
  return { type, params };
}

// Split a multipart body on the boundary marker. Each returned segment is
// itself a mini MIME entity (its own header block, blank line, body). The
// closing `--boundary--` terminator is honored by stripping anything past
// it. Boundaries that do not appear in the body produce a single segment.
function splitMultipart(body, boundary) {
  if (!boundary) return [body];
  const marker = '--' + boundary;
  const closer = marker + '--';
  const closeIdx = body.indexOf(closer);
  const scoped = closeIdx === -1 ? body : body.slice(0, closeIdx);
  const segments = scoped.split(marker);
  // The piece before the first boundary is the preamble; discard it.
  return segments.slice(1).map((seg) => seg.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
}

// Decode a quoted-printable body. Tolerant: malformed `=XX` sequences are
// passed through verbatim rather than throwing, which matches real-world
// mailers more closely than a strict decoder.
function decodeQuotedPrintable(text) {
  return text
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeTransferEncoded(text, encoding) {
  const enc = String(encoding || '').toLowerCase();
  if (enc === 'quoted-printable') return decodeQuotedPrintable(text);
  if (enc === 'base64') {
    try { return Buffer.from(text.replace(/\s+/g, ''), 'base64').toString('utf8'); } catch { return text; }
  }
  return text;
}

// Walk a parsed MIME entity, returning the first text/plain body it finds,
// a flat list of attachment filenames, and counts of dropped HTML parts and
// inline images. The walker stops at depth 8 so a hand-crafted pathological
// message cannot exhaust the stack.
function walkMimeForPlainText(rawEntity, depth = 0) {
  if (depth > 8) return { text: '', attachments: [], droppedHtmlParts: 0, droppedImages: 0 };
  const sepIdx = rawEntity.indexOf('\n\n') !== -1
    ? rawEntity.indexOf('\n\n')
    : rawEntity.indexOf('\r\n\r\n');
  if (sepIdx === -1) return { text: '', attachments: [], droppedHtmlParts: 0, droppedImages: 0 };
  const headerBlock = rawEntity.slice(0, sepIdx);
  const body = rawEntity.slice(sepIdx).replace(/^\r?\n\r?\n/, '');
  const headers = parseRfc5322Headers(headerBlock);
  const { type, params } = parseContentType(headers['content-type'] || 'text/plain');
  const disposition = parseContentType(headers['content-disposition'] || '');
  const filename = disposition.params.filename || params.name || null;

  if (type.startsWith('multipart/')) {
    const attachments = [];
    let firstPlain = '';
    let droppedHtmlParts = 0;
    let droppedImages = 0;
    for (const seg of splitMultipart(body, params.boundary)) {
      const child = walkMimeForPlainText(seg, depth + 1);
      attachments.push(...child.attachments);
      droppedHtmlParts += child.droppedHtmlParts;
      droppedImages += child.droppedImages;
      if (!firstPlain && child.text) firstPlain = child.text;
    }
    return { text: firstPlain, attachments, droppedHtmlParts, droppedImages };
  }

  if (disposition.type === 'attachment' && filename) {
    return { text: '', attachments: [filename], droppedHtmlParts: 0, droppedImages: 0 };
  }

  if (type === '' || type === 'text/plain') {
    return {
      text: decodeTransferEncoded(body, headers['content-transfer-encoding']),
      attachments: [],
      droppedHtmlParts: 0,
      droppedImages: 0,
    };
  }

  // HTML body part that would be useful if plain/text was absent
  if (type === 'text/html') {
    return { text: '', attachments: [], droppedHtmlParts: 1, droppedImages: 0 };
  }

  // Inline images (image/* with no attachment disposition)
  if (type.startsWith('image/') && disposition.type !== 'attachment') {
    return { text: '', attachments: [], droppedHtmlParts: 0, droppedImages: 1 };
  }

  // Non-plain leaves with an explicit filename are treated as attachments.
  if (filename) return { text: '', attachments: [filename], droppedHtmlParts: 0, droppedImages: 0 };
  return { text: '', attachments: [], droppedHtmlParts: 0, droppedImages: 0 };
}

/**
 * Extract a normalized representation of an .eml message using the hand-rolled
 * RFC 5322/MIME parser. This is the legacy sync path (lib/distill.mjs's
 * synchronous file sampler is the only production caller reachable through
 * `extractDocumentText`'s sync dispatch; new code should get email through
 * `extractEmlMessageAsync`/`extractEmlAsync` instead, which route through
 * mailparser with RFC 2047 decoding, nested-message recursion, and attachment
 * quarantine/provenance per construct-tsyfe.2.7).
 *
 * Returns { text, headers, attachments, skipped } where:
 *   text         concatenates Subject, From, Date and the first text/plain
 *                body, suitable for direct hand-off to the classifier.
 *   headers      decoded From, Subject, Date, To (raw strings).
 *   attachments  filenames of every non-plain part with a Content-Disposition
 *                of `attachment` or a filename parameter. Bodies are skipped.
 *   skipped      set to `'too large'` if the message exceeded MAX_EML_BYTES;
 *                in that case text is empty and no parsing was attempted.
 *
 * Throws a typed `MSG_OLE_UNSUPPORTED` error for `.msg`/OLE-signature input
 * rather than mis-decoding the binary container as UTF-8 text. For anything
 * else, the parser is intentionally minimal: it understands header folding,
 * the `--boundary` framing of multipart messages, and quoted-printable /
 * base64 transfer encodings. It does not decode RFC 2047 encoded-word
 * headers, does not chase nested message/rfc822 envelopes, and does not
 * validate signatures.
 */
export function extractEmlMessage(filePath) {
  const stat = statSync(filePath);
  if (stat.size > MAX_EML_BYTES) {
    return { text: '', headers: {}, attachments: [], skipped: 'too large' };
  }
  const rawBuffer = readFileSync(filePath);
  if (extname(filePath).toLowerCase() === '.msg' || isOleCompoundFile(rawBuffer)) {
    throw makeMsgOleUnsupportedError(filePath);
  }
  const raw = rawBuffer.toString('utf8').replace(/\r\n/g, '\n');
  const sepIdx = raw.indexOf('\n\n');
  if (sepIdx === -1) {
    // No header/body separator. Treat the whole file as the body.
    return {
      text: normalizeText(raw),
      headers: {},
      attachments: [],
    };
  }
  const headerBlock = raw.slice(0, sepIdx);
  const body = raw.slice(sepIdx + 2);
  const headers = parseRfc5322Headers(headerBlock);
  const { type, params } = parseContentType(headers['content-type'] || 'text/plain');

  let bodyText = '';
  const attachments = [];
  let droppedHtmlParts = 0;
  let droppedImages = 0;
  if (type.startsWith('multipart/')) {
    for (const seg of splitMultipart(body, params.boundary)) {
      const child = walkMimeForPlainText(seg);
      attachments.push(...child.attachments);
      droppedHtmlParts += child.droppedHtmlParts;
      droppedImages += child.droppedImages;
      if (!bodyText && child.text) bodyText = child.text;
    }
  } else {
    bodyText = decodeTransferEncoded(body, headers['content-transfer-encoding']);
    if (type === 'text/html') droppedHtmlParts++;
  }

  const subject = headers.subject || '';
  const from = headers.from || '';
  const date = headers.date || '';
  const to = headers.to || '';
  const text = normalizeText(
    `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${bodyText}`,
  );
  return {
    text,
    headers: { subject, from, date, to },
    attachments,
    droppedHtmlParts,
    droppedImages,
    structured: {
      subject,
      from,
      date,
      to,
      attachments: attachments.map((name) => ({ filename: name })),
    },
  };
}

function extractEml(filePath) {
  const message = extractEmlMessage(filePath);
  const droppedInfo = [];
  if ((message.droppedHtmlParts || 0) > 0) {
    droppedInfo.push(makeDropInfo({ kind: 'html-part', count: message.droppedHtmlParts, reason: 'HTML email body parts not included (plain-text preferred)', recoverable: true }));
  }
  if ((message.droppedImages || 0) > 0) {
    droppedInfo.push(makeDropInfo({ kind: 'inline-image', count: message.droppedImages, reason: 'Inline images from multipart/related not extracted', recoverable: true }));
  }
  if ((message.attachments || []).length > 0) {
    droppedInfo.push(makeDropInfo({ kind: 'attachment', count: message.attachments.length, reason: `Attachment bodies not extracted (filenames preserved): ${message.attachments.join(', ')}`, recoverable: true }));
  }
  return {
    text: message.text,
    method: message.skipped ? 'eml-skipped' : 'eml',
    skipped: message.skipped || null,
    attachments: message.attachments,
    droppedInfo,
    structured: message.structured || null,
  };
}

// Re-parses a message/rfc822 attachment's raw bytes to recover the nested
// envelope mailparser exposes but does not auto-flatten. depth bounds
// recursion so a maliciously self-nesting forward chain cannot recurse
// unbounded; MAX_NESTED_MESSAGE_DEPTH mirrors the hand-rolled walker's own
// depth guard in spirit (walkMimeForPlainText caps at 8 MIME parts, this caps
// at 3 nested envelopes, since each level re-invokes a full parse).

async function parseNestedMessage(buffer, depth) {
  if (depth > MAX_NESTED_MESSAGE_DEPTH) return null;
  const nested = await simpleParser(buffer);
  return {
    subject: nested.subject || '',
    from: nested.from?.text || '',
    date: nested.date ? nested.date.toISOString() : '',
    text: nested.text || '',
  };
}

/**
 * Extract a normalized representation of an .eml message via mailparser
 * (construct-tsyfe.2.7, adopt-and-migrate decision:
 * docs/notes/research/2026-07-mailparser-benchmark/decision.md). This is the
 * preferred email path: RFC 2047 encoded-word headers decode natively,
 * HTML-only bodies recover through mailparser's built-in html-to-text
 * fallback, and nested message/rfc822 parts are recursively re-parsed rather
 * than silently dropped. Attachments go through
 * lib/extractors/shared/attachment-policy.mjs's classifyAttachments for
 * size/count/filename-safety/zip-bomb disposition before any content is kept.
 *
 * Returns { text, headers, attachments, attachmentProvenance, nestedMessages,
 * droppedNestedCount, structured, skipped }. Throws MSG_OLE_UNSUPPORTED for
 * `.msg`/OLE-signature input, matching the sync `extractEmlMessage` guard.
 */
export async function extractEmlMessageAsync(filePath, { attachmentPolicy = {} } = {}) {
  const stat = statSync(filePath);
  if (stat.size > MAX_EML_BYTES) {
    return { text: '', headers: {}, attachments: [], attachmentProvenance: [], nestedMessages: [], droppedNestedCount: 0, skipped: 'too large' };
  }
  const rawBuffer = readFileSync(filePath);
  if (extname(filePath).toLowerCase() === '.msg' || isOleCompoundFile(rawBuffer)) {
    throw makeMsgOleUnsupportedError(filePath);
  }

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
    } catch { /* malformed nested envelope: counted in droppedNestedCount, not thrown */ }
  }

  const { kept, provenance } = classifyAttachments(
    plainAttachments.map((a) => ({ filename: a.filename, size: a.size ?? a.content?.length ?? 0, content: a.content })),
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

/**
 * mailparser-backed counterpart to `extractEml`, producing the same
 * { text, method, skipped, attachments, droppedInfo, structured } envelope
 * plus `attachmentProvenance` (quarantine/sanitization audit trail consumed by
 * lib/document-ingest.mjs's `.quarantine.json` sidecar). `extractionMethod`
 * reads 'eml-mailparser' so callers can distinguish this path from the legacy
 * sync 'eml'.
 */
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
    droppedInfo.push(makeDropInfo({ kind: 'attachment', count: message.attachments.length, reason: `Attachment bodies not extracted (filenames preserved): ${message.attachments.join(', ')}`, recoverable: true }));
  }
  if (message.droppedNestedCount > 0) {
    droppedInfo.push(makeDropInfo({ kind: 'nested-message', count: message.droppedNestedCount, reason: 'Nested message/rfc822 part failed to parse', recoverable: false }));
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

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const URL_RE = /https?:\/\/[^\s)>\]"'`]+/g;
const DATE_KEYS = ['date', 'created', 'created_at', 'updated', 'updated_at', 'published', 'last_modified'];
const AUTHOR_KEYS = ['author', 'authors', 'by', 'contributor', 'contributors'];

function parseFrontmatter(text) {
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { fields: {}, body: text };
  const fields = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    if (val.startsWith('[') && val.endsWith(']')) {
      fields[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      fields[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { fields, body: text.slice(match[0].length) };
}

function extractTitleFromBody(body, extension) {
  if (['.md', '.mdx', '.rst', '.adoc'].includes(extension)) {
    const h1 = body.match(/^#\s+(.+)/m);
    if (h1) return h1[1].trim();
  }
  if (['.html', '.xml'].includes(extension)) {
    const title = body.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title) return normalizeText(title[1]);
  }
  return null;
}

export function extractDocumentMetadata(filePath) {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) return { error: 'file not found' };

  const extension = extname(resolvedPath).toLowerCase();
  const stat = statSync(resolvedPath);
  const result = { filePath: resolvedPath, extension, title: null, frontmatter: {}, authors: [], dates: {}, links: [] };

  if (!UTF8_TEXT_EXTS.has(extension)) {
    result.title = basename(resolvedPath).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    result.dates.modified = new Date(stat.mtimeMs).toISOString();
    result.dates.created = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
    return result;
  }

  const raw = readFileSync(resolvedPath, 'utf8');
  const { fields, body } = parseFrontmatter(raw);
  result.frontmatter = fields;

  result.title = fields.title || extractTitleFromBody(body, extension) || basename(resolvedPath).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

  for (const key of AUTHOR_KEYS) {
    if (fields[key]) {
      result.authors = Array.isArray(fields[key]) ? fields[key] : [fields[key]];
      break;
    }
  }

  for (const key of DATE_KEYS) {
    if (fields[key]) result.dates[key] = fields[key];
  }
  if (!Object.keys(result.dates).length) {
    result.dates.modified = new Date(stat.mtimeMs).toISOString();
    result.dates.created = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
  }

  const urls = body.match(URL_RE) || [];
  result.links = [...new Set(urls)].slice(0, 100);

  return result;
}

export function extractDocumentText(filePath, { maxChars = null } = {}) {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);

  const extension = extname(resolvedPath).toLowerCase();
  if (!EXTRACTABLE_DOCUMENT_EXTS.has(extension)) {
    throw new Error(`Unsupported document type: ${extension || 'unknown'}`);
  }

  // Audio and video files cannot be text-extracted without ASR.
  // Throw a typed error so callers can route to .construct/intake/needs-asr/.
  if (AUDIO_VIDEO_EXTS.has(extension)) {
    const err = new Error(
      `Audio/video extraction requires ASR. Install a local whisper ASR (brew install whisper-cpp). See docs/guides/intake/audio-video.md.`,
    );
    err.code = 'ASR_REQUIRED';
    err.extension = extension;
    throw err;
  }

  let extracted;
  if (UTF8_TEXT_EXTS.has(extension)) {
    extracted = extractUtf8(resolvedPath, extension);
  } else if (TRANSCRIPT_EXTS.has(extension)) {
    // Transcript formats return the full { text, structured, droppedInfo } envelope.
    const envelope = extractTranscript(resolvedPath);
    extracted = { text: envelope.text, method: 'transcript', droppedInfo: envelope.droppedInfo, structured: envelope.structured };
  } else if (CALENDAR_EXTS.has(extension)) {
    const envelope = extractCalendar(resolvedPath);
    extracted = { text: envelope.text, method: 'ics', droppedInfo: envelope.droppedInfo, structured: envelope.structured };
  } else if (ZIP_DOCUMENT_EXTS.has(extension)) {
    throw makeOfficeRequiresDoclingError(extension);
  } else if (IMAGE_DOCUMENT_EXTS.has(extension)) {
    throw makeImageRequiresDoclingError(extension);
  } else if (RICH_TEXT_EXTS.has(extension)) {
    extracted = extractRichText(resolvedPath, extension);
  } else if (MDLS_DOCUMENT_EXTS.has(extension) && process.platform === 'darwin' && commandExists('mdls')) {
    extracted = { text: extractWithMdls(resolvedPath), method: 'mdls', droppedInfo: [], structured: null };
  } else if (EMAIL_DOCUMENT_EXTS.has(extension)) {
    extracted = extractEml(resolvedPath);
  } else if (extension === '.pdf') {
    throw makePdfRequiresDoclingError();
  } else {
    throw new Error(`Unsupported document type: ${extension || 'unknown'}`);
  }

  return buildExtractionResult(resolvedPath, extension, extracted, maxChars);
}

// Shared envelope construction so the sync, async, and Node-native paths emit
// an identical result shape (callers route on extractionMethod and droppedInfo).

function buildExtractionResult(resolvedPath, extension, extracted, maxChars) {
  const text = extracted.text;
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Math.min(Number(maxChars), 200_000)
    : null;
  const truncated = limit !== null && text.length > limit;

  const result = {
    filePath: resolvedPath,
    extension,
    extractionMethod: extracted.method,
    text: truncated ? `${text.slice(0, limit)}\n` : text,
    truncated,
    characters: text.length,
    droppedInfo: extracted.droppedInfo ?? [],
    structured: extracted.structured ?? null,
  };

  // Surface eml-specific metadata so callers (intake, ingest) can route
  // attachment filenames and oversize-skip markers without re-parsing.

  if (extracted.attachments) result.attachments = extracted.attachments;
  if (extracted.attachmentProvenance) result.attachmentProvenance = extracted.attachmentProvenance;
  if (extracted.skipped) result.skipped = extracted.skipped;
  return result;
}

// Node-native extraction for the everyday adapter path: unpdf (PDF) and mammoth
// (DOCX) are optional pure-JS deps. XLSX/PPTX/ODT/ODS have no Node backend and
// fail loud with OFFICE_REQUIRES_DOCLING. Legacy zip-xml and pdftotext paths run
// only when CONSTRUCT_ALLOW_LEGACY_EXTRACT=1; otherwise extraction errors clearly.

async function extractWithUnpdf(filePath) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const proxy = await getDocumentProxy(new Uint8Array(readFileSync(filePath)));
  const { text } = await extractText(proxy, { mergePages: true });
  return normalizeText(typeof text === 'string' ? text : (Array.isArray(text) ? text.join('\n') : ''));
}

async function extractWithMammoth(filePath) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ path: filePath });
  return normalizeText(value || '');
}

export async function extractDocumentTextNodeNative(filePath, { maxChars = null } = {}) {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);
  const extension = extname(resolvedPath).toLowerCase();

  if (OFFICE_REQUIRES_DOCLING_EXTS.has(extension)) {
    throw makeOfficeRequiresDoclingError(extension);
  }

  const nodeBackend = extension === '.pdf' ? { fn: extractWithUnpdf, method: 'unpdf' }
    : extension === '.docx' ? { fn: extractWithMammoth, method: 'mammoth' }
      : null;

  if (nodeBackend) {
    try {
      const text = await nodeBackend.fn(resolvedPath);
      if (text) {
        return buildExtractionResult(resolvedPath, extension, { text, method: nodeBackend.method, droppedInfo: [], structured: null }, maxChars);
      }
    } catch { /* optional dep absent or parse failure */ }
    if (extension === '.docx') throw makeOfficeRequiresDoclingError(extension);
    throw makePdfRequiresDoclingError();
  }

  if (EMAIL_DOCUMENT_EXTS.has(extension)) {
    const extracted = await extractEmlAsync(resolvedPath);
    return buildExtractionResult(resolvedPath, extension, extracted, maxChars);
  }

  return extractDocumentText(resolvedPath, { maxChars });
}

// Async high-fidelity extraction path. Routes PDF/Office/HTML through the
// docling Python sidecar (layout-aware markdown), audio/video through
// whisper.cpp (Metal-accelerated on macOS), and .eml/.msg through the
// mailparser-backed extractEmlAsync. Text/transcript/calendar paths reuse the
// sync extraction since regex-stripping is the right tool for those formats.
// Returns the same { text, droppedInfo, ... } shape as the sync extractor
// plus a `markdown` field for paths that produce it.
//
// 2026-06 best practice: this is the path new callers should use. The sync
// extractDocumentText is preserved for backwards compatibility with
// pre-async callers; PDF/Office output via that path is lower fidelity
// (tables flattened, formulas dropped) and emits a droppedInfo notice.

export async function extractDocumentTextAsync(filePath, { maxChars = null } = {}) {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);
  const extension = extname(resolvedPath).toLowerCase();
  if (!EXTRACTABLE_DOCUMENT_EXTS.has(extension)) {
    throw new Error(`Unsupported document type: ${extension || 'unknown'}`);
  }

  if (AUDIO_VIDEO_EXTS.has(extension)) {
    const { extractViaWhisper } = await import('./document-extract/whisper-client.mjs');
    const out = await extractViaWhisper(resolvedPath);
    return finalizeAsyncResult({ resolvedPath, extension, extractionMethod: 'whisper', extracted: out, maxChars });
  }

  const doclingFormats = new Set([
    '.pdf',
    ...ZIP_DOCUMENT_EXTS,
    ...RICH_TEXT_EXTS,
    ...MDLS_DOCUMENT_EXTS,
    ...IMAGE_DOCUMENT_EXTS,
  ]);
  if (doclingFormats.has(extension)) {
    const { extractViaDocling } = await import('./document-extract/docling-client.mjs');
    const out = await extractViaDocling(resolvedPath);
    return finalizeAsyncResult({ resolvedPath, extension, extractionMethod: 'docling', extracted: out, maxChars });
  }

  if (EMAIL_DOCUMENT_EXTS.has(extension)) {
    const extracted = await extractEmlAsync(resolvedPath);
    return buildExtractionResult(resolvedPath, extension, extracted, maxChars);
  }

  return extractDocumentText(resolvedPath, { maxChars });
}

function finalizeAsyncResult({ resolvedPath, extension, extractionMethod, extracted, maxChars }) {
  const text = extracted.markdown ?? extracted.text ?? '';
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Math.min(Number(maxChars), 200_000)
    : null;
  const truncated = limit !== null && text.length > limit;
  return {
    filePath: resolvedPath,
    extension,
    extractionMethod,
    text: truncated ? `${text.slice(0, limit)}\n` : text,
    markdown: extracted.markdown ?? null,
    metadata: extracted.metadata ?? null,
    truncated,
    characters: text.length,
    droppedInfo: extracted.droppedInfo ?? [],
    structured: extracted.structured ?? null,
  };
}
