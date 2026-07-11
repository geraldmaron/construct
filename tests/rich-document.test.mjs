/**
 * tests/rich-document.test.mjs — RichDocument IR: schema, markdown reader, HTML round-trip.
 *
 * Fixtures are real markdown files already in this repo (docs/decisions/adr/0003 for a pipe
 * table, docs/guides/cookbook/export-audit.md for nested lists + fenced code, docs/decisions/adr/0029
 * for prose-heavy sections with links/bold). No file in this repo contains a real embedded
 * image, so the figure/image and blockquote cases below use a small inline synthetic snippet
 * instead of a fourth on-disk fixture — noted honestly rather than claimed as "real repo content."
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeRichDocument, makeSection, makeParagraphBlock, makeRun, makeCitation, makeDroppedInfoBlock,
  validateRichDocument, markdownToRichDocument, richDocumentToHtml, htmlToRichDocument,
} from '../lib/rich-document.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE_FIXTURE = resolve(REPO, 'docs/decisions/adr/0003-provider-interface.md');
const NESTED_LIST_FIXTURE = resolve(REPO, 'docs/guides/cookbook/export-audit.md');
const PROSE_FIXTURE = resolve(REPO, 'docs/decisions/adr/0029-install-scopes-and-hook-budgets.md');

const SYNTHETIC_MEDIA_MD = `# Media Sample

Intro paragraph with **bold**, \`code\`, and [a link](https://example.com).

- top item one
  - nested item a
  - nested item b
- top item two

![alt text](images/diagram.png "A caption")

> A quoted remark.
> spanning two lines.

\`\`\`js
const x = 1;
\`\`\`
`;

function blockTypeSequence(doc) {
  return doc.sections.flatMap((s) => s.blocks.map((b) => b.type));
}

function allRuns(blocks) {
  const runs = [];
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') runs.push(...b.runs);
    else if (b.type === 'list') for (const item of b.items) runs.push(...allRuns(item));
    else if (b.type === 'callout') runs.push(...allRuns(b.blocks));
    else if (b.type === 'table') {
      for (const cell of b.headers) runs.push(...cell.runs);
      for (const row of b.rows) for (const cell of row) runs.push(...cell.runs);
    }
  }
  return runs;
}

// Schema shape validation

test('validateRichDocument accepts a minimal well-formed document', () => {
  const doc = makeRichDocument({ title: 'Empty' }, [makeSection({ id: 's1', level: 1, title: 'S1' })]);
  const result = validateRichDocument(doc);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('validateRichDocument rejects a block with an unrecognized type', () => {
  const section = makeSection({ id: 's1', level: 1, title: 'S1' });
  section.blocks.push({ type: 'blockquote-legacy' });
  const doc = makeRichDocument({}, [section]);
  const result = validateRichDocument(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('not a recognized Block type')));
});

test('validateRichDocument rejects sections without an id', () => {
  const doc = makeRichDocument({}, [{ level: 1, title: 'no id', blocks: [] }]);
  const result = validateRichDocument(doc);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('.id is required')));
});

// markdownToRichDocument against real fixtures

test('markdownToRichDocument extracts sections and a pipe table from a real ADR', () => {
  const md = readFileSync(TABLE_FIXTURE, 'utf8');
  const doc = markdownToRichDocument(md, {});
  assert.ok(doc.sections.length >= 5, `expected several sections, got ${doc.sections.length}`);

  const tableSection = doc.sections.find((s) => s.blocks.some((b) => b.type === 'table'));
  assert.ok(tableSection, 'no section contained a table block');
  const table = tableSection.blocks.find((b) => b.type === 'table');
  assert.deepEqual(table.headers.map((c) => c.runs.map((r) => r.text).join('')), ['Capability', 'Signature', 'Description']);
  assert.equal(table.rows.length, 5);
  assert.equal(table.rows[0][0].runs.map((r) => r.text).join(''), 'read(ref)');

  const validation = validateRichDocument(doc);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test('markdownToRichDocument extracts nested lists and code blocks from the export-audit guide', () => {
  const md = readFileSync(NESTED_LIST_FIXTURE, 'utf8');
  const doc = markdownToRichDocument(md, {});
  assert.ok(doc.sections.length >= 10, `expected many sections, got ${doc.sections.length}`);

  const listSection = doc.sections.find((s) => s.blocks.some((b) => b.type === 'list'));
  assert.ok(listSection, 'no section contained a list block');

  const codeSection = doc.sections.find((s) => s.blocks.some((b) => b.type === 'code'));
  assert.ok(codeSection, 'no section contained a code block');
  const codeBlock = codeSection.blocks.find((b) => b.type === 'code');
  assert.ok(codeBlock.text.length > 0);

  const validation = validateRichDocument(doc);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test('markdownToRichDocument carries bold/link marks through prose-heavy sections', () => {
  const md = readFileSync(PROSE_FIXTURE, 'utf8');
  const doc = markdownToRichDocument(md, {});
  assert.ok(doc.sections.length >= 3);

  const runs = allRuns(doc.sections.flatMap((s) => s.blocks));
  assert.ok(runs.some((r) => (r.marks || []).includes('bold')), 'expected at least one bold run');
  assert.ok(runs.some((r) => (r.marks || []).includes('link') && r.href), 'expected at least one link run with an href');
});

test('markdownToRichDocument builds nested list items and a figure block from a synthetic media snippet', () => {
  const doc = markdownToRichDocument(SYNTHETIC_MEDIA_MD, {});
  const types = blockTypeSequence(doc);
  assert.deepEqual(types, ['heading', 'paragraph', 'list', 'figure', 'callout', 'code']);

  const list = doc.sections[0].blocks.find((b) => b.type === 'list');
  assert.equal(list.items.length, 2);
  const nestedList = list.items[0].find((b) => b.type === 'list');
  assert.ok(nestedList, 'first item should contain a nested list block');
  assert.equal(nestedList.items.length, 2);

  const figure = doc.sections[0].blocks.find((b) => b.type === 'figure');
  assert.equal(figure.media.uri, 'images/diagram.png');
  assert.equal(figure.altText, 'alt text');
  assert.equal(figure.caption.map((r) => r.text).join(''), 'A caption');

  const callout = doc.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(callout.kind, 'quote');
});

test('markdownToRichDocument flattens an inline (non-standalone) image to alt text and records droppedInfo', () => {
  const md = '# Doc\n\nSee this ![inline shot](x.png) mid-sentence.\n';
  const doc = markdownToRichDocument(md, {});
  const para = doc.sections[0].blocks.find((b) => b.type === 'paragraph');
  assert.ok(para.runs.some((r) => r.text === 'inline shot'));
  const drop = doc.sections[0].blocks.find((b) => b.type === 'droppedInfo' && b.kind === 'inline-image');
  assert.ok(drop, 'expected a droppedInfo block noting the flattened inline image');
  assert.equal(drop.recoverable, false);
});

// richDocumentToHtml: data-cx-* attributes for fields with no native HTML slot

test('richDocumentToHtml serializes a droppedInfo block and a run citation as data-cx-* attributes', () => {
  const section = makeSection({ id: 'test-sec', level: 1, title: 'Test' });
  section.blocks.push(makeDroppedInfoBlock({ kind: 'table', count: 2, reason: 'merged cells could not be preserved', recoverable: false }));
  section.blocks.push(makeParagraphBlock({
    runs: [makeRun({ text: 'A claim', citations: [makeCitation({ sourceRef: 'src-1', locator: 'p.4', credibilityTier: 'primary' })] })],
  }));
  const doc = makeRichDocument({ title: 'Synthetic' }, [section]);
  const html = richDocumentToHtml(doc);

  assert.match(html, /class="cx-dropped-info"/);
  assert.match(html, /data-cx-kind="table"/);
  assert.match(html, /data-cx-count="2"/);
  assert.match(html, /data-cx-reason="merged cells could not be preserved"/);
  assert.match(html, /data-cx-recoverable="false"/);
  assert.match(html, /data-cx-citations="[^"]*sourceRef[^"]*"/);
});

// Round-trip: markdown -> RichDocument -> HTML -> RichDocument

test('round-trip preserves section/block-type/text structure for the table fixture', () => {
  const md = readFileSync(TABLE_FIXTURE, 'utf8');
  const first = markdownToRichDocument(md, {});
  const html = richDocumentToHtml(first);
  const second = htmlToRichDocument(html);

  assert.equal(second.sections.length, first.sections.length);
  assert.deepEqual(blockTypeSequence(second), blockTypeSequence(first));

  const textOf = (doc) => doc.sections.flatMap((s) => s.blocks).filter((b) => b.type === 'paragraph' || b.type === 'heading')
    .flatMap((b) => b.runs).map((r) => r.text).join('');
  assert.equal(textOf(second), textOf(first));
});

test('round-trip preserves nested-list and code structure for the export-audit fixture', () => {
  const md = readFileSync(NESTED_LIST_FIXTURE, 'utf8');
  const first = markdownToRichDocument(md, {});
  const html = richDocumentToHtml(first);
  const second = htmlToRichDocument(html);

  assert.deepEqual(blockTypeSequence(second), blockTypeSequence(first));

  const firstList = first.sections.flatMap((s) => s.blocks).find((b) => b.type === 'list');
  const secondList = second.sections.flatMap((s) => s.blocks).find((b) => b.type === 'list');
  assert.equal(secondList.items.length, firstList.items.length);
});

test('round-trip preserves figure/media/callout/code structure for the synthetic media snippet', () => {
  const first = markdownToRichDocument(SYNTHETIC_MEDIA_MD, {});
  const html = richDocumentToHtml(first);
  const second = htmlToRichDocument(html);

  assert.deepEqual(blockTypeSequence(second), blockTypeSequence(first));

  const fig1 = first.sections[0].blocks.find((b) => b.type === 'figure');
  const fig2 = second.sections[0].blocks.find((b) => b.type === 'figure');
  assert.equal(fig2.media.uri, fig1.media.uri);
  assert.equal(fig2.altText, fig1.altText);
  assert.equal(fig2.caption.map((r) => r.text).join(''), fig1.caption.map((r) => r.text).join(''));

  const code1 = first.sections[0].blocks.find((b) => b.type === 'code');
  const code2 = second.sections[0].blocks.find((b) => b.type === 'code');
  assert.equal(code2.text, code1.text);
  assert.equal(code2.lang, code1.lang);

  const callout2 = second.sections[0].blocks.find((b) => b.type === 'callout');
  assert.equal(callout2.kind, 'quote');
});

test('round-trip is structurally stable on a second pass (idempotent past the first HTML hop)', () => {
  const md = readFileSync(PROSE_FIXTURE, 'utf8');
  const first = markdownToRichDocument(md, {});
  const html1 = richDocumentToHtml(first);
  const second = htmlToRichDocument(html1);
  const html2 = richDocumentToHtml(second);
  const third = htmlToRichDocument(html2);

  assert.deepEqual(blockTypeSequence(third), blockTypeSequence(second));
  assert.equal(html2, richDocumentToHtml(third));
});
