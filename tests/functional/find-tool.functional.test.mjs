/**
 * tests/functional/find-tool.functional.test.mjs
 *
 * find_tool ranks the tool catalog by intent. Embeddings are disabled here
 * (CONSTRUCT_EMBEDDING_DISABLE_LOCAL=1) so the deterministic BM25 path is
 * exercised — the same offline path that runs when the semantic model is not
 * provisioned. Asserts the right tool surfaces for plain-language intents.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CONSTRUCT_EMBEDDING_DISABLE_LOCAL = '1';

const { dispatchToolByName } = await import('../../lib/mcp/server.mjs');

async function names(query, limit = 5) {
  const result = await dispatchToolByName('find_tool', { query, limit });
  assert.ok(Array.isArray(result.tools), `find_tool returned tools for ${JSON.stringify(query)}`);
  return result.tools.map((t) => t.name);
}

test('find_tool surfaces the export tool for an export intent', async () => {
  const top = await names('export this markdown document to pdf');
  assert.equal(top[0], 'document_export', `document_export should rank first, got ${top.join(', ')}`);
});

test('find_tool surfaces artifact authoring for a PRD intent', async () => {
  const top = await names('write a prd about oidc');
  assert.ok(top.includes('author_artifact'), `author_artifact in top-k, got ${top.join(', ')}`);
});

test('find_tool surfaces the publish tools for a publish intent', async () => {
  const top = await names('check whether publish tooling is available', 3);
  assert.ok(
    top.includes('publish_detect') || top.includes('publish_run'),
    `a publish_* tool in top-k, got ${top.join(', ')}`,
  );
});

test('find_tool returns full schemas and a how-to-invoke note', async () => {
  const result = await dispatchToolByName('find_tool', { query: 'search the knowledge base' });
  const first = result.tools[0];
  assert.ok(first.name && first.description, 'result carries name + description');
  assert.equal(typeof first.inputSchema, 'object', 'result carries the full inputSchema');
  assert.match(result.note, /call/, 'note explains how to invoke via the call gateway');
});

test('find_tool rejects an empty query', async () => {
  const result = await dispatchToolByName('find_tool', { query: '   ' });
  assert.ok(result.error, 'empty query returns a clean error');
});

test('find_tool degrades to BM25 without error when embeddings are unavailable', async () => {
  const result = await dispatchToolByName('find_tool', { query: 'export a pdf' });
  assert.ok(!result.error && result.tools.length > 0, 'BM25-only path returns ranked tools');
});
