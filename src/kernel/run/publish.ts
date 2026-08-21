/**
 * kernel/run/publish.ts — the boundary between what the record keeps and what a
 * reader is handed.
 *
 * The markers are load-bearing. `[unverified]` is what the citation gate counts,
 * `[cite:path]` is what ground exhaustion reads, `[unowned]` is what the reader
 * rubric looks for. None of them can be softened on the way in without
 * softening the check that depends on them, so none of them is.
 *
 * They are also the wrong register on the way out. A composed strategy memo
 * carrying "[unverified]" three times, "[unowned]" five times, and section
 * headings named `what-would-change-it` reads as machine output, and a reader
 * discounts machine output whatever it says. Worse, it reads as *evasive* in a
 * way the underlying sentence is not: "[unverified]" sounds like a disclaimer,
 * while "we could not source this — it needs checking before anyone relies on
 * it" is a colleague telling you where the soft ground is. The second is what
 * the marker actually means.
 *
 * So the rendering happens here, at publish, and never on the way in. The
 * stored deliverable keeps every marker, the challenges keep reading the marked
 * text, and what changes is only the copy a person receives. Anything that
 * needs the record form asks for the record and gets it unrendered — this is a
 * view, not a migration.
 *
 * THE REGISTER, stated once so it is not re-decided per call site. Plain,
 * specific, and owning the limit rather than hedging it. Not "it should be
 * noted that this claim remains unverified" — that is three clauses of throat
 * clearing around one fact. Not a bare tag either. Say what is missing and what
 * it would take, in the voice of someone who did the work and knows where it
 * stopped.
 */

import type { ComposedClaim } from './compose.ts';

/** What a rendered claim carries beyond its text. */
export interface RenderedClaim {
  readonly text: string;
  /**
   * The role that produced it, already in reading form. Kept separate from the
   * text so a surface can present attribution as a byline, a footnote, or not
   * at all, rather than having it welded into the sentence.
   */
  readonly from: string;
}

/**
 * Markers rendered as clauses, longest pattern first so `[cite:...]` is not
 * eaten by a looser rule.
 *
 * Each replacement says the same thing the marker says. That constraint is what
 * keeps this a rendering rather than an edit: a marker that rendered as
 * something weaker than it meant would be the softening this module exists to
 * refuse, wearing the costume of a house style.
 */
const RENDERINGS: readonly { readonly pattern: RegExp; readonly render: (m: RegExpMatchArray) => string }[] = [
  {
    // A citation is a source, and a reader wants it the way a colleague gives
    // one: named, in passing, not wrapped in a machine bracket.
    pattern: /\[cite:\s*([^\]]+)\]/gi,
    render: (m) => `(${basename(m[1].trim())})`,
  },
  {
    pattern: /\[research:\s*([^\]]+)\]/gi,
    render: (m) => `(${m[1].trim()})`,
  },
  {
    // The tag means: nothing in the material settles this. Said plainly, that
    // is a request for a specific piece of work, which is more useful to a
    // reader than a status word.
    pattern: /\s*\[unverified(?::\s*([^\]]+))?\]/gi,
    render: (m) =>
      m[1] ? ` — not confirmed against a source; ${m[1].trim()}` : ' — this one still needs checking against a source',
  },
  {
    // Not "owner: none". The absence of an owner is a thing somebody has to do
    // something about, and naming it that way is the difference between a
    // field and a sentence.
    pattern: /\s*\[unowned(?::\s*([^\]]+))?\]/gi,
    render: (m) => (m[1] ? ` — nobody is named for this yet: ${m[1].trim()}` : ' — nobody is named for this yet'),
  },
  {
    // An assumption the work stands on. Worth flagging precisely because the
    // conclusion falls if it is wrong.
    pattern: /\s*\[assumed:\s*([^\]]+)\]/gi,
    render: (m) => ` — taking it that ${lowerFirst(m[1].trim())}`,
  },
  {
    pattern: /\s*\[assumed\]/gi,
    render: () => ' — assumed rather than established',
  },
];

function basename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(-2).join('/') : (parts[0] ?? path);
}

/**
 * Sentence-openers that read wrong capitalised mid-clause, and nothing else.
 *
 * The obvious rule — lowercase the first letter — turns "Firestore is no longer
 * the read path" into "firestore", renaming a product inside a claim the reader
 * is being asked to check. Miscapitalising a proper noun is a worse error than
 * a stray capital, so only words that are certainly not names are touched.
 */
