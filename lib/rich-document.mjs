/**
 * lib/rich-document.mjs — RichDocument IR: schema, markdown reader, HTML serializer/reader.
 *
 * Implements the schema defined in ADR-0073 (docs/decisions/adr/0073-richdocument-ir-html-canonical-surface.md):
 * a JSON-serializable tree (metadata + sections[] of discriminated-union blocks) that becomes
 * Construct's canonical in-memory document representation, with HTML as its canonical
 * serialization. Ingest and export route through RichDocument where the IR can be built
 * (lib/document-ingest.mjs, lib/export-from-source.mjs); deeper extraction-native IR is later work.
 *
 * Two deviations from the ADR's literal pseudocode, both load-bearing and both explained here
 * so a future reader does not "fix" them back into a shape that can't hold real content:
 *   - `Run.marks` stays the ADR's flat `bold|italic|code|link` enum array; a link's URL has no
 *     other home in the schema, so it lives in a sibling `Run.href` field, present only when
 *     `marks` includes `'link'`.
 *   - `droppedInfo` reuses `lib/extractors/shared/drop-info.mjs`'s `{ kind, count, reason,
 *     recoverable }` shape verbatim, exactly as the ADR requires.
 *
 * `markdownToRichDocument` targets CommonMark-level constructs (headings, paragraphs, lists
 * incl. nesting, pipe tables, fenced code, images, links, bold/italic/code marks, blockquotes).
 * GFM extensions (footnotes, task lists, strikethrough) and any construct the reader does not
 * recognize are never silently discarded: they either degrade to a plain paragraph/text run
 * (when the content itself survives, just not its structure) or attach a `droppedInfo` block
 * (when the content cannot survive at all), per the ADR's block-position droppedInfo model.
 * Markdown and HTML parsing delegate to unified/remark/rehype adapters in
 * `lib/rich-document-adapters/` (construct-tsyfe.3.3, ADR-0097 capability delegation).
 *
 * `richDocumentToHtml` / `htmlToRichDocument` are a matched pair: the HTML reader only needs to
 * invert HTML this module itself produces (per the ADR's scope), not arbitrary third-party HTML.
 * Fields with no native HTML slot (`sourceRef`, `droppedInfo`, `citations`) travel as `data-cx-*`
 * attributes on the nearest wrapping element.
 *
 * Public API:
 *   makeRichDocument, makeSection, makeRun, makeCell, makeCitation, makeMediaRef,
 *   makeParagraphBlock, makeHeadingBlock, makeListBlock, makeTableBlock, makeFigureBlock,
 *   makeMediaBlock, makeCodeBlock, makeDiagramBlock, makeCalloutBlock, makeDroppedInfoBlock,
 *   makeHtmlBlock
 *   validateRichDocument(doc) → { ok, errors, warnings }
 *   markdownToRichDocument(markdownText, metadata) → RichDocument
 *   richDocumentToHtml(doc) → string
 *   htmlToRichDocument(html) → RichDocument
 */

import { createRequire } from 'node:module';

import { makeDropInfo } from './extractors/shared/drop-info.mjs';
import { BLOCK_TYPES } from './rich-document-schema.mjs';

export { BLOCK_TYPES };

const require = createRequire(import.meta.url);

let parseMarkdownToRichDocumentFn;
let parseHtmlToRichDocumentFn;

function missingRichDocumentParserDeps(hint, err) {
  const message = `RichDocument parser dependencies are not installed (${hint}). Run npm install in the Construct checkout.`;
  const wrapped = new Error(message, { cause: err });
  wrapped.code = 'RICHDOCUMENT_PARSER_DEPS_MISSING';
  return wrapped;
}

function loadMarkdownParser() {
  if (!parseMarkdownToRichDocumentFn) {
    try {
      parseMarkdownToRichDocumentFn = require('./rich-document-adapters/markdown-parse.mjs').parseMarkdownToRichDocument;
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
        throw missingRichDocumentParserDeps('unified, remark-parse, remark-gfm', err);
      }
      throw err;
    }
  }
  return parseMarkdownToRichDocumentFn;
}

