/**
 * lib/rich-document-adapters/markdown-parse.mjs — remark/unified markdown to RichDocument adapter.
 *
 * Parses CommonMark + GFM via remark-parse and remark-gfm, mapping mdast nodes onto the
 * RichDocument IR factories from lib/rich-document.mjs. Adopted per construct-tsyfe.3.2's
 * unified-prototype decision (ADR-0097 capability delegation over hand-rolled block parsing).
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

import {
  makeRichDocument, makeSection, makeRun, makeCell,
  makeParagraphBlock, makeHeadingBlock, makeListBlock, makeTableBlock,
  makeFigureBlock, makeCodeBlock, makeDiagramBlock,
  makeCalloutBlock, makeDroppedInfoBlock, makeMediaRef,
  resetRichDocumentParserState,
} from '../rich-document.mjs';
import { extractFrontmatter, mergeMetadata, guessMime } from './shared.mjs';

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdownToRichDocument(markdownText, metadata = {}) {
  resetRichDocumentParserState();
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
      droppedNotes.push(makeDroppedInfoBlock({ kind: 'thematic-break', count: 1, reason: 'RichDocument schema has no divider/rule Block type', recoverable: false }));
      return null;
    case 'html':
      droppedNotes.push(makeDroppedInfoBlock({ kind: 'raw-html-block', count: 1, reason: 'raw HTML embedded in markdown has no RichDocument Block slot', recoverable: false }));
      return null;
    case 'definition':
    case 'footnoteDefinition':
      return null;
    default:
      droppedNotes.push(makeDroppedInfoBlock({ kind: `unmapped-${node.type}`, count: 1, reason: 'unmapped mdast node type in markdown adapter', recoverable: false }));
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
