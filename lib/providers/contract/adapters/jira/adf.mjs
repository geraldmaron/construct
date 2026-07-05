/**
 * lib/providers/contract/adapters/jira/adf.mjs — Atlassian Document Format
 * (ADF) construction for Jira Cloud write fields.
 *
 * Jira Cloud REST API v3 requires `description`, `comment.body`, and any
 * multiline custom field of type `doc` to be submitted as an ADF document
 * rather than plain text. Covers the minimal ADF subset issue/comment write
 * ops need: paragraphs split on blank lines, single-level bullet lists for
 * lines starting with "- " or "* ", and inline text nodes. Full markdown
 * fidelity (headings, tables, nested lists) is out of scope.
 *
 * `renderAdfPreview(adf)` renders an ADF document back to a readable plain
 * string for dry-run display, so a human reviewing a dry-run payload sees
 * text rather than a raw ADF tree.
 */

const ADF_VERSION = 1;

function textNode(text) {
  return { type: 'text', text: String(text) };
}

function paragraphNode(text) {
  return { type: 'paragraph', content: text ? [textNode(text)] : [] };
}

function bulletListNode(items) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraphNode(item)],
    })),
  };
}

// Blank-line-separated blocks become paragraphs; a contiguous run of lines
// each starting with "- " or "* " becomes a single bullet list. This covers
// the shapes specialists actually produce (short prose + a checklist) without
// pretending to be a markdown parser.

function blocksFromText(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let paragraphLines = [];
  let listItems = [];

  function flushParagraph() {
    if (paragraphLines.length) {
      blocks.push(paragraphNode(paragraphLines.join(' ').trim()));
      paragraphLines = [];
    }
  }
  function flushList() {
    if (listItems.length) {
      blocks.push(bulletListNode(listItems));
      listItems = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(bulletMatch[1]);
    } else if (line === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphLines.push(line);
    }
  }
  flushParagraph();
  flushList();

  return blocks.length ? blocks : [paragraphNode('')];
}

/**
 * Build a full ADF document from a plain-text (or already-ADF) input.
 * Passing an object that already looks like an ADF doc (`{ type: 'doc' }`)
 * returns it unchanged so callers can pass through pre-built documents.
 *
 * @param {string|object} content
 * @returns {object} ADF document
 */
export function buildAdfDocument(content) {
  if (content && typeof content === 'object' && content.type === 'doc') {
    return content;
  }
  return {
    type: 'doc',
    version: ADF_VERSION,
    content: blocksFromText(content),
  };
}

/**
 * Render an ADF document (or plain text) back to a flat human-readable
 * string, for dry-run display. Not a full ADF renderer — only understands
 * the node types buildAdfDocument produces plus a defensive fallback for
 * unknown node types (renders as `[<type>]`).
 *
 * @param {object|string} adf
 * @returns {string}
 */
export function renderAdfPreview(adf) {
  if (typeof adf === 'string') return adf;
  if (!adf || typeof adf !== 'object') return '';

  function renderNode(node) {
    if (!node || typeof node !== 'object') return '';
    switch (node.type) {
      case 'doc':
        return (node.content ?? []).map(renderNode).join('\n');
      case 'paragraph':
        return (node.content ?? []).map(renderNode).join('');
      case 'text':
        return node.text ?? '';
      case 'bulletList':
        return (node.content ?? []).map((item) => `- ${renderNode(item)}`).join('\n');
      case 'listItem':
        return (node.content ?? []).map(renderNode).join('').trim();
      default:
        return `[${node.type ?? 'unknown'}]`;
    }
  }

  return renderNode(adf);
}

/**
 * True when the given value is a well-formed ADF document envelope
 * (`{ type: 'doc', version, content: [...] }`). Distinguishes a doc node
 * from a bare string, for rejecting fields the API requires as ADF but
 * were submitted as plain text.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAdfDocument(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    value.type === 'doc' &&
    typeof value.version === 'number' &&
    Array.isArray(value.content)
  );
}
