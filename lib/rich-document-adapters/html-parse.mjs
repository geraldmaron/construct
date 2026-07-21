/**
 * lib/rich-document-adapters/html-parse.mjs — rehype/unified HTML to RichDocument adapter.
 *
 * Parses HTML produced by richDocumentToHtml() via rehype-parse and rehype-sanitize before
 * mapping hast nodes back onto RichDocument IR. Sanitization closes javascript: href and other
 * hostile markup gaps the prior hand-rolled tag-tree parser allowed through.
 */

import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

import {
  makeRichDocument, makeSection, makeRun, makeCell,
  makeParagraphBlock, makeHeadingBlock, makeListBlock, makeTableBlock,
  makeFigureBlock, makeMediaBlock, makeCodeBlock, makeDiagramBlock,
  makeCalloutBlock, makeDroppedInfoBlock, makeMediaRef,
  resetRichDocumentParserState,
} from '../rich-document.mjs';
import { safeJson } from './shared.mjs';

const htmlProcessor = unified().use(rehypeParse, { fragment: false });

const RICHDOC_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'section', 'figure', 'figcaption', 'video', 'audio', 'source', 'article'],
  attributes: {
    ...defaultSchema.attributes,
    article: [...(defaultSchema.attributes?.article || []), 'dataCxTitle', 'dataCxDocId', 'dataCxVersion', 'dataCxArtifactType', 'dataCxClassification'],
    section: [...(defaultSchema.attributes?.section || []), 'id', 'className', 'dataCxLevel', 'dataCxSourceRef'],
    div: [...(defaultSchema.attributes?.div || []), 'className', 'dataCxKind', 'dataCxCount', 'dataCxReason', 'dataCxRecoverable', 'dataCxCalloutKind'],
    pre: [...(defaultSchema.attributes?.pre || []), 'dataCxDiagramLang'],
    img: [...(defaultSchema.attributes?.img || []), 'src', 'alt', 'dataCxMimeType'],
    video: [...(defaultSchema.attributes?.video || []), 'src', 'dataCxMimeType', 'dataCxTranscriptRef'],
    audio: [...(defaultSchema.attributes?.audio || []), 'src', 'dataCxMimeType', 'dataCxTranscriptRef'],
    figure: [...(defaultSchema.attributes?.figure || []), 'dataCxSourceRef'],
    blockquote: [...(defaultSchema.attributes?.blockquote || []), 'dataCxCallout'],
    span: [...(defaultSchema.attributes?.span || []), 'dataCxCitations'],
    a: [...(defaultSchema.attributes?.a || []), 'href'],
    td: [...(defaultSchema.attributes?.td || []), 'colSpan', 'rowSpan'],
    th: [...(defaultSchema.attributes?.th || []), 'colSpan', 'rowSpan'],
    code: [...(defaultSchema.attributes?.code || []), 'className'],
  },
};

const BLOCK_TAGS = new Set(['p', 'ul', 'ol', 'table', 'figure', 'img', 'video', 'audio', 'pre', 'blockquote', 'div']);

function normalizeSectionId(id) {
  if (!id) return undefined;
  let normalized = String(id);
  while (normalized.startsWith('user-content-')) normalized = normalized.slice('user-content-'.length);
  return normalized;
}

function classList(props) {
  const raw = props?.className;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length) return raw.split(/\s+/);
  return [];
}

export function parseHtmlToRichDocument(html) {
  resetRichDocumentParserState();
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
  return makeSection({
    id: normalizeSectionId(props.id) || undefined,
    level,
    title: headingBlock ? headingBlock.runs.map((r) => r.text).join('') : '',
    blocks,
    sourceRef,
  });
}

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
      return makeMediaBlock({
        kind: node.tagName,
        uri: props.src || null,
        mimeType: props.dataCxMimeType || null,
        transcriptRef: props.dataCxTranscriptRef || null,
      });
    case 'pre': {
      const codeNode = findFirst(node, 'code');
      const txt = codeNode ? textOf(codeNode) : textOf(node);
      const diagramLang = props.dataCxDiagramLang || props['data-cx-diagram-lang'];
      if (diagramLang) return makeDiagramBlock({ lang: diagramLang, source: txt });
      const cls = (codeNode?.properties?.className || []).join(' ');
      const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
      return makeCodeBlock({ lang, text: txt });
    }
    case 'blockquote':
      return makeCalloutBlock({ kind: 'quote', blocks: (node.children || []).filter((c) => c.type === 'element').map(blockFromHast).filter(Boolean) });
    case 'div':
      if (classList(props).includes('cx-dropped-info')) {
        return makeDroppedInfoBlock({
          kind: props.dataCxKind || props['data-cx-kind'],
          count: Number(props.dataCxCount || props['data-cx-count'] || 1),
          reason: props.dataCxReason || props['data-cx-reason'],
          recoverable: (props.dataCxRecoverable || props['data-cx-recoverable']) === 'true',
        });
      }
      if (classList(props).includes('cx-callout')) {
        return makeCalloutBlock({
          kind: props.dataCxCalloutKind || props['data-cx-callout-kind'] || 'note',
          blocks: (node.children || []).filter((c) => c.type === 'element').map(blockFromHast).filter(Boolean),
        });
      }
      return null;
    default:
      return null;
  }
}

function cellFromHast(node) {
  const props = node.properties || {};
  return makeCell({
    runs: runsFromHast(node.children),
    colspan: Number(props.colSpan || 1),
    rowspan: Number(props.rowSpan || 1),
  });
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
    if (node.tagName === 'span' && node.properties?.dataCxCitations) {
      const citations = safeJson(node.properties.dataCxCitations) || [];
      const inner = runsFromHast(node.children, inherited);
      inner.forEach((r) => { r.citations = citations; });
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
