/**
 * lib/document-extract.mjs — shared local document extraction for retrieval and MCP reads.
 *
 * Handles plain-text formats directly, XML/HTML via lightweight tag stripping,
 * Office zip containers via unzip, and PDFs via pdftotext or macOS-native fallbacks.
 * Also provides extractDocumentMetadata() for structured metadata (title, authors,
 * dates, links) from source document frontmatter and content.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// 50 MB hard cap mirrors lib/embed/inbox.mjs and lib/observation-store.mjs.
// Anything larger is intentionally not extracted to keep the daemon path
// bounded; callers receive an empty text plus a `skipped` marker.
const MAX_EML_BYTES = 50 * 1024 * 1024;

export const UTF8_TEXT_EXTS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.sh', '.bash',
  '.html', '.css', '.csv', '.tsv', '.xml', '.env', '.env.example', '.conf', '.ini', '.tf', '.hcl',
  '.sql', '.log',
  '.vtt', '.srt', '.lrc', '.transcript',
]);

export const ZIP_DOCUMENT_EXTS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.ods']);
export const RICH_TEXT_EXTS = new Set(['.doc', '.rtf']);
export const MDLS_DOCUMENT_EXTS = new Set(['.xls', '.ppt', '.pages', '.numbers', '.key']);
export const EMAIL_DOCUMENT_EXTS = new Set(['.eml']);
export const EXTRACTABLE_DOCUMENT_EXTS = new Set([
  ...UTF8_TEXT_EXTS,
  ...ZIP_DOCUMENT_EXTS,
  ...RICH_TEXT_EXTS,
  ...MDLS_DOCUMENT_EXTS,
  ...EMAIL_DOCUMENT_EXTS,
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
  const checker = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(checker, [command], { stdio: 'ignore' }).status === 0;
}

function extractUtf8(filePath, extension) {
  const raw = readFileSync(filePath, 'utf8');
  const text = extension === '.html' || extension === '.xml'
    ? stripMarkup(raw)
    : normalizeText(raw);
  return { text, method: 'utf8' };
}

function zipEntries(filePath) {
  return run('unzip', ['-Z1', filePath]).split('\n').map((line) => line.trim()).filter(Boolean);
}

function unzipEntry(filePath, entryPath) {
  return run('unzip', ['-p', filePath, entryPath]);
}

function extractZipDocument(filePath, extension) {
  const entries = zipEntries(filePath);
  let targets = [];

  if (extension === '.docx') {
    targets = entries.filter((entry) => entry === 'word/document.xml' || entry.startsWith('word/header') || entry.startsWith('word/footer'));
  } else if (extension === '.xlsx') {
    targets = entries.filter((entry) => entry === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(entry));
  } else if (extension === '.pptx') {
    targets = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry));
  } else if (extension === '.odt' || extension === '.ods') {
    targets = entries.filter((entry) => entry === 'content.xml');
  }

  if (targets.length === 0) throw new Error(`No readable document entries found for ${extension}`);

  const text = normalizeText(targets.map((entry) => stripMarkup(unzipEntry(filePath, entry))).join('\n\n'));
  return { text, method: 'zip-xml' };
}

function extractRichText(filePath) {
  if (!commandExists('textutil')) {
    throw new Error('textutil not available for rich-text extraction');
  }
  return {
    text: normalizeText(run('textutil', ['-convert', 'txt', '-stdout', filePath])),
    method: 'textutil',
  };
}

function extractPdfWithPdftotext(filePath) {
  return {
    text: normalizeText(run('pdftotext', ['-layout', '-nopgbrk', filePath, '-'])),
    method: 'pdftotext',
  };
}

function extractPdfWithSwift(filePath) {
  const script = `
import Foundation
import PDFKit

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let document = PDFDocument(url: url) else {
  fputs("Unable to open PDF\\n", stderr)
  exit(1)
}
print(document.string ?? "")
`;
  return {
    text: normalizeText(run('swift', ['-e', script, filePath])),
    method: 'swift-pdfkit',
  };
}

function extractPdfWithMdls(filePath) {
  const text = extractWithMdls(filePath);
  return { text, method: 'mdls' };
}

function extractWithMdls(filePath) {
  const text = normalizeText(run('mdls', ['-raw', '-name', 'kMDItemTextContent', filePath]));
  if (!text || text === '(null)') throw new Error('Spotlight text extraction unavailable');
  return text;
}

function extractPdf(filePath) {
  if (commandExists('pdftotext')) return extractPdfWithPdftotext(filePath);
  if (process.platform === 'darwin' && commandExists('swift')) {
    try {
      return extractPdfWithSwift(filePath);
    } catch {
      return extractPdfWithMdls(filePath);
    }
  }
  if (process.platform === 'darwin' && commandExists('mdls')) return extractPdfWithMdls(filePath);
  throw new Error('No PDF extraction backend available');
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

// Walk a parsed MIME entity, returning the first text/plain body it finds
// and a flat list of attachment filenames encountered along the way. The
// walker stops at depth 8 so a hand-crafted pathological message cannot
// exhaust the stack.
function walkMimeForPlainText(rawEntity, depth = 0) {
  if (depth > 8) return { text: '', attachments: [] };
  const sepIdx = rawEntity.indexOf('\n\n') !== -1
    ? rawEntity.indexOf('\n\n')
    : rawEntity.indexOf('\r\n\r\n');
  if (sepIdx === -1) return { text: '', attachments: [] };
  const headerBlock = rawEntity.slice(0, sepIdx);
  const body = rawEntity.slice(sepIdx).replace(/^\r?\n\r?\n/, '');
  const headers = parseRfc5322Headers(headerBlock);
  const { type, params } = parseContentType(headers['content-type'] || 'text/plain');
  const disposition = parseContentType(headers['content-disposition'] || '');
  const filename = disposition.params.filename || params.name || null;

  if (type.startsWith('multipart/')) {
    const attachments = [];
    let firstPlain = '';
    for (const seg of splitMultipart(body, params.boundary)) {
      const child = walkMimeForPlainText(seg, depth + 1);
      attachments.push(...child.attachments);
      if (!firstPlain && child.text) firstPlain = child.text;
    }
    return { text: firstPlain, attachments };
  }

  if (disposition.type === 'attachment' && filename) {
    return { text: '', attachments: [filename] };
  }

  if (type === '' || type === 'text/plain') {
    return {
      text: decodeTransferEncoded(body, headers['content-transfer-encoding']),
      attachments: [],
    };
  }

  // Non-plain leaves with an explicit filename are treated as attachments.
  if (filename) return { text: '', attachments: [filename] };
  return { text: '', attachments: [] };
}

/**
 * Extract a normalized representation of an .eml message.
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
 * The parser is intentionally minimal: it understands header folding, the
 * `--boundary` framing of multipart messages, and quoted-printable / base64
 * transfer encodings. It does not decode RFC 2047 encoded-word headers, does
 * not chase nested message/rfc822 envelopes, and does not validate signatures.
 */
