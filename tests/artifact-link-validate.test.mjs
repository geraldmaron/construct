/**
 * tests/artifact-link-validate.test.mjs — citation URL extraction, inline-link
 * coverage, and fetch-based validation for typed artifacts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractHttpUrls,
  urlsMissingInlineMarkdownLinks,
  validateArtifactLinks,
} from '../lib/artifact-link-validate.mjs';

test('extractHttpUrls ignores fenced code and strips trailing punctuation', () => {
  const md = 'See https://example.com/docs).\n\n```\nhttps://example.com/ignored\n```\n';
  assert.deepEqual(extractHttpUrls(md), ['https://example.com/docs']);
});

test('urlsMissingInlineMarkdownLinks requires [label](url) form', () => {
  const bare = 'Claim https://example.com/a and done.';
  assert.deepEqual(urlsMissingInlineMarkdownLinks(bare), ['https://example.com/a']);
  const linked = 'Claim ([Example](https://example.com/a); accessed 2026-07-21).';
  assert.deepEqual(urlsMissingInlineMarkdownLinks(linked), []);
});

test('validateArtifactLinks reports failed fetches', async () => {
  const fetchImpl = async (url, opts) => {
    if (opts?.method === 'HEAD') return { status: 404, url };
    return { status: 404, url };
  };
  const result = await validateArtifactLinks('See ([X](https://example.com/missing); accessed 2026-07-21).', {
    fetchImpl,
    requireInlineMarkdownLinks: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /link failed/);
});

test('validateArtifactLinks accepts 2xx after HEAD', async () => {
  const fetchImpl = async () => ({ status: 200, url: 'https://example.com/ok' });
  const result = await validateArtifactLinks('See ([Ok](https://example.com/ok); accessed 2026-07-21).', {
    fetchImpl,
    requireInlineMarkdownLinks: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.checked, 1);
});