function loadHtmlParser() {
  if (!parseHtmlToRichDocumentFn) {
    try {
      parseHtmlToRichDocumentFn = require('./rich-document-adapters/html-parse.mjs').parseHtmlToRichDocument;
    } catch (err) {
      if (err?.code === 'ERR_MODULE_NOT_FOUND' || err?.code === 'MODULE_NOT_FOUND') {
        throw missingRichDocumentParserDeps('unified, rehype-parse, rehype-sanitize', err);
      }
      throw err;
    }
  }
  return parseHtmlToRichDocumentFn;
}
const RUN_MARKS = Object.freeze(['bold', 'italic', 'code', 'link']);
const MEDIA_KINDS = Object.freeze(['image', 'video', 'audio']);
const LIST_STYLES = Object.freeze(['bullet', 'number']);

// Schema factories

let idCounter = 0;

export function resetRichDocumentParserState() {
  idCounter = 0;
}

function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function makeRichDocument({
  title = '', subtitle = '', authors = [], dates = {}, artifactType = '',
  docId = '', version = '', classification = '', frontmatter = {},
} = {}, sections = []) {
  return {
    metadata: { title, subtitle, authors, dates, artifactType, docId, version, classification, frontmatter },
    sections,
  };
}

export function makeSection({ id, level = 1, title = '', blocks = [], sourceRef = null } = {}) {
  return { id: id || nextId('section'), level, title, blocks, sourceRef };
}

export function makeRun({ text = '', marks = [], href = null, citations = null } = {}) {
  return { text, marks, ...(href ? { href } : {}), ...(citations ? { citations } : {}) };
}

export function makeCell({ runs = [], colspan = 1, rowspan = 1 } = {}) {
  return { runs, colspan, rowspan };
}

export function makeCitation({ sourceRef, locator = null, credibilityTier = null } = {}) {
  return { sourceRef, locator, credibilityTier };
}

export function makeMediaRef({ kind = 'image', uri = null, assetPath = null, mimeType = null, dimensions = null } = {}) {
  return { kind, uri, assetPath, mimeType, dimensions };
}

export function makeParagraphBlock({ runs = [] } = {}) {
  return { type: 'paragraph', runs };
}

export function makeHeadingBlock({ level = 1, runs = [] } = {}) {
  return { type: 'heading', level, runs };
}

export function makeListBlock({ style = 'bullet', items = [] } = {}) {
  return { type: 'list', style, items };
}

export function makeTableBlock({ headers = [], rows = [] } = {}) {
  return { type: 'table', headers, rows };
}

export function makeFigureBlock({ media, caption = [], altText = '', sourceRef = null } = {}) {
  return { type: 'figure', media, caption, altText, sourceRef };
}

export function makeMediaBlock({ kind = 'image', uri = null, assetPath = null, mimeType = null, altText = null, transcriptRef = null } = {}) {
  return { type: 'media', kind, uri, assetPath, mimeType, altText, transcriptRef };
}

export function makeCodeBlock({ lang = '', text = '' } = {}) {
  return { type: 'code', lang, text };
}

export function makeDiagramBlock({ lang = '', source = '' } = {}) {
  return { type: 'diagram', lang, source };
}

export function makeCalloutBlock({ kind = 'note', blocks = [] } = {}) {
  return { type: 'callout', kind, blocks };
}

export function makeDroppedInfoBlock({ kind, count = 1, reason, recoverable = false } = {}) {
  return { type: 'droppedInfo', ...makeDropInfo({ kind, count, reason, recoverable }) };
}

export function makeHtmlBlock({ html = '' } = {}) {
  return { type: 'html', html: String(html ?? '') };
}

// Shape validation, in the { ok, errors, warnings } style of lib/registry/validator.mjs.

export function validateRichDocument(doc) {
  const errors = [];
  const warnings = [];

  if (!doc || typeof doc !== 'object') {
    return { ok: false, errors: ['RichDocument must be an object'], warnings };
  }
  if (!doc.metadata || typeof doc.metadata !== 'object') {
    errors.push('RichDocument.metadata must be an object');
  }
  if (!Array.isArray(doc.sections)) {
    errors.push('RichDocument.sections must be an array');
    return { ok: false, errors, warnings };
  }

  doc.sections.forEach((section, si) => {
    const loc = `sections[${si}]`;
    if (!section || typeof section !== 'object') {
      errors.push(`${loc} must be an object`);
      return;
    }
    if (!section.id) errors.push(`${loc}.id is required`);
    if (!Array.isArray(section.blocks)) {
      errors.push(`${loc}.blocks must be an array`);
      return;
    }
    section.blocks.forEach((block, bi) => validateBlock(block, `${loc}.blocks[${bi}]`, errors, warnings));
  });

  return { ok: errors.length === 0, errors, warnings };
}

