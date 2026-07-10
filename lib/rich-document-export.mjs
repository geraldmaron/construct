/**
 * lib/rich-document-export.mjs — RichDocument (ADR-0073) export adapters.
 *
 * The IR's canonical serialization is HTML (lib/rich-document.mjs `richDocumentToHtml`), so every
 * typeset/office target is produced by handing that HTML to the landed export engines rather than
 * re-deriving a markdown pivot: `exportMarkdown({ inputFormat: 'html' })` drives Pandoc/Typst for
 * pdf/docx/odt/epub/rtf/txt/tex/deck and the DOC-via-LibreOffice chain; pptxgenjs and LibreOffice
 * cover pptx/odp. Two targets have no engine and are written directly: `md`/`mdx` from a
 * RichDocument→markdown writer (required by ADR-0073 so `.md` output keeps working), and `htmlfrag`
 * — the copy/paste fragment whose whole point is that rich elements (colspan, figure/caption,
 * callouts) survive a clipboard paste that plain markdown would flatten.
 *
 * Adapters never fabricate a pass: a missing engine returns the same actionable diagnostic
 * `detect()` reports, an empty output file fails, and validation is left to lib/export-validate.mjs
 * so certification (d1r7.11) can compose export + validate per format.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { richDocumentToHtml, validateRichDocument } from './rich-document.mjs';
import { exportMarkdown } from './document-export.mjs';
import { exportDeckPptx } from './deck-export-pptx.mjs';
import { convertViaLibreOffice, libreOfficePresent, libreOfficeInstallHint } from './libreoffice-export.mjs';
import { buildAssetManifest, validateAssetManifest, resolveDocAssets } from './document-assets.mjs';

// Direct-write targets carry no external engine; every other format routes to a landed engine.

const FRAGMENT_FORMATS = new Set(['htmlfrag']);
const MARKDOWN_FORMATS = new Set(['md', 'mdx']);
const HTML_ENGINE_FORMATS = new Set(['html', 'pdf', 'docx', 'doc', 'odt', 'epub', 'rtf', 'txt', 'tex', 'deck']);

export const RICH_EXPORT_FORMATS = Object.freeze([
  'html', 'htmlfrag', 'pdf', 'docx', 'doc', 'odt', 'odp', 'pptx', 'deck', 'rtf', 'epub', 'txt', 'tex', 'md', 'mdx',
]);

// RichDocument metadata is typed; the landed export path expects the flat masthead shape
// parseArtifactMetadata() produces, so the IR fields are projected onto it here.

export function richMetadataToExportMetadata(meta = {}) {
  const dates = meta.dates && typeof meta.dates === 'object' ? meta.dates : {};
  const fm = meta.frontmatter && typeof meta.frontmatter === 'object' ? meta.frontmatter : {};
  return {
    title: meta.title || '',
    subtitle: meta.subtitle || '',
    date: dates.date || dates.last_verified_at || '',
    status: fm.status || '',
    owner: Array.isArray(meta.authors) && meta.authors.length ? String(meta.authors[0]) : '',
    artifactType: meta.artifactType || '',
    version: meta.version != null ? String(meta.version) : '',
    docId: meta.docId || '',
    classification: meta.classification || '',
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The self-contained HTML target wraps the canonical fragment in a minimal standalone shell so it
// opens as a document on its own; the fragment target (copy/paste) is the bare fragment.

export function standaloneHtmlDocument(doc) {
  const meta = doc.metadata || {};
  const fragment = richDocumentToHtml(doc);
  const title = escapeHtml(meta.title || meta.docId || 'Document');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
${fragment}
</body>
</html>
`;
}

// RichDocument → markdown: the lossy peer serialization ADR-0073 keeps for `.md`/`.mdx` output.
// Inverts markdownToRichDocument's block vocabulary; fields markdown cannot hold (colspan, callout
// kind, citations) flatten rather than throw, matching the IR's degrade-not-drop stance.

export function richDocumentToMarkdown(doc) {
  const meta = doc.metadata || {};
  const front = [];
  if (meta.title) front.push(`title: ${meta.title}`);
  if (meta.subtitle) front.push(`subtitle: ${meta.subtitle}`);
  if (meta.artifactType) front.push(`artifactType: ${meta.artifactType}`);
  if (meta.docId) front.push(`doc_id: ${meta.docId}`);
  if (meta.version) front.push(`version: ${meta.version}`);
  if (meta.classification) front.push(`classification: ${meta.classification}`);
  if (Array.isArray(meta.authors) && meta.authors.length) front.push(`owner: ${meta.authors[0]}`);
  const dates = meta.dates && typeof meta.dates === 'object' ? meta.dates : {};
  if (dates.date) front.push(`date: ${dates.date}`);

  const body = (doc.sections || []).map((section) => (section.blocks || []).map((block) => blockToMarkdown(block)).join('\n\n')).filter(Boolean).join('\n\n');
  const header = front.length ? `---\n${front.join('\n')}\n---\n\n` : '';
  return `${header}${body}\n`;
}

function runsToMarkdown(runs) {
  return (runs || []).map((run) => {
    let text = String(run.text ?? '');
    const marks = run.marks || [];
    if (marks.includes('code')) text = `\`${text}\``;
    if (marks.includes('bold')) text = `**${text}**`;
    if (marks.includes('italic')) text = `_${text}_`;
    if (marks.includes('link')) text = `[${text}](${run.href || ''})`;
    return text;
  }).join('');
}

function blockToMarkdown(block, depth = 0) {
  const pad = '  '.repeat(depth);
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(Math.min(6, Math.max(1, block.level || 1)))} ${runsToMarkdown(block.runs)}`;
    case 'paragraph':
      return `${pad}${runsToMarkdown(block.runs)}`;
    case 'list':
      return (block.items || []).map((item, i) => {
        const marker = block.style === 'number' ? `${i + 1}.` : '-';
        const [first, ...rest] = item;
        const head = `${pad}${marker} ${first ? runsToMarkdown(first.runs || []) : ''}`.trimEnd();
        const nested = rest.map((sub) => blockToMarkdown(sub, depth + 1)).join('\n');
        return nested ? `${head}\n${nested}` : head;
      }).join('\n');
    case 'table': {
      const cell = (c) => runsToMarkdown(c.runs).replace(/\|/g, '\\|');
      const headers = (block.headers || []).map(cell);
      const sep = headers.map(() => '---');
      const rows = (block.rows || []).map((row) => `| ${row.map(cell).join(' | ')} |`);
      return [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows].join('\n');
    }
    case 'figure': {
      const media = block.media || {};
      const cap = (block.caption && block.caption.length) ? ` "${runsToMarkdown(block.caption).replace(/"/g, '')}"` : '';
      return `![${block.altText || ''}](${media.uri || media.assetPath || ''}${cap})`;
    }
    case 'media': {
      const src = block.uri || block.assetPath || '';
      if (block.kind === 'image') return `![${block.altText || ''}](${src})`;
      return `[${block.kind}](${src})`;
    }
    case 'code':
      return `\`\`\`${block.lang || ''}\n${block.text || ''}\n\`\`\``;
    case 'diagram':
      return `\`\`\`${block.lang || ''}\n${block.source || ''}\n\`\`\``;
    case 'callout':
      return (block.blocks || []).map((sub) => blockToMarkdown(sub)).join('\n\n')
        .split('\n').map((line) => `> ${line}`).join('\n');
    case 'droppedInfo':
      return `<!-- dropped ${block.count || 1} ${block.kind || 'item'}(s): ${block.reason || ''} -->`;
    default:
      return '';
  }
}

function nonEmpty(filePath) {
  try { return fs.statSync(filePath).size > 0; } catch { return false; }
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-rich-export-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ok(format, target, engine, extra = {}) {
  return { ok: true, format, outputPath: target, engine, bytes: (() => { try { return fs.statSync(target).size; } catch { return 0; } })(), message: `Wrote ${path.relative(process.cwd(), target)}`, ...extra };
}

function empty(format, target) {
  return { ok: false, format, outputPath: target, message: `Export produced an empty ${format} file: ${target}` };
}

/**
 * exportRichDocument — serialize a RichDocument to `format` at `outputPath`.
 * Returns the landed export-result shape ({ ok, format, outputPath, engine, message, ... }); on a
 * missing engine it returns detect()'s actionable diagnostic and never a spurious ok:true.
 */
