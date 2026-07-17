/**
 * lib/rich-document.mjs — RichDocument IR: schema, markdown reader, HTML serializer/reader.
 *
 * Implements the schema defined in ADR-0073 (docs/decisions/adr/0073-richdocument-ir-html-canonical-surface.md):
 * a JSON-serializable tree (metadata + sections[] of discriminated-union blocks) that becomes
 * Construct's canonical in-memory document representation, with HTML as its canonical
 * serialization. This module is purely additive — nothing in the existing extraction/export
 * pipeline is wired to it yet (that is later, per-site work named in the ADR's Consequences).
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
 *
 * `richDocumentToHtml` / `htmlToRichDocument` are a matched pair: the HTML reader only needs to
 * invert HTML this module itself produces (per the ADR's scope), not arbitrary third-party HTML.
 * Fields with no native HTML slot (`sourceRef`, `droppedInfo`, `citations`) travel as `data-cx-*`
 * attributes on the nearest wrapping element.
 *
 * Public API:
 *   BLOCK_TYPES
 *   makeRichDocument, makeSection, makeRun, makeCell, makeCitation, makeMediaRef,
 *   makeParagraphBlock, makeHeadingBlock, makeListBlock, makeTableBlock, makeFigureBlock,
 *   makeMediaBlock, makeCodeBlock, makeDiagramBlock, makeCalloutBlock, makeDroppedInfoBlock
 *   validateRichDocument(doc) → { ok, errors, warnings }
 *   markdownToRichDocument(markdownText, metadata) → RichDocument
 *   richDocumentToHtml(doc) → string
 *   htmlToRichDocument(html) → RichDocument
 */

import { load as loadYaml } from 'js-yaml';
import { makeDropInfo } from './extractors/shared/drop-info.mjs';

// Exported so downstream contracts (e.g. lib/export-provider-contract.mjs, construct-tsyfe.6.1)
// enumerate the same block vocabulary this module validates against, rather than redeclaring it.

export const BLOCK_TYPES = Object.freeze([
  'paragraph', 'heading', 'list', 'table', 'figure', 'media', 'code', 'diagram', 'callout', 'droppedInfo',
]);
const RUN_MARKS = Object.freeze(['bold', 'italic', 'code', 'link']);
const MEDIA_KINDS = Object.freeze(['image', 'video', 'audio']);
const LIST_STYLES = Object.freeze(['bullet', 'number']);

// Schema factories

let idCounter = 0;
let pendingImageDrops = 0;

function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
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
}

// markdownToRichDocument — line-oriented block parser plus a small inline tokenizer,
// in the same hand-rolled style as lib/deck-export-pptx.mjs's slideBlocks() (the ADR
// names that parser as one of two that must eventually agree; this is the third, and
// per the ADR's Consequences the pptx one is expected to be deleted in its favor later,
// not this bead's scope).

export function markdownToRichDocument(markdownText, metadata = {}) {
  idCounter = 0;
  pendingImageDrops = 0;
  const raw = String(markdownText || '');
  const { frontmatter, body } = extractFrontmatter(raw);
  const mergedMeta = mergeMetadata(metadata, frontmatter);

  const lines = body.split('\n');
  const sections = [];
  let preamble = makeSection({ id: nextId('section'), level: 0, title: '' });
  let current = preamble;
  const droppedNotes = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const level = heading[1].length;
      const runs = parseInlineRuns(heading[2]);
      const title = runs.map((r) => r.text).join('');
      current = makeSection({ id: uniqueSectionId(sections, preamble, title), level, title });
      current.blocks.push(makeHeadingBlock({ level, runs }));
      sections.push(current);
      i += 1;
      continue;
    }

    const consumed = parseBlockAt(lines, i, current, droppedNotes);
    i = consumed;
  }

  const allSections = preamble.blocks.length > 0 ? [preamble, ...sections] : sections;
  if (allSections.length === 0) allSections.push(preamble);
  if (pendingImageDrops > 0) {
    droppedNotes.push(makeDroppedInfoBlock({
      kind: 'inline-image',
      count: pendingImageDrops,
      reason: 'inline image mixed with running text has no Run image slot; flattened to alt text, source uri lost',
      recoverable: false,
    }));
  }
  for (const note of droppedNotes) {
    allSections[0].blocks.push(note);
  }

  return makeRichDocument(mergedMeta, allSections);
}

