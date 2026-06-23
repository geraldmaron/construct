/**
 * tests/functional/chat-markdown.functional.test.mjs — terminal markdown subset.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownLines, markdownToPlain } from '../../lib/chat/tui/markdown.mjs';

test('parseMarkdownLines handles headings, lists, and code fences', () => {
  const md = '# Title\n\n- one\n- two\n\n```\ncode\n```';
  const parts = parseMarkdownLines(md, { width: 60 });
  assert.ok(parts.some((p) => p.type === 'heading' && p.text === 'Title'));
  assert.ok(parts.filter((p) => p.type === 'bullet').length >= 2);
  assert.ok(parts.some((p) => p.type === 'code' && p.text === 'code'));
});

test('parseMarkdownLines renders pipe tables as aligned rows', () => {
  const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const parts = parseMarkdownLines(md, { width: 40 });
  const rows = parts.filter((p) => p.type === 'paragraph' && p.text.includes('|'));
  assert.ok(rows.length >= 1);
});

test('markdownToPlain never throws on odd input', () => {
  const out = markdownToPlain('**bold** and `code` and | x | y |');
  assert.match(out, /bold/);
});

test('unsupported constructs pass through as paragraphs', () => {
  const parts = parseMarkdownLines('plain line > quote', { width: 40 });
  assert.ok(parts.some((p) => p.type === 'paragraph' && /quote/.test(p.text)));
});