const SENTENCE_OPENERS = new Set([
  'the', 'this', 'that', 'these', 'those', 'it', 'a', 'an', 'there', 'no',
  'not', 'nothing', 'nobody', 'we', 'they', 'its', 'their',
]);

function lowerFirst(text: string): string {
  const first = /^[A-Za-z]+/.exec(text)?.[0];
  if (first === undefined) return text;
  return SENTENCE_OPENERS.has(first.toLowerCase()) && first === first[0] + first.slice(1).toLowerCase()
    ? first.toLowerCase() + text.slice(first.length)
    : text;
}

/**
 * One claim, in the words a reader gets.
 *
 * Idempotent by construction: rendered text carries no markers, so rendering it
 * twice is rendering it once. That matters because a surface that renders and
 * then re-renders on a redraw would otherwise accumulate clauses.
 */
export function renderClaim(text: string): string {
  // Two clauses colliding at a sentence end read worse than either alone.
  return substituted(text).replace(/\s+—\s+—\s+/g, ' — ').replace(/\s{2,}/g, ' ').trim();
}

/** Every marker in one string, rendered; whitespace left exactly as it was. */
function substituted(text: string): string {
  let rendered = text;
  for (const { pattern, render } of RENDERINGS) {
    rendered = rendered.replace(pattern, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpMatchArray;
      return render(match);
    });
  }
  return rendered;
}

/**
 * A whole deliverable, in the words a reader gets.
 *
 * Line by line rather than all at once, and deliberately gentler than
 * renderClaim: a deliverable is a document, and its indentation, nested lists,
 * and blank lines are structure a reader depends on. renderClaim's whitespace
 * collapse is right for one sentence and would flatten a document into a
 * paragraph, which is why the substitution loop is shared and the tidying is
 * not.
 *
 * Fenced code is left exactly as written. A marker inside a fence is content —
 * somebody quoting the notation, or a config that happens to use brackets —
 * and rendering it would edit the thing the author was showing.
 */
export function renderDocument(text: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      lines.push(line);
      continue;
    }
    if (inFence) {
      lines.push(line);
      continue;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? '';
    lines.push(
      indent + substituted(line.slice(indent.length)).replace(/\s+—\s+—\s+/g, ' — ').replace(/ {2,}/g, ' ').trimEnd(),
    );
  }
  return lines.join('\n');
}

/**
 * A section slug as a heading.
 *
 * The shapes name their sections in kebab-case because they are identifiers
 * that code matches on. A reader is not reading identifiers. Rendered as a
 * sentence rather than title-cased, because Title Case On Every Heading is its
 * own kind of machine voice.
 */
export function renderHeading(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim();
  return words.length > 0 ? words[0].toUpperCase() + words.slice(1) : slug;
}

/**
 * A role id as a byline.
 *
 * Concern ids are hyphenated because they are keys. Spoken aloud they are
 * ordinary English, and that is how they are written to a reader.
 */
export function renderAttribution(role: string): string {
  return role.replace(/[-_]+/g, ' ');
}

/**
 * One composed claim, in the shape its kind actually calls for — not the
 * bullet every kind used to be forced into regardless of what it said.
 *
 * `asRecord` keeps the same meaning it has everywhere else in this module:
 * markers and slugs intact for anything downstream that reads the stored
 * form, rendered prose for a reader. renderClaim only ever touches prose —
 * a table's cells and a diagram's mermaid source are left exactly as the
 * composer wrote them, because the marker substitutions are built for
 * sentences and running them over a mermaid `-->` or a table cell risks
 * mangling syntax a reader (or a diagram renderer) depends on being literal.
 */
export function renderComposedClaim(claim: ComposedClaim, asRecord: boolean): string {
  const from = asRecord ? claim.from : renderAttribution(claim.from);
  switch (claim.kind) {
    case 'paragraph':
      return `${asRecord ? claim.text : renderClaim(claim.text)}\n\n— *${from}*\n`;
    case 'table': {
      const table = claim.table;
      if (table === undefined || table.headers.length === 0) return '';
      const caption = asRecord ? claim.text : renderClaim(claim.text);
      const header = `| ${table.headers.join(' | ')} |`;
      const rule = `| ${table.headers.map(() => '---').join(' | ')} |`;
      const rows = table.rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
      return `${caption}\n\n${header}\n${rule}\n${rows}\n\n— *${from}*\n`;
    }
    case 'diagram':
      return `\`\`\`mermaid\n${claim.text}\n\`\`\`\n\n— *${from}*\n`;
    case 'bullet':
    default:
      return `- ${asRecord ? claim.text : renderClaim(claim.text)} [${from}]`;
  }
}