function uniqueSectionId(sections, preamble, title) {
  const base = slugify(title) || nextId('section');
  const taken = new Set([preamble.id, ...sections.map((s) => s.id)]);
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

function extractFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };
  let frontmatter = {};
  try {
    frontmatter = loadYaml(text.slice(3, end)) || {};
  } catch {
    frontmatter = {};
  }
  const body = text.slice(end + 4).replace(/^\n+/, '');
  return { frontmatter, body };
}

function mergeMetadata(metadata, frontmatter) {
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  const dates = fm.dates && typeof fm.dates === 'object' ? fm.dates : (fm.date ? { date: String(fm.date) } : {});
  const authors = Array.isArray(fm.authors) ? fm.authors
    : (fm.owner ? [fm.owner] : (Array.isArray(metadata.authors) ? metadata.authors : []));
  return {
    title: metadata.title ?? fm.title ?? '',
    subtitle: metadata.subtitle ?? fm.subtitle ?? '',
    authors,
    dates: { ...dates, ...(metadata.dates || {}) },
    artifactType: metadata.artifactType ?? fm.artifactType ?? fm.artifact_type ?? '',
    docId: metadata.docId ?? fm.docId ?? fm.doc_id ?? '',
    version: metadata.version != null ? String(metadata.version) : (fm.version != null ? String(fm.version) : ''),
    classification: metadata.classification ?? fm.classification ?? '',
    frontmatter: fm,
  };
}

// Dispatches one block starting at `lines[i]` into `section.blocks`, returns the next
// line index to resume from. Blank lines are skipped with no block emitted.