export function extractEmlMessage(filePath) {
  const stat = statSync(filePath);
  if (stat.size > MAX_EML_BYTES) {
    return { text: '', headers: {}, attachments: [], skipped: 'too large' };
  }
  const raw = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
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
  if (type.startsWith('multipart/')) {
    for (const seg of splitMultipart(body, params.boundary)) {
      const child = walkMimeForPlainText(seg);
      attachments.push(...child.attachments);
      if (!bodyText && child.text) bodyText = child.text;
    }
  } else {
    bodyText = decodeTransferEncoded(body, headers['content-transfer-encoding']);
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
  };
}

function extractEml(filePath) {
  const message = extractEmlMessage(filePath);
  return {
    text: message.text,
    method: message.skipped ? 'eml-skipped' : 'eml',
    skipped: message.skipped || null,
    attachments: message.attachments,
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

  let extracted;
  if (UTF8_TEXT_EXTS.has(extension)) extracted = extractUtf8(resolvedPath, extension);
  else if (ZIP_DOCUMENT_EXTS.has(extension)) extracted = extractZipDocument(resolvedPath, extension);
  else if (RICH_TEXT_EXTS.has(extension)) extracted = extractRichText(resolvedPath);
  else if (MDLS_DOCUMENT_EXTS.has(extension) && process.platform === 'darwin' && commandExists('mdls')) extracted = { text: extractWithMdls(resolvedPath), method: 'mdls' };
  else if (EMAIL_DOCUMENT_EXTS.has(extension)) extracted = extractEml(resolvedPath);
  else if (extension === '.pdf') extracted = extractPdf(resolvedPath);
  else throw new Error(`Unsupported document type: ${extension || 'unknown'}`);

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
  };
  // Surface eml-specific metadata so callers (intake, ingest) can route
  // attachment filenames and oversize-skip markers without re-parsing.
  if (extracted.attachments) result.attachments = extracted.attachments;
  if (extracted.skipped) result.skipped = extracted.skipped;
  return result;
}
