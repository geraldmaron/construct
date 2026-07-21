/**
 * lib/export/html-provider.mjs — sanitized direct-HTML ExportProvider (construct-tsyfe.6.6).
 *
 * Renders RichDocument to HTML in-process (standalone document or fragment) and runs the export
 * sanitization pass from lib/export/html-sanitize.mjs before writing bytes. Does not invoke Pandoc.
 * Returns the export-provider evidence envelope (provider identity, contentHash, fidelity).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { validateRichDocument, richDocumentToHtml } from '../rich-document.mjs';
import { standaloneHtmlDocument } from '../rich-document-export.mjs';
import { attachExportEvidence } from '../export-provider-contract.mjs';
import { sanitizeExportedHtml } from './html-sanitize.mjs';

const require = createRequire(import.meta.url);

export const HTML_EXPORT_PROVIDER_ID = 'construct-html-sanitizer';

export function resolveHtmlExportProviderIdentity() {
  let version = 'unknown';
  try {
    const pkg = require('../../package.json');
    version = pkg.version ? `@geraldmaron/construct ${pkg.version}` : version;
  } catch {
    /* package.json unreadable in isolated test harness */
  }
  return { name: HTML_EXPORT_PROVIDER_ID, version };
}

function nonEmpty(filePath) {
  try { return fs.statSync(filePath).size > 0; } catch { return false; }
}

/**
 * exportSanitizedHtml — write sanitized HTML for `variant` standalone|fragment at outputPath.
 */
export function exportSanitizedHtml({
  doc,
  outputPath,
  variant = 'standalone',
} = {}) {
  const format = variant === 'fragment' ? 'htmlfrag' : 'html';
  if (!doc || typeof doc !== 'object') {
    return { ok: false, format, message: 'exportSanitizedHtml: doc is required.' };
  }
  const shape = validateRichDocument(doc);
  if (!shape.ok) {
    return { ok: false, format, message: `RichDocument is invalid: ${shape.errors.join('; ')}` };
  }
  if (!outputPath) {
    return { ok: false, format, message: 'exportSanitizedHtml: outputPath is required.' };
  }
  if (variant !== 'standalone' && variant !== 'fragment') {
    return { ok: false, format, message: `exportSanitizedHtml: variant must be standalone or fragment, got "${variant}".` };
  }

  const raw = variant === 'fragment'
    ? `${richDocumentToHtml(doc)}\n`
    : standaloneHtmlDocument(doc);
  const sanitized = sanitizeExportedHtml(raw);
  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sanitized, 'utf8');

  if (!nonEmpty(target)) {
    return { ok: false, format, outputPath: target, message: `Export produced an empty ${format} file: ${target}` };
  }

  return attachExportEvidence({
    ok: true,
    format,
    outputPath: target,
    engine: 'construct-html',
    bytes: fs.statSync(target).size,
    message: `Wrote ${path.relative(process.cwd(), target)}`,
  }, {
    doc,
    format,
    resolveProvider: () => resolveHtmlExportProviderIdentity(),
  });
}