function validateBlock(block, loc, errors, warnings) {
  if (!block || typeof block !== 'object') {
    errors.push(`${loc} must be an object`);
    return;
  }
  if (!BLOCK_TYPES.includes(block.type)) {
    errors.push(`${loc}.type "${block.type}" is not a recognized Block type (${BLOCK_TYPES.join('|')})`);
    return;
  }
  if (block.type === 'list') {
    if (!LIST_STYLES.includes(block.style)) errors.push(`${loc}.style must be bullet|number`);
    if (!Array.isArray(block.items)) errors.push(`${loc}.items must be an array`);
    else block.items.forEach((item, ii) => {
      if (!Array.isArray(item)) { errors.push(`${loc}.items[${ii}] must be a Block[]`); return; }
      item.forEach((sub, si) => validateBlock(sub, `${loc}.items[${ii}][${si}]`, errors, warnings));
    });
  }
  if (block.type === 'callout' && Array.isArray(block.blocks)) {
    block.blocks.forEach((sub, si) => validateBlock(sub, `${loc}.blocks[${si}]`, errors, warnings));
  }
  if ((block.type === 'paragraph' || block.type === 'heading') && Array.isArray(block.runs)) {
    block.runs.forEach((run, ri) => {
      if (typeof run.text !== 'string') errors.push(`${loc}.runs[${ri}].text must be a string`);
      if (run.marks && run.marks.some((m) => !RUN_MARKS.includes(m))) {
        errors.push(`${loc}.runs[${ri}].marks contains an unrecognized mark`);
      }
    });
  }
  if (block.type === 'table') {
    if (!Array.isArray(block.headers)) errors.push(`${loc}.headers must be an array`);
    if (!Array.isArray(block.rows)) errors.push(`${loc}.rows must be an array`);
  }
  if (block.type === 'media' && !MEDIA_KINDS.includes(block.kind)) {
    errors.push(`${loc}.kind must be image|video|audio`);
  }
  if (block.type === 'droppedInfo' && typeof block.kind !== 'string') {
    warnings.push(`${loc}.kind should be a string naming the loss category`);
  }
  if (block.type === 'html' && typeof block.html !== 'string') {
    errors.push(`${loc}.html must be a string`);
  }
}

export function markdownToRichDocument(markdownText, metadata = {}) {
  return loadMarkdownParser()(markdownText, metadata);
}

// richDocumentToHtml — native elements where HTML has a slot (table/colspan/rowspan,
// figure/figcaption, video/audio, img/alt); data-cx-* attributes for sourceRef, droppedInfo,
// and citations, which HTML has no native slot for (ADR-0073's HTML-first data flow).

export function richDocumentToHtml(doc) {
  const meta = doc.metadata || {};
  const attrs = [
    attr('data-cx-title', meta.title),
    attr('data-cx-doc-id', meta.docId),
    attr('data-cx-version', meta.version),
    attr('data-cx-artifact-type', meta.artifactType),
    attr('data-cx-classification', meta.classification),
  ].filter(Boolean).join(' ');
  const sections = (doc.sections || []).map(sectionToHtml).join('\n');
  return `<article${attrs ? ` ${attrs}` : ''}>\n${sections}\n</article>`;
}

function attr(name, value) {
  if (value === undefined || value === null || value === '') return '';
  return `${name}="${escapeAttr(String(value))}"`;
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/\n/g, '&#10;');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sectionToHtml(section) {
  const sourceRefAttr = section.sourceRef ? ` ${attr('data-cx-source-ref', JSON.stringify(section.sourceRef))}` : '';
  const idAttr = section.id ? ` id="${escapeAttr(section.id)}"` : '';
  const levelAttr = ` data-cx-level="${section.level}"`;
  const blocks = (section.blocks || []).map(blockToHtml).join('\n');
  return `<section${idAttr}${levelAttr}${sourceRefAttr}>\n${blocks}\n</section>`;
}