export function exportRichDocument({
  doc,
  format,
  outputPath,
  branding = 'construct',
  env = process.env,
  spawnFn = spawnSync,
  cwd = process.cwd(),
  repoRoot,
  assetBaseDir,
} = {}) {
  if (!doc || typeof doc !== 'object') return { ok: false, format, message: 'exportRichDocument: doc is required.' };
  if (!RICH_EXPORT_FORMATS.includes(format)) {
    return { ok: false, format, message: `Unsupported RichDocument format: ${format}. Supported: ${RICH_EXPORT_FORMATS.join(', ')}.` };
  }
  const shape = validateRichDocument(doc);
  if (!shape.ok) return { ok: false, format, message: `RichDocument is invalid: ${shape.errors.join('; ')}` };
  if (!outputPath) return { ok: false, format, message: 'exportRichDocument: outputPath is required.' };

  // A broken local media reference cannot be preserved by any export, so the asset manifest is
  // validated before an engine runs (never a spurious pass); resolved local refs become absolute so
  // an engine spawned in a temp working directory still finds and embeds them.

  const baseDir = assetBaseDir || cwd;
  const manifest = buildAssetManifest(doc, { baseDir });
  const assetCheck = validateAssetManifest(manifest);
  if (!assetCheck.ok) return { ok: false, format, outputPath: path.resolve(outputPath), brokenAssets: assetCheck.missing, message: assetCheck.message };
  const resolvedDoc = resolveDocAssets(doc, { baseDir });

  const target = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const metadataOverride = richMetadataToExportMetadata(doc.metadata || {});
  const repoArg = repoRoot ? { repoRoot } : {};
  const withAssets = (result) => (result.ok ? { ...result, assets: manifest.assets } : result);

  // The copy target and markdown keep the document's original (portable, relative) refs; only the
  // engine paths — which spawn in a temp dir — consume resolvedDoc's absolute refs.

  if (FRAGMENT_FORMATS.has(format)) {
    fs.writeFileSync(target, `${richDocumentToHtml(doc)}\n`, 'utf8');
    return nonEmpty(target) ? withAssets(ok(format, target, 'fragment')) : empty(format, target);
  }

  if (MARKDOWN_FORMATS.has(format)) {
    fs.writeFileSync(target, richDocumentToMarkdown(doc), 'utf8');
    return nonEmpty(target) ? withAssets(ok(format, target, 'copy')) : empty(format, target);
  }

  if (format === 'pptx') {
    return withTempDir((dir) => {
      const mdPath = path.join(dir, 'deck.md');
      fs.writeFileSync(mdPath, richDocumentToMarkdown(resolvedDoc), 'utf8');
      const result = exportDeckPptx({ inputPath: mdPath, outputPath: target, metadata: metadataOverride, ...repoArg });
      if (!result.ok) return result;
      return nonEmpty(target) ? withAssets({ ...result, bytes: fs.statSync(target).size }) : empty(format, target);
    });
  }

  if (format === 'odp') {
    if (!libreOfficePresent(env)) return { ok: false, format, outputPath: target, missing: ['libreoffice'], message: libreOfficeInstallHint() };
    return withTempDir((dir) => {
      const mdPath = path.join(dir, 'deck.md');
      const pptxPath = path.join(dir, 'deck.pptx');
      fs.writeFileSync(mdPath, richDocumentToMarkdown(resolvedDoc), 'utf8');
      const pptx = exportDeckPptx({ inputPath: mdPath, outputPath: pptxPath, metadata: metadataOverride, ...repoArg });
      if (!pptx.ok) return { ...pptx, format };
      const conv = convertViaLibreOffice({ inputPath: pptxPath, outputPath: target, toFormat: 'odp', env, spawnFn });
      if (!conv.ok) return { ok: false, format, outputPath: target, missing: conv.missing, message: conv.message };
      return nonEmpty(target) ? withAssets(ok(format, target, 'libreoffice')) : empty(format, target);
    });
  }

  if (HTML_ENGINE_FORMATS.has(format)) {
    return withTempDir((dir) => {
      const htmlPath = path.join(dir, 'source.html');
      fs.writeFileSync(htmlPath, richDocumentToHtml(resolvedDoc), 'utf8');
      const result = exportMarkdown({
        inputPath: htmlPath,
        outputPath: target,
        format,
        inputFormat: 'html',
        metadataOverride,
        branding,
        env,
        spawnFn,
        cwd,
        ...repoArg,
      });
      if (!result.ok) return result;
      return nonEmpty(target) ? withAssets({ ...result, bytes: fs.statSync(target).size }) : empty(format, target);
    });
  }

  return { ok: false, format, message: `No adapter wired for format: ${format}` };
}