function parseBlockAt(lines, i, section, droppedNotes) {
  const line = lines[i];

  if (line.trim() === '') return i + 1;

  const fence = line.match(/^(```|~~~)\s*([\w-]*)\s*$/);
  if (fence) {
    const marker = fence[1];
    const lang = fence[2].toLowerCase();
    let j = i + 1;
    const code = [];
    while (j < lines.length && lines[j].trim() !== marker) {
      code.push(lines[j]);
      j += 1;
    }
    const text = code.join('\n');
    section.blocks.push(
      (lang === 'mermaid' || lang === 'd2') ? makeDiagramBlock({ lang, source: text }) : makeCodeBlock({ lang, text }),
    );
    return j + 1;
  }

  if (/^>\s?/.test(line)) {
    let j = i;
    const quoted = [];
    while (j < lines.length && /^>\s?/.test(lines[j])) {
      quoted.push(lines[j].replace(/^>\s?/, ''));
      j += 1;
    }
    const inner = makeSection({ id: nextId('quote'), level: -1, title: '' });
    let k = 0;
    while (k < quoted.length) k = parseBlockAt(quoted, k, inner, droppedNotes);
    section.blocks.push(makeCalloutBlock({ kind: 'quote', blocks: inner.blocks }));
    return j;
  }

  const imageOnly = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
  if (imageOnly) {
    const [, altText, uri, title] = imageOnly;
    section.blocks.push(makeFigureBlock({
      media: makeMediaRef({ kind: 'image', uri, mimeType: guessMime(uri) }),
      caption: title ? parseInlineRuns(title) : [],
      altText,
    }));
    return i + 1;
  }

  if (isTableLine(line) && lines[i + 1] && isTableSeparator(lines[i + 1])) {
    const headers = parseTableRow(line).map((text) => makeCell({ runs: parseInlineRuns(text) }));
    let j = i + 2;
    const rows = [];
    while (j < lines.length && isTableLine(lines[j])) {
      rows.push(parseTableRow(lines[j]).map((text) => makeCell({ runs: parseInlineRuns(text) })));
      j += 1;
    }
    section.blocks.push(makeTableBlock({ headers, rows }));
    return j;
  }

  const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
  if (listMatch) {
    return parseList(lines, i, section);
  }

  if (/^\s*- \[[ xX]\]\s+/.test(line)) {
    let j = i;
    let count = 0;
    while (j < lines.length && /^\s*- \[[ xX]\]\s+/.test(lines[j])) { j += 1; count += 1; }
    droppedNotes.push(makeDroppedInfoBlock({
      kind: 'task-list', count, reason: 'GFM task-list checkboxes are out of scope for the CommonMark-level reader', recoverable: true,
    }));
    section.blocks.push(makeParagraphBlock({ runs: [makeRun({ text: lines.slice(i, j).join(' ').replace(/^\s*- \[[ xX]\]\s+/, '').trim() })] }));
    return j;
  }

  let j = i;
  const paraLines = [];
  while (j < lines.length && lines[j].trim() !== '' && !isBlockStart(lines[j])) {
    paraLines.push(lines[j]);
    j += 1;
  }
  if (paraLines.length === 0) {
    paraLines.push(lines[j]);
    j += 1;
  }
  section.blocks.push(makeParagraphBlock({ runs: parseInlineRuns(paraLines.join(' ')) }));
  return j;
}

function isBlockStart(line) {
  return /^(```|~~~)/.test(line) || /^>\s?/.test(line) || /^(\s*)([-*+]|\d+\.)\s+/.test(line)
    || isTableLine(line) || /^#{1,6}\s+/.test(line)
    || /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.test(line.trim());
}

function isTableLine(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:-]+\|[\s:|-]*\|?\s*$/.test(line) && /-/.test(line);
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function guessMime(uri) {
  const ext = String(uri || '').split('.').pop()?.toLowerCase();
  const table = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
  return table[ext] || null;
}

// Indentation-defined nested lists. A list block's items are Block[][]; a nested list
// becomes an extra block appended to its parent item's block array, matching the schema's
// `items: Block[][]` shape rather than a flat re-indented run of markdown lines.

function parseList(lines, start, section) {
  const baseIndent = lines[start].match(/^(\s*)/)[1].length;
  const marker = lines[start].match(/^(\s*)([-*+]|\d+\.)\s+/)[2];
  const style = /\d+\./.test(marker) ? 'number' : 'bullet';
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)/);
    if (!m || m[1].length !== baseIndent) break;
    const itemMarker = m[2];
    const itemStyle = /\d+\./.test(itemMarker) ? 'number' : 'bullet';
    if (itemStyle !== style) break;

    const itemLines = [m[3]];
    i += 1;
    while (i < lines.length) {
      const indent = lines[i].match(/^(\s*)/)[1].length;
      const isNested = lines[i].trim() !== '' && indent > baseIndent;
      const isContinuation = lines[i].trim() !== '' && indent >= baseIndent && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) && indent > baseIndent;
      if (isNested || isContinuation) {
        itemLines.push(lines[i].slice(baseIndent + 2));
        i += 1;
        continue;
      }
      break;
    }

    const itemBlocks = [];
    const nestedListStart = itemLines.findIndex((l, idx) => idx > 0 && /^(\s*)([-*+]|\d+\.)\s+/.test(l));
    if (nestedListStart === -1) {
      itemBlocks.push(makeParagraphBlock({ runs: parseInlineRuns(itemLines.join(' ').trim()) }));
    } else {
      itemBlocks.push(makeParagraphBlock({ runs: parseInlineRuns(itemLines.slice(0, nestedListStart).join(' ').trim()) }));
      const nestedSection = makeSection({ id: nextId('nested'), level: -1, title: '' });
      let k = nestedListStart;
      const nestedLines = itemLines.slice(nestedListStart);
      while (k - nestedListStart < nestedLines.length) {
        k = nestedListStart + parseBlockAt(nestedLines, k - nestedListStart, nestedSection, []);
      }
      itemBlocks.push(...nestedSection.blocks);
    }
    items.push(itemBlocks);
  }

  section.blocks.push(makeListBlock({ style, items }));
  return i;
}

// Inline tokenizer: bold, italic, inline code, and links. Non-nesting (no bold-inside-italic
// combinations) — sufficient for the CommonMark-level surface this reader targets; an
// unsupported combination degrades to its outermost token's plain text rather than throwing.

function parseInlineRuns(text) {
  const src = String(text || '');
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\*[^*]+\*|_[^_]+_)/g;
  const runs = [];
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) runs.push(makeRun({ text: src.slice(last, m.index) }));
    const token = m[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      runs.push(makeRun({ text: token.slice(2, -2), marks: ['bold'] }));
    } else if (token.startsWith('`')) {
      runs.push(makeRun({ text: token.slice(1, -1), marks: ['code'] }));
    } else if (token.startsWith('!')) {
      pendingImageDrops += 1;
      runs.push(makeRun({ text: m[2] }));
    } else if (token.startsWith('[')) {
      runs.push(makeRun({ text: m[4], marks: ['link'], href: m[5] }));
    } else {
      runs.push(makeRun({ text: token.slice(1, -1), marks: ['italic'] }));
    }
    last = m.index + token.length;
  }
  if (last < src.length) runs.push(makeRun({ text: src.slice(last) }));
  if (runs.length === 0) runs.push(makeRun({ text: '' }));
  return runs;
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