function blockToHtml(block) {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, block.level || 1));
      return `<h${level}>${runsToHtml(block.runs)}</h${level}>`;
    }
    case 'paragraph':
      return `<p>${runsToHtml(block.runs)}</p>`;
    case 'list': {
      const tag = block.style === 'number' ? 'ol' : 'ul';
      const items = (block.items || []).map((item) => `<li>${item.map(blockToHtml).join('')}</li>`).join('\n');
      return `<${tag}>\n${items}\n</${tag}>`;
    }
    case 'table': {
      const head = `<thead><tr>${(block.headers || []).map((c) => cellToHtml(c, 'th')).join('')}</tr></thead>`;
      const body = `<tbody>${(block.rows || []).map((row) => `<tr>${row.map((c) => cellToHtml(c, 'td')).join('')}</tr>`).join('')}</tbody>`;
      return `<table>${head}${body}</table>`;
    }
    case 'figure': {
      const sourceRefAttr = block.sourceRef ? ` ${attr('data-cx-source-ref', JSON.stringify(block.sourceRef))}` : '';
      const media = block.media || {};
      const img = `<img src="${escapeAttr(media.uri || media.assetPath || '')}" alt="${escapeAttr(block.altText || '')}"${media.mimeType ? ` ${attr('data-cx-mime-type', media.mimeType)}` : ''}>`;
      const caption = block.caption && block.caption.length ? `<figcaption>${runsToHtml(block.caption)}</figcaption>` : '';
      return `<figure${sourceRefAttr}>${img}${caption}</figure>`;
    }
    case 'media': {
      const src = block.uri || block.assetPath || '';
      const mimeAttr = block.mimeType ? ` ${attr('data-cx-mime-type', block.mimeType)}` : '';
      const transcriptAttr = block.transcriptRef ? ` ${attr('data-cx-transcript-ref', block.transcriptRef)}` : '';
      if (block.kind === 'image') return `<img src="${escapeAttr(src)}" alt="${escapeAttr(block.altText || '')}"${mimeAttr}${transcriptAttr}>`;
      const tag = block.kind === 'video' ? 'video' : 'audio';
      return `<${tag} src="${escapeAttr(src)}"${mimeAttr}${transcriptAttr}></${tag}>`;
    }
    case 'code':
      return `<pre><code${block.lang ? ` class="language-${escapeAttr(block.lang)}"` : ''}>${escapeHtml(block.text)}</code></pre>`;
    case 'diagram':
      return `<pre data-cx-diagram-lang="${escapeAttr(block.lang)}"><code>${escapeHtml(block.source)}</code></pre>`;
    case 'callout': {
      const inner = (block.blocks || []).map(blockToHtml).join('\n');
      if (block.kind === 'quote') return `<blockquote data-cx-callout="true">${inner}</blockquote>`;
      return `<div class="cx-callout" data-cx-callout-kind="${escapeAttr(block.kind)}">${inner}</div>`;
    }
    case 'droppedInfo':
      return `<div class="cx-dropped-info" ${attr('data-cx-kind', block.kind)} ${attr('data-cx-count', block.count)} ${attr('data-cx-reason', block.reason)} ${attr('data-cx-recoverable', block.recoverable)}></div>`;
    case 'html':
      return String(block.html || '');
    default:
      return '';
  }
}

function cellToHtml(cell, tag) {
  const colspanAttr = cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
  const rowspanAttr = cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '';
  return `<${tag}${colspanAttr}${rowspanAttr}>${runsToHtml(cell.runs)}</${tag}>`;
}

function runsToHtml(runs) {
  return (runs || []).map(runToHtml).join('');
}

function runToHtml(run) {
  const citationsAttr = run.citations && run.citations.length ? ` ${attr('data-cx-citations', JSON.stringify(run.citations))}` : '';
  let html = escapeHtml(run.text);
  const marks = run.marks || [];
  if (marks.includes('code')) html = `<code>${html}</code>`;
  if (marks.includes('bold')) html = `<strong>${html}</strong>`;
  if (marks.includes('italic')) html = `<em>${html}</em>`;
  if (marks.includes('link')) html = `<a href="${escapeAttr(run.href || '')}">${html}</a>`;
  if (citationsAttr) html = `<span${citationsAttr}>${html}</span>`;
  return html;
}

export function htmlToRichDocument(html) {
  return loadHtmlParser()(html);
}
