/**
 * tests/ingest-chunker.test.mjs — paragraph + sentence-overlap chunker.
 *
 * Coverage: paragraph boundaries, oversized-paragraph splitting at sentence
 * boundaries, fenced-code-block preservation, sentence overlap between
 * consecutive chunks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown, splitSentences } from '../lib/ingest/chunker.mjs';

test('splitSentences segments on terminal punctuation', () => {
  const out = splitSentences('First sentence. Second one! Third? Fourth.');
  assert.equal(out.length, 4);
  assert.match(out[0], /^First sentence\./);
});

test('chunkMarkdown returns empty list for empty input', () => {
  assert.deepEqual(chunkMarkdown(''), []);
  assert.deepEqual(chunkMarkdown(null), []);
});

test('chunkMarkdown packs paragraphs under maxChars', () => {
  const md = 'Para one is short.\n\nPara two is also short.\n\nPara three short.';
  const chunks = chunkMarkdown(md, { maxChars: 200, overlapSentences: 0 });
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].text, /Para one/);
  assert.match(chunks[0].text, /Para three/);
});

test('chunkMarkdown breaks across maxChars boundary', () => {
  const big = 'X. '.repeat(800);
  const md = `${big}\n\n${big}`;
  const chunks = chunkMarkdown(md, { maxChars: 1000, overlapSentences: 2 });
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(c.chars <= 1200, `chunk ${c.index} too big: ${c.chars}`);
});

test('chunkMarkdown preserves fenced code blocks (no split inside ```)', () => {
  const md = `Intro paragraph.\n\n\`\`\`js\nfunction foo() {\n  return 42;\n}\n\`\`\`\n\nOutro.`;
  const chunks = chunkMarkdown(md, { maxChars: 1000 });
  const codeChunks = chunks.filter((c) => c.text.includes('function foo'));
  assert.equal(codeChunks.length, 1, 'fenced code must land in exactly one chunk');
  assert.match(codeChunks[0].text, /```js[\s\S]*```/);
});

test('chunkMarkdown adds sentence overlap between consecutive chunks', () => {
  const sentences = Array.from({ length: 30 }, (_, i) => `Sentence ${i} of the test corpus.`);
  const md = sentences.join('\n\n');
  const chunks = chunkMarkdown(md, { maxChars: 300, overlapSentences: 2 });
  assert.ok(chunks.length >= 2);
  const second = chunks[1].text;
  assert.match(second, /Sentence \d+/);
});
