/**
 * lib/document-extract.mjs — shared local document extraction for retrieval and MCP reads.
 *
 * Two extraction paths:
 *   - Async (preferred): `extractDocumentTextAsync` routes through the
 *     quality-aware extraction ladder (native -> unpdf/mammoth -> docling-local
 *     -> docling-remote -> unsupported) and audio/video through whisper.cpp.
 *     `.eml`/`.msg` route through mailparser (`extractEmlAsync`, construct-tsyfe.2.7).
 *     Returns { text, markdown, metadata, droppedInfo, routingTier, ... }.
 *   - Sync (legacy): `extractDocumentText` for text/transcript/calendar/email;
 *     email uses the same mailparser backend via a blocking bridge; PDF/Office
 *     still throw typed errors for pre-async callers.
 *
 * `extractDocumentMetadata` returns frontmatter + title/authors/dates.
 *
 * All paths return droppedInfo as { kind, count, reason, recoverable }[] so
 * info loss is observable rather than silent.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractTranscript } from './extractors/transcript.mjs';
import { extractCalendar } from './extractors/calendar.mjs';
import { extractEmlAsync } from './document-extract/email-extract.mjs';
import {
  UTF8_TEXT_EXTS,
  TRANSCRIPT_EXTS,
  CALENDAR_EXTS,
  AUDIO_VIDEO_EXTS,
  ZIP_DOCUMENT_EXTS,
  RICH_TEXT_EXTS,
  MDLS_DOCUMENT_EXTS,
  EMAIL_DOCUMENT_EXTS,
  IMAGE_DOCUMENT_EXTS,
  EXTRACTABLE_DOCUMENT_EXTS,
  OFFICE_REQUIRES_DOCLING_EXTS,
} from './document-extract/formats.mjs';

export {
  UTF8_TEXT_EXTS,
  TRANSCRIPT_EXTS,
  CALENDAR_EXTS,
  AUDIO_VIDEO_EXTS,
  ZIP_DOCUMENT_EXTS,
  RICH_TEXT_EXTS,
  MDLS_DOCUMENT_EXTS,
  EMAIL_DOCUMENT_EXTS,
  IMAGE_DOCUMENT_EXTS,
  EXTRACTABLE_DOCUMENT_EXTS,
} from './document-extract/formats.mjs';

export { extractEmlAsync, extractEmlMessageAsync } from './document-extract/email-extract.mjs';

const EMAIL_SYNC_WORKER = fileURLToPath(new URL('./document-extract/email-sync-worker.mjs', import.meta.url));

function runEmailExtractSync(mode, filePath, opts = {}) {
  const payload = JSON.stringify({ mode, filePath: resolve(filePath), opts });
  const result = spawnSync(process.execPath, [EMAIL_SYNC_WORKER], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error((result.stderr || result.stdout || 'email sync extraction failed').trim());
  }
  if (parsed.error) {
    const err = new Error(parsed.error.message);
    err.code = parsed.error.code;
    err.filePath = parsed.error.filePath;
    throw err;
  }
  return parsed;
}

export function extractEmlMessage(filePath, opts = {}) {
  return runEmailExtractSync('message', filePath, opts);
}

function extractEml(filePath, opts = {}) {
  return runEmailExtractSync('envelope', filePath, opts);
}

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
      `Audio/video extraction requires ASR. Install a local whisper ASR (brew install whisper-cpp).`,
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

  if (extracted.providerRepresentation) result.providerRepresentation = extracted.providerRepresentation;

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
  const { extractPdfWithUnpdf } = await import('./document-extract/providers/unpdf-provider.mjs');
  const out = await extractPdfWithUnpdf(filePath);
  return out.text;
}

async function extractWithMammoth(filePath) {
  const { extractDocxWithMammoth } = await import('./document-extract/providers/mammoth-provider.mjs');
  const out = await extractDocxWithMammoth(filePath);
  return out.text;
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
// whisper.cpp (Metal-accelerated on macOS), and .eml/.msg through mailparser.
// Text/transcript/calendar paths reuse the sync extraction since regex-stripping
// is the right tool for those formats.

export async function extractDocumentTextAsync(filePath, { maxChars = null, highFidelity = true, env = process.env } = {}) {
  const { extractViaExtractionLadder } = await import('./document-extract/extraction-ladder.mjs');
  const { extractViaDocling } = await import('./document-extract/docling-client.mjs');
  const { extractViaDoclingRemote } = await import('./ingest/docling-remote.mjs');
  const { extractViaWhisper } = await import('./document-extract/whisper-client.mjs');

  return extractViaExtractionLadder(filePath, {
    maxChars,
    highFidelity,
    env,
    syncExtract: (path, opts) => extractDocumentText(path, opts),
    doclingExtract: async (path) => {
      const out = await extractViaDocling(path);
      const { enrichDoclingSidecarResult } = await import('./document-extract/docling-rich-document.mjs');
      return enrichDoclingSidecarResult(out, {
        title: basename(path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      });
    },
    doclingRemoteExtract: extractViaDoclingRemote,
    whisperExtract: async (path) => {
      const out = await extractViaWhisper(path);
      return { ...out, extractionMethod: 'whisper' };
    },
  });
}
