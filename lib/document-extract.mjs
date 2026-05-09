/**
 * lib/document-extract.mjs — shared local document extraction for retrieval and MCP reads.
 *
 * Handles plain-text formats directly, XML/HTML via lightweight tag stripping,
 * Office zip containers via unzip, and PDFs via pdftotext or macOS-native fallbacks.
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const UTF8_TEXT_EXTS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.sh', '.bash',
  '.html', '.css', '.csv', '.tsv', '.xml', '.env', '.env.example', '.conf', '.ini', '.tf', '.hcl',
  '.sql', '.log',
]);

export const ZIP_DOCUMENT_EXTS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.ods']);
export const RICH_TEXT_EXTS = new Set(['.doc', '.rtf']);
export const MDLS_DOCUMENT_EXTS = new Set(['.xls', '.ppt', '.pages', '.numbers', '.key']);
export const EXTRACTABLE_DOCUMENT_EXTS = new Set([
  ...UTF8_TEXT_EXTS,
  ...ZIP_DOCUMENT_EXTS,
  ...RICH_TEXT_EXTS,
  ...MDLS_DOCUMENT_EXTS,
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
  else if (extension === '.pdf') extracted = extractPdf(resolvedPath);
  else throw new Error(`Unsupported document type: ${extension || 'unknown'}`);

  const text = extracted.text;
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Math.min(Number(maxChars), 200_000)
    : null;
  const truncated = limit !== null && text.length > limit;

  return {
    filePath: resolvedPath,
    extension,
    extractionMethod: extracted.method,
    text: truncated ? `${text.slice(0, limit)}\n` : text,
    truncated,
    characters: text.length,
  };
}