// htmlToRichDocument — inverts richDocumentToHtml() output. Parses via a small generic
// tag-tree tokenizer (no DOM dependency; this repo keeps zero npm-installed markdown/HTML
// parsers per ADR-0001) rather than per-tag regexes, so nesting is handled structurally.

export function htmlToRichDocument(html) {
  idCounter = 0;
  const tree = parseHtmlTree(String(html || ''));
  const article = findFirst(tree, 'article') || { attrs: {}, children: tree };
  const metadata = {
    title: article.attrs?.['data-cx-title'] || '',
    subtitle: '',
    authors: [],
    dates: {},
    artifactType: article.attrs?.['data-cx-artifact-type'] || '',
    docId: article.attrs?.['data-cx-doc-id'] || '',
    version: article.attrs?.['data-cx-version'] || '',
    classification: article.attrs?.['data-cx-classification'] || '',
    frontmatter: {},
  };
  const sectionNodes = findAll(article, 'section');
  const sections = sectionNodes.map(sectionFromNode);
  return makeRichDocument(metadata, sections);
}

function sectionFromNode(node) {
  const level = Number(node.attrs?.['data-cx-level'] ?? 0);
  const sourceRef = node.attrs?.['data-cx-source-ref'] ? safeJson(node.attrs['data-cx-source-ref']) : null;
  const blocks = (node.children || []).filter((c) => c.type === 'element').map(blockFromNode).filter(Boolean);
  const headingBlock = blocks.find((b) => b.type === 'heading');
  return makeSection({ id: node.attrs?.id || nextId('section'), level, title: headingBlock ? headingBlock.runs.map((r) => r.text).join('') : '', blocks, sourceRef });
}

function blockFromNode(node) {
  switch (node.tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return makeHeadingBlock({ level: Number(node.tag[1]), runs: runsFromNodes(node.children) });
    case 'p':
      return makeParagraphBlock({ runs: runsFromNodes(node.children) });
    case 'ul': case 'ol':
      return makeListBlock({
        style: node.tag === 'ol' ? 'number' : 'bullet',
        items: directChildren(node, 'li').map((li) => {
          const blockChildren = li.children.filter((c) => c.type === 'element' && BLOCK_TAGS.has(c.tag));
          if (blockChildren.length) return blockChildren.map(blockFromNode).filter(Boolean);
          return [makeParagraphBlock({ runs: runsFromNodes(li.children) })];
        }),
      });
    case 'table': {
      const headerRow = findFirst(node, 'thead');
      const headers = headerRow ? findAll(headerRow, 'th').map(cellFromNode) : [];
      const bodyNode = findFirst(node, 'tbody');
      const rows = bodyNode ? findAll(bodyNode, 'tr').map((tr) => findAll(tr, 'td').map(cellFromNode)) : [];
      return makeTableBlock({ headers, rows });
    }
    case 'figure': {
      const img = findFirst(node, 'img');
      const caption = findFirst(node, 'figcaption');
      const sourceRef = node.attrs?.['data-cx-source-ref'] ? safeJson(node.attrs['data-cx-source-ref']) : null;
      return makeFigureBlock({
        media: makeMediaRef({ kind: 'image', uri: img?.attrs?.src || null, mimeType: img?.attrs?.['data-cx-mime-type'] || null }),
        caption: caption ? runsFromNodes(caption.children) : [],
        altText: img?.attrs?.alt || '',
        sourceRef,
      });
    }
    case 'img':
      return makeMediaBlock({ kind: 'image', uri: node.attrs?.src || null, mimeType: node.attrs?.['data-cx-mime-type'] || null, altText: node.attrs?.alt || null });
    case 'video': case 'audio':
      return makeMediaBlock({ kind: node.tag, uri: node.attrs?.src || null, mimeType: node.attrs?.['data-cx-mime-type'] || null, transcriptRef: node.attrs?.['data-cx-transcript-ref'] || null });
    case 'pre': {
      const codeNode = findFirst(node, 'code');
      const text = codeNode ? textOf(codeNode) : textOf(node);
      if (node.attrs?.['data-cx-diagram-lang']) return makeDiagramBlock({ lang: node.attrs['data-cx-diagram-lang'], source: text });
      const cls = codeNode?.attrs?.class || '';
      const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
      return makeCodeBlock({ lang, text });
    }
    case 'blockquote':
      return makeCalloutBlock({ kind: 'quote', blocks: node.children.filter((c) => c.type === 'element').map(blockFromNode).filter(Boolean) });
    case 'div':
      if (node.attrs?.class === 'cx-dropped-info') {
        return makeDroppedInfoBlock({
          kind: node.attrs['data-cx-kind'],
          count: Number(node.attrs['data-cx-count'] || 1),
          reason: node.attrs['data-cx-reason'],
          recoverable: node.attrs['data-cx-recoverable'] === 'true',
        });
      }
      if (node.attrs?.class === 'cx-callout') {
        return makeCalloutBlock({ kind: node.attrs['data-cx-callout-kind'] || 'note', blocks: node.children.filter((c) => c.type === 'element').map(blockFromNode).filter(Boolean) });
      }
      return null;
    default:
      return null;
  }
}

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'table', 'figure', 'img', 'video', 'audio', 'pre', 'blockquote', 'div']);

