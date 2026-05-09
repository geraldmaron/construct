/**
 * tests/engine-chunker.test.mjs — heading-prefix Chunker tests.
 *
 * Asserts:
 *   - Markdown with headings produces one chunk per leaf section.
 *   - Each chunk's prefix carries the full heading chain for its location.
 *   - Plain text (no headings) collapses to a single chunk with no prefix.
 *   - Chunk ids are stable under (parent doc id, position) and metadata
 *     records the parent document id.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { create as createChunker } from '../lib/engine/chunker-headings.mjs';

const MARKDOWN = `# Authentication

Intro to auth.

## JWT

JWT details.

### Refresh

Refresh logic.

## OAuth

OAuth notes.
`;

describe('heading-prefix chunker', () => {
  it('produces one chunk per leaf section', async () => {
    const chunker = createChunker();
    const chunks = await chunker.chunk({ id: 'docs/auth.md', body: MARKDOWN });
    assert.ok(chunks.length >= 4, `expected at least 4 chunks, got ${chunks.length}`);
    const titles = chunks.map((c) => c.title);
    assert.ok(titles.includes('Authentication'));
    assert.ok(titles.includes('JWT'));
    assert.ok(titles.includes('Refresh'));
    assert.ok(titles.includes('OAuth'));
  });

  it('records the heading chain in chunk.prefix', async () => {
    const chunker = createChunker();
    const chunks = await chunker.chunk({ id: 'docs/auth.md', body: MARKDOWN });
    const refresh = chunks.find((c) => c.title === 'Refresh');
    assert.ok(refresh);
    assert.match(refresh.prefix, /# Authentication/);
    assert.match(refresh.prefix, /## JWT/);
    assert.match(refresh.prefix, /### Refresh/);
  });

  it('plain text collapses to a single chunk with no prefix', async () => {
    const chunker = createChunker();
    const chunks = await chunker.chunk({ id: 'plain', body: 'Just one paragraph of plain text.' });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].prefix, '');
    assert.match(chunks[0].body, /plain text/);
  });

  it('stable child ids and metadata.parentDocId', async () => {
    const chunker = createChunker();
    const chunks = await chunker.chunk({ id: 'docs/auth.md', body: MARKDOWN });
    for (let i = 0; i < chunks.length; i++) {
      assert.equal(chunks[i].id, `docs/auth.md#${i}`);
      assert.equal(chunks[i].metadata.parentDocId, 'docs/auth.md');
      assert.equal(chunks[i].metadata.headingChainIndex, i);
    }
  });

  it('handles array input by flattening', async () => {
    const chunker = createChunker();
    const chunks = await chunker.chunk([
      { id: 'a', body: '# Title\nbody' },
      { id: 'b', body: '# Other\nmore' },
    ]);
    assert.ok(chunks.some((c) => c.id.startsWith('a')));
    assert.ok(chunks.some((c) => c.id.startsWith('b')));
  });
});
