/**
 * lib/export-from-source.mjs — production export routing for markdown sources (construct-tsyfe.6.2).
 *
 * Builds a RichDocument from an on-disk markdown artifact when possible and routes through
 * exportRichDocument(); falls back to exportMarkdown() when IR construction fails so callers
 * with plain markdown keep today's behavior. Records which path was taken via exportPath.
 */

import fs from 'node:fs';
import path from 'node:path';

import { exportMarkdown } from './document-export.mjs';
import { exportRichDocument } from './rich-document-export.mjs';
import { attachExportEvidence } from './export-provider-contract.mjs';
import { markdownToRichDocument, validateRichDocument } from './rich-document.mjs';
import { parseArtifactMetadata } from './publish-template.mjs';
import { resolveExportProviderIdentity } from './export-provider-identity.mjs';

export function buildRichDocumentFromFile(inputPath) {
  if (!inputPath || !fs.existsSync(inputPath)) {
    return { ok: false, message: `buildRichDocumentFromFile: input does not exist: ${inputPath}` };
  }
  const content = fs.readFileSync(inputPath, 'utf8');
  const metadata = parseArtifactMetadata(inputPath);
  const doc = markdownToRichDocument(content, {
    title: metadata.title,
    subtitle: metadata.subtitle,
    artifactType: metadata.artifactType,
    docId: metadata.docId,
    version: metadata.version,
    classification: metadata.classification,
    authors: metadata.owner ? [metadata.owner] : [],
    dates: metadata.date ? { date: metadata.date } : {},
  });
  const shape = validateRichDocument(doc);
  if (!shape.ok) {
    return { ok: false, message: `RichDocument validation failed: ${shape.errors.join('; ')}`, errors: shape.errors };
  }
  return { ok: true, doc };
}

export function exportFromSource({
  inputPath,
  outputPath,
  format,
  env = process.env,
  cwd = process.cwd(),
  repoRoot,
  assetBaseDir,
  exportPath: forcedExportPath,
  doc: providedDoc,
  ...rest
} = {}) {
  const rich = providedDoc
    ? { ok: true, doc: providedDoc }
    : buildRichDocumentFromFile(inputPath);

  const resolveProvider = (result) => resolveExportProviderIdentity(result, { env });

  if (rich.ok && forcedExportPath !== 'markdown') {
    const result = exportRichDocument({
      doc: rich.doc,
      format,
      outputPath,
      inputPath,
      env,
      cwd,
      repoRoot,
      assetBaseDir: assetBaseDir || path.dirname(path.resolve(inputPath || cwd)),
      ...rest,
    });
    const enriched = attachExportEvidence(result, { doc: rich.doc, format, resolveProvider });
    return { ...enriched, exportPath: 'richdocument' };
  }

  const result = exportMarkdown({
    inputPath,
    outputPath,
    format,
    env,
    cwd,
    repoRoot,
    doc: rich.ok ? rich.doc : null,
    ...rest,
  });
  const enriched = attachExportEvidence(result, {
    doc: rich.ok ? rich.doc : null,
    format,
    resolveProvider,
  });
  return { ...enriched, exportPath: 'markdown' };
}