function cellFromNode(node) {
  return makeCell({
    runs: runsFromNodes(node.children),
    colspan: Number(node.attrs?.colspan || 1),
    rowspan: Number(node.attrs?.rowspan || 1),
  });
}

function runsFromNodes(nodes, inherited = []) {
  const runs = [];
  for (const node of nodes || []) {
    if (node.type === 'text') {
      if (node.text.length) runs.push(makeRun({ text: node.text, marks: [...inherited] }));
      continue;
    }
    if (node.type !== 'element') continue;
    if (node.tag === 'strong' || node.tag === 'b') { runs.push(...runsFromNodes(node.children, [...inherited, 'bold'])); continue; }
    if (node.tag === 'em' || node.tag === 'i') { runs.push(...runsFromNodes(node.children, [...inherited, 'italic'])); continue; }
    if (node.tag === 'code') { runs.push(...runsFromNodes(node.children, [...inherited, 'code'])); continue; }
    if (node.tag === 'a') {
      const inner = runsFromNodes(node.children, [...inherited, 'link']);
      inner.forEach((r) => { r.href = node.attrs?.href || ''; });
      runs.push(...inner);
      continue;
    }
    if (node.tag === 'span' && node.attrs?.['data-cx-citations']) {
      const citations = safeJson(node.attrs['data-cx-citations']) || [];
      const inner = runsFromNodes(node.children, inherited);
      inner.forEach((r) => { r.citations = citations; });
      runs.push(...inner);
      continue;
    }
    runs.push(...runsFromNodes(node.children, inherited));
  }
  return runs;
}

function textOf(node) {
  return (node.children || []).map((c) => (c.type === 'text' ? c.text : textOf(c))).join('');
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// Minimal generic HTML tag-tree tokenizer, void-element aware, restricted to the tag
// vocabulary richDocumentToHtml() emits. Not a general third-party-HTML parser.

const VOID_TAGS = new Set(['img', 'br', 'hr', 'source', 'meta', 'link']);

function parseHtmlTree(html) {
  const root = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const tagRe = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\s*\/?>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[3] !== undefined) {
      const text = decodeEntities(m[3]);
      if (text.length) stack[stack.length - 1].children.push({ type: 'text', text });
      continue;
    }
    const full = m[0];
    const isClose = full.startsWith('</');
    const tag = m[1].toLowerCase();
    if (isClose) {
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].tag === tag) { stack.length = k; break; }
      }
      continue;
    }
    const attrs = parseAttrs(m[2] || '');
    const node = { type: 'element', tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID_TAGS.has(tag) && !full.trim().endsWith('/>')) stack.push(node);
  }
  return root.children;
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([a-zA-Z_:][-\w:]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');
}

function directChildren(node, tag) {
  return (node.children || []).filter((c) => c.type === 'element' && c.tag === tag);
}

function findFirst(nodeOrList, tag) {
  const list = Array.isArray(nodeOrList) ? nodeOrList : nodeOrList.children;
  for (const node of list || []) {
    if (node.type !== 'element') continue;
    if (node.tag === tag) return node;
    const found = findFirst(node, tag);
    if (found) return found;
  }
  return null;
}

function findAll(nodeOrList, tag) {
  const list = Array.isArray(nodeOrList) ? nodeOrList : nodeOrList.children;
  const out = [];
  for (const node of list || []) {
    if (node.type !== 'element') continue;
    if (node.tag === tag) out.push(node);
    out.push(...findAll(node, tag));
  }
  return out;
}
