/**
 * scripts/prototypes/richdocument-unified/unified-adapter.mjs — DISPOSABLE PROTOTYPE.
 * Not imported by lib/ or bin/.
 *
 * Maps unified's mdast/hast trees onto the *same* RichDocument IR lib/rich-document.mjs
 * defines (reuses its `make*` factories directly) so the hand-rolled pipeline and this
 * unified-based pipeline produce directly comparable output for the same input. Markdown is
 * parsed with remark-parse + remark-gfm and re-emitted with remark-stringify + remark-gfm;
 * HTML is parsed with rehype-parse + rehype-sanitize and re-emitted with rehype-stringify,
 * against the *same* cx-specific HTML shape richDocumentToHtml() emits (article/section with
 * data-cx-* attributes) — this is the fair comparison, since a stock mdast->hast pipeline has
 * no concept of Construct's sections/sourceRef/citations/droppedInfo extensions at all (a real
 * finding, not a bug: those stay Construct-owned regardless of parser).
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { load as loadYaml } from 'js-yaml';

import {
  makeRichDocument, makeSection, makeRun, makeCell,
  makeParagraphBlock, makeHeadingBlock, makeListBlock, makeTableBlock,
  makeFigureBlock, makeMediaBlock, makeCodeBlock, makeDiagramBlock,
  makeCalloutBlock, makeDroppedInfoBlock, makeMediaRef,
} from '../../../lib/rich-document.mjs';

// Same frontmatter convention lib/rich-document.mjs's (non-exported) extractFrontmatter uses —
// duplicated here rather than imported since it is a private helper, not public API.

function extractFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };
  let frontmatter = {};
  try { frontmatter = loadYaml(text.slice(3, end)) || {}; } catch { frontmatter = {}; }
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

function guessMime(uri) {
  const ext = String(uri || '').split('.').pop()?.toLowerCase();
  const table = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
  return table[ext] || null;
}

let idCounter = 0;
function nextId(prefix) { idCounter += 1; return `${prefix}-${idCounter}`; }

// ---- markdown -> mdast -> RichDocument -----------------------------------------------------

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);
const markdownStringifier = unified().use(remarkStringify, { bullet: '-', fences: true, rule: '-' }).use(remarkGfm);

export function markdownToRichDocumentUnified(markdownText, metadata = {}) {
  idCounter = 0;
  const raw = String(markdownText || '');
  const { frontmatter, body } = extractFrontmatter(raw);
  const mergedMeta = mergeMetadata(metadata, frontmatter);
  const tree = markdownProcessor.parse(body);

  const sections = [];
  let preamble = makeSection({ level: 0, title: '' });
  let current = preamble;
  const droppedNotes = [];
  const counters = { imageDrops: 0 };

  for (const node of tree.children || []) {
    if (node.type === 'heading') {
      const runs = inlineToRuns(node.children, counters);
      const title = runs.map((r) => r.text).join('');
      current = makeSection({ level: node.depth, title });
      current.blocks.push(makeHeadingBlock({ level: node.depth, runs }));
      sections.push(current);
      continue;
    }
    const block = mdastBlockToRichBlock(node, droppedNotes, counters);
    if (block) current.blocks.push(...(Array.isArray(block) ? block : [block]));
  }

  const allSections = preamble.blocks.length > 0 ? [preamble, ...sections] : sections;
  if (allSections.length === 0) allSections.push(preamble);
  if (counters.imageDrops > 0) {
    droppedNotes.push(makeDroppedInfoBlock({
      kind: 'inline-image',
      count: counters.imageDrops,
      reason: 'inline image mixed with running text has no Run image slot; flattened to alt text, source uri lost',
      recoverable: false,
    }));
  }
  for (const note of droppedNotes) allSections[0].blocks.push(note);

  return makeRichDocument(mergedMeta, allSections);
}

function mdastBlockToRichBlock(node, droppedNotes, counters) {
  switch (node.type) {
    case 'paragraph': {
      if (node.children.length === 1 && node.children[0].type === 'image') {
        const img = node.children[0];
        return makeFigureBlock({
          media: makeMediaRef({ kind: 'image', uri: img.url, mimeType: guessMime(img.url) }),
          caption: img.title ? [makeRun({ text: img.title })] : [],
          altText: img.alt || '',
        });
      }
      return makeParagraphBlock({ runs: inlineToRuns(node.children, counters) });
    }
    case 'list':
      return makeListBlock({
        style: node.ordered ? 'number' : 'bullet',
        items: node.children.map((li) => listItemToBlocks(li, droppedNotes, counters)),
      });
    case 'table': {
      const [headerRow, ...bodyRows] = node.children;
      const rowToCells = (row) => (row?.children || []).map((cell) => makeCell({ runs: inlineToRuns(cell.children, counters) }));
      return makeTableBlock({ headers: rowToCells(headerRow), rows: bodyRows.map(rowToCells) });
    }
    case 'code': {
      const lang = (node.lang || '').toLowerCase();
      return (lang === 'mermaid' || lang === 'd2')
        ? makeDiagramBlock({ lang, source: node.value })
        : makeCodeBlock({ lang, text: node.value });
    }
    case 'blockquote': {
      const inner = (node.children || []).flatMap((child) => {
        const b = mdastBlockToRichBlock(child, droppedNotes, counters);
        return b ? (Array.isArray(b) ? b : [b]) : [];
      });
      return makeCalloutBlock({ kind: 'quote', blocks: inner });
    }
    case 'thematicBreak':
      // Schema has no divider/rule Block type; hand-rolled silently swallows a lone "---" into
      // paragraph text instead (see the fidelity write-up) — this reports the gap explicitly.
      droppedNotes.push(makeDroppedInfoBlock({ kind: 'thematic-break', count: 1, reason: 'RichDocument schema has no divider/rule Block type', recoverable: false }));
      return null;
    case 'html':
      droppedNotes.push(makeDroppedInfoBlock({ kind: 'raw-html-block', count: 1, reason: 'raw HTML embedded in markdown has no RichDocument Block slot', recoverable: false }));
      return null;
    case 'definition':
    case 'footnoteDefinition':
      return null;
    default:
      droppedNotes.push(makeDroppedInfoBlock({ kind: `unmapped-${node.type}`, count: 1, reason: 'unmapped mdast node type in prototype adapter', recoverable: false }));
      return null;
  }
}

function listItemToBlocks(li, droppedNotes, counters) {
  const blocks = [];
  for (const child of li.children || []) {
    if (child.type === 'paragraph') {
      let text = inlineToRuns(child.children, counters);
      if (li.checked === true) text = [makeRun({ text: '[x] ' }), ...text];
      else if (li.checked === false) text = [makeRun({ text: '[ ] ' }), ...text];
      blocks.push(makeParagraphBlock({ runs: text }));
      continue;
    }
    const b = mdastBlockToRichBlock(child, droppedNotes, counters);
    if (b) blocks.push(...(Array.isArray(b) ? b : [b]));
  }
  if (blocks.length === 0) blocks.push(makeParagraphBlock({ runs: [makeRun({ text: '' })] }));
  return blocks;
}

function inlineToRuns(nodes, counters, inherited = []) {
  const runs = [];
  for (const node of nodes || []) {
    switch (node.type) {
      case 'text':
        if (node.value.length) runs.push(makeRun({ text: node.value, marks: [...inherited] }));
        break;
      case 'strong':
        runs.push(...inlineToRuns(node.children, counters, [...inherited, 'bold']));
        break;
      case 'emphasis':
        runs.push(...inlineToRuns(node.children, counters, [...inherited, 'italic']));
        break;
      case 'delete':
        // GFM strikethrough: RUN_MARKS has no 'strike' mark in either pipeline's schema — text
        // survives, the strikethrough styling itself is a real, schema-level (not parser-level) loss.
        runs.push(...inlineToRuns(node.children, counters, inherited));
        break;
      case 'inlineCode':
        runs.push(makeRun({ text: node.value, marks: [...inherited, 'code'] }));
        break;
      case 'link': {
        const inner = inlineToRuns(node.children, counters, [...inherited, 'link']);
        inner.forEach((r) => { r.href = node.url || ''; });
        runs.push(...inner);
        break;
      }
      case 'image':
        counters.imageDrops += 1;
        runs.push(makeRun({ text: node.alt || '', marks: [...inherited] }));
        break;
      case 'break':
        runs.push(makeRun({ text: '\n', marks: [...inherited] }));
        break;
      case 'inlineMath':
      case 'footnoteReference':
        runs.push(makeRun({ text: node.value || `[^${node.label || ''}]`, marks: [...inherited] }));
        break;
      default:
        if (node.children) runs.push(...inlineToRuns(node.children, counters, inherited));
        break;
    }
  }
  return runs;
}

// ---- RichDocument -> mdast -> markdown -----------------------------------------------------

export function richDocumentToMarkdownUnified(doc) {
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
  const header = front.length ? `---\n${front.join('\n')}\n---\n\n` : '';

  const children = (doc.sections || []).flatMap((section) => (section.blocks || []).map((block) => richBlockToMdast(block)).filter(Boolean));
  const tree = { type: 'root', children };
  const body = markdownStringifier.stringify(tree);
  return `${header}${body}`;
}

function runsToMdastInline(runs) {
  return (runs || []).map((run) => {
    let node = { type: 'text', value: String(run.text ?? '') };
    const marks = run.marks || [];
    if (marks.includes('code')) node = { type: 'inlineCode', value: node.value };
    if (marks.includes('bold')) node = { type: 'strong', children: [node] };
    if (marks.includes('italic')) node = { type: 'emphasis', children: [node] };
    if (marks.includes('link')) node = { type: 'link', url: run.href || '', children: [node.type === 'text' ? node : node] };
    return node;
  });
}

function richBlockToMdast(block) {
  switch (block.type) {
    case 'heading':
      return { type: 'heading', depth: Math.min(6, Math.max(1, block.level || 1)), children: runsToMdastInline(block.runs) };
    case 'paragraph':
      return { type: 'paragraph', children: runsToMdastInline(block.runs) };
    case 'list':
      return {
        type: 'list',
        ordered: block.style === 'number',
        children: (block.items || []).map((item) => ({
          type: 'listItem',
          children: item.map((b) => richBlockToMdast(b)).filter(Boolean),
        })),
      };
    case 'table': {
      const cellNode = (c) => ({ type: 'tableCell', children: runsToMdastInline(c.runs) });
      return {
        type: 'table',
        children: [
          { type: 'tableRow', children: (block.headers || []).map(cellNode) },
          ...(block.rows || []).map((row) => ({ type: 'tableRow', children: row.map(cellNode) })),
        ],
      };
    }
    case 'figure': {
      const media = block.media || {};
      return { type: 'paragraph', children: [{ type: 'image', url: media.uri || media.assetPath || '', alt: block.altText || '', title: (block.caption || []).map((r) => r.text).join('') || null }] };
    }
    case 'media': {
      if (block.kind === 'image') return { type: 'paragraph', children: [{ type: 'image', url: block.uri || block.assetPath || '', alt: block.altText || '' }] };
      return { type: 'paragraph', children: [{ type: 'link', url: block.uri || block.assetPath || '', children: [{ type: 'text', value: block.kind }] }] };
    }
    case 'code':
      return { type: 'code', lang: block.lang || null, value: block.text || '' };
    case 'diagram':
      return { type: 'code', lang: block.lang || null, value: block.source || '' };
    case 'callout':
      return { type: 'blockquote', children: (block.blocks || []).map((b) => richBlockToMdast(b)).filter(Boolean) };
    case 'droppedInfo':
      return { type: 'html', value: `<!-- dropped ${block.count || 1} ${block.kind || 'item'}(s): ${block.reason || ''} -->` };
    default:
      return null;
  }
}

// ---- RichDocument -> hast -> HTML (same cx-specific shape richDocumentToHtml emits) --------

const rehypeStringifier = unified().use(rehypeStringify);
const RICHDOC_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'section', 'figure', 'figcaption', 'video', 'audio', 'source'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), /^data-cx-/, 'id', 'class'],
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt'],
    video: ['src'],
    audio: ['src'],
    a: [...(defaultSchema.attributes?.a || []), 'href'],
  },
};

function el(tagName, properties, children) {
  return { type: 'element', tagName, properties: properties || {}, children: children || [] };
}
function text(value) {
  return { type: 'text', value: String(value ?? '') };
}

export function richDocumentToHtmlUnified(doc) {
  const meta = doc.metadata || {};
  const attrs = {};
  if (meta.title) attrs['data-cx-title'] = meta.title;
  if (meta.docId) attrs['data-cx-doc-id'] = meta.docId;
  if (meta.version) attrs['data-cx-version'] = meta.version;
  if (meta.artifactType) attrs['data-cx-artifact-type'] = meta.artifactType;
  if (meta.classification) attrs['data-cx-classification'] = meta.classification;
  const article = el('article', attrs, (doc.sections || []).map(sectionToHast));
  return rehypeStringifier.stringify({ type: 'root', children: [article] });
}

function sectionToHast(section) {
  const attrs = { 'data-cx-level': String(section.level) };
  if (section.id) attrs.id = section.id;
  if (section.sourceRef) attrs['data-cx-source-ref'] = JSON.stringify(section.sourceRef);
  return el('section', attrs, (section.blocks || []).map(blockToHast));
}

function blockToHast(block) {
  switch (block.type) {
    case 'heading':
      return el(`h${Math.min(6, Math.max(1, block.level || 1))}`, {}, runsToHast(block.runs));
    case 'paragraph':
      return el('p', {}, runsToHast(block.runs));
    case 'list': {
      const tag = block.style === 'number' ? 'ol' : 'ul';
      return el(tag, {}, (block.items || []).map((item) => el('li', {}, item.map(blockToHast))));
    }
    case 'table': {
      const cellEl = (c, tag) => {
        const props = {};
        if (c.colspan > 1) props.colSpan = String(c.colspan);
        if (c.rowspan > 1) props.rowSpan = String(c.rowspan);
        return el(tag, props, runsToHast(c.runs));
      };
      return el('table', {}, [
        el('thead', {}, [el('tr', {}, (block.headers || []).map((c) => cellEl(c, 'th')))]),
        el('tbody', {}, (block.rows || []).map((row) => el('tr', {}, row.map((c) => cellEl(c, 'td'))))),
      ]);
    }
    case 'figure': {
      const media = block.media || {};
      const attrs = { src: media.uri || media.assetPath || '', alt: block.altText || '' };
      if (media.mimeType) attrs['data-cx-mime-type'] = media.mimeType;
      const children = [el('img', attrs, [])];
      if (block.caption?.length) children.push(el('figcaption', {}, runsToHast(block.caption)));
      const attrs2 = block.sourceRef ? { 'data-cx-source-ref': JSON.stringify(block.sourceRef) } : {};
      return el('figure', attrs2, children);
    }
    case 'media': {
      const src = block.uri || block.assetPath || '';
      const mimeAttrs = block.mimeType ? { 'data-cx-mime-type': block.mimeType } : {};
      if (block.kind === 'image') return el('img', { src, alt: block.altText || '', ...mimeAttrs }, []);
      return el(block.kind === 'video' ? 'video' : 'audio', { src, ...mimeAttrs }, []);
    }
    case 'code':
      return el('pre', {}, [el('code', block.lang ? { className: [`language-${block.lang}`] } : {}, [text(block.text)])]);
    case 'diagram':
      return el('pre', { 'data-cx-diagram-lang': block.lang }, [el('code', {}, [text(block.source)])]);
    case 'callout': {
      const inner = (block.blocks || []).map(blockToHast);
      if (block.kind === 'quote') return el('blockquote', { 'data-cx-callout': 'true' }, inner);
      return el('div', { className: ['cx-callout'], 'data-cx-callout-kind': block.kind }, inner);
    }
    case 'droppedInfo':
      return el('div', { className: ['cx-dropped-info'], 'data-cx-kind': block.kind, 'data-cx-count': String(block.count), 'data-cx-reason': block.reason, 'data-cx-recoverable': String(!!block.recoverable) }, []);
    default:
      return text('');
  }
}

function runsToHast(runs) {
  return (runs || []).map((run) => {
    let node = text(run.text);
    const marks = run.marks || [];
    if (marks.includes('code')) node = el('code', {}, [node]);
    if (marks.includes('bold')) node = el('strong', {}, [node]);
    if (marks.includes('italic')) node = el('em', {}, [node]);
    if (marks.includes('link')) node = el('a', { href: run.href || '' }, [node]);
    return node;
  });
}

// ---- HTML -> hast(sanitized) -> RichDocument ------------------------------------------------

const htmlProcessor = unified().use(rehypeParse, { fragment: false });

export function htmlToRichDocumentUnified(html) {
  idCounter = 0;
  const raw = htmlProcessor.parse(String(html || ''));
  const tree = rehypeSanitize(RICHDOC_SANITIZE_SCHEMA)(raw);
  const article = findFirst(tree, 'article') || tree;
  const attrs = article.properties || {};
  const metadata = {
    title: attrs.dataCxTitle || '',
    subtitle: '',
    authors: [],
    dates: {},
    artifactType: attrs.dataCxArtifactType || '',
    docId: attrs.dataCxDocId || '',
    version: attrs.dataCxVersion || '',
    classification: attrs.dataCxClassification || '',
    frontmatter: {},
  };
  const sectionNodes = findAll(article, 'section');
  const sections = sectionNodes.map(sectionFromHast);
  return makeRichDocument(metadata, sections);
}

function sectionFromHast(node) {
  const props = node.properties || {};
  const level = Number(props.dataCxLevel ?? 0);
  const sourceRef = props.dataCxSourceRef ? safeJson(props.dataCxSourceRef) : null;
  const blocks = (node.children || []).filter((c) => c.type === 'element').map(blockFromHast).filter(Boolean);
  const headingBlock = blocks.find((b) => b.type === 'heading');
  return makeSection({ id: props.id || nextId('section'), level, title: headingBlock ? headingBlock.runs.map((r) => r.text).join('') : '', blocks, sourceRef });
}

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'table', 'figure', 'img', 'video', 'audio', 'pre', 'blockquote', 'div']);

function blockFromHast(node) {
  const props = node.properties || {};
  switch (node.tagName) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
      return makeHeadingBlock({ level: Number(node.tagName[1]), runs: runsFromHast(node.children) });
    case 'p':
      return makeParagraphBlock({ runs: runsFromHast(node.children) });
    case 'ul': case 'ol':
      return makeListBlock({
        style: node.tagName === 'ol' ? 'number' : 'bullet',
        items: (node.children || []).filter((c) => c.type === 'element' && c.tagName === 'li').map((li) => {
          const blockChildren = (li.children || []).filter((c) => c.type === 'element' && BLOCK_TAGS.has(c.tagName));
          if (blockChildren.length) return blockChildren.map(blockFromHast).filter(Boolean);
          return [makeParagraphBlock({ runs: runsFromHast(li.children) })];
        }),
      });
    case 'table': {
      const headerRow = findFirst(node, 'thead');
      const headers = headerRow ? findAll(headerRow, 'th').map(cellFromHast) : [];
      const bodyNode = findFirst(node, 'tbody');
      const rows = bodyNode ? findAll(bodyNode, 'tr').map((tr) => findAll(tr, 'td').map(cellFromHast)) : [];
      return makeTableBlock({ headers, rows });
    }
    case 'figure': {
      const img = findFirst(node, 'img');
      const caption = findFirst(node, 'figcaption');
      const sourceRef = props.dataCxSourceRef ? safeJson(props.dataCxSourceRef) : null;
      const imgProps = img?.properties || {};
      return makeFigureBlock({
        media: makeMediaRef({ kind: 'image', uri: imgProps.src || null, mimeType: imgProps.dataCxMimeType || null }),
        caption: caption ? runsFromHast(caption.children) : [],
        altText: imgProps.alt || '',
        sourceRef,
      });
    }
    case 'img':
      return makeMediaBlock({ kind: 'image', uri: props.src || null, mimeType: props.dataCxMimeType || null, altText: props.alt || null });
    case 'video': case 'audio':
      return makeMediaBlock({ kind: node.tagName, uri: props.src || null, mimeType: props.dataCxMimeType || null, transcriptRef: props.dataCxTranscriptRef || null });
    case 'pre': {
      const codeNode = findFirst(node, 'code');
      const txt = codeNode ? textOf(codeNode) : textOf(node);
      if (props.dataCxDiagramLang) return makeDiagramBlock({ lang: props.dataCxDiagramLang, source: txt });
      const cls = (codeNode?.properties?.className || []).join(' ');
      const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
      return makeCodeBlock({ lang, text: txt });
    }
    case 'blockquote':
      return makeCalloutBlock({ kind: 'quote', blocks: (node.children || []).filter((c) => c.type === 'element').map(blockFromHast).filter(Boolean) });
    case 'div':
      if ((props.className || []).includes('cx-dropped-info')) {
        return makeDroppedInfoBlock({
          kind: props.dataCxKind,
          count: Number(props.dataCxCount || 1),
          reason: props.dataCxReason,
          recoverable: props.dataCxRecoverable === 'true',
        });
      }
      if ((props.className || []).includes('cx-callout')) {
        return makeCalloutBlock({ kind: props.dataCxCalloutKind || 'note', blocks: (node.children || []).filter((c) => c.type === 'element').map(blockFromHast).filter(Boolean) });
      }
      return null;
    default:
      return null;
  }
}

function cellFromHast(node) {
  const props = node.properties || {};
  return makeCell({ runs: runsFromHast(node.children), colspan: Number(props.colSpan || 1), rowspan: Number(props.rowSpan || 1) });
}

function runsFromHast(nodes, inherited = []) {
  const runs = [];
  for (const node of nodes || []) {
    if (node.type === 'text') {
      if (node.value.length) runs.push(makeRun({ text: node.value, marks: [...inherited] }));
      continue;
    }
    if (node.type !== 'element') continue;
    if (node.tagName === 'strong' || node.tagName === 'b') { runs.push(...runsFromHast(node.children, [...inherited, 'bold'])); continue; }
    if (node.tagName === 'em' || node.tagName === 'i') { runs.push(...runsFromHast(node.children, [...inherited, 'italic'])); continue; }
    if (node.tagName === 'code') { runs.push(...runsFromHast(node.children, [...inherited, 'code'])); continue; }
    if (node.tagName === 'a') {
      const inner = runsFromHast(node.children, [...inherited, 'link']);
      inner.forEach((r) => { r.href = node.properties?.href || ''; });
      runs.push(...inner);
      continue;
    }
    runs.push(...runsFromHast(node.children, inherited));
  }
  return runs;
}

function textOf(node) {
  return (node.children || []).map((c) => (c.type === 'text' ? c.value : textOf(c))).join('');
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function findFirst(nodeOrList, tagName) {
  const list = Array.isArray(nodeOrList) ? nodeOrList : nodeOrList.children;
  for (const node of list || []) {
    if (node.type !== 'element') continue;
    if (node.tagName === tagName) return node;
    const found = findFirst(node, tagName);
    if (found) return found;
  }
  return null;
}

function findAll(nodeOrList, tagName) {
  const list = Array.isArray(nodeOrList) ? nodeOrList : nodeOrList.children;
  const out = [];
  for (const node of list || []) {
    if (node.type !== 'element') continue;
    if (node.tagName === tagName) out.push(node);
    out.push(...findAll(node, tagName));
  }
  return out;
}
