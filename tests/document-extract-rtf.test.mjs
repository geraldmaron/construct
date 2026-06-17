/**
 * tests/document-extract-rtf.test.mjs — cross-platform RTF fallback.
 *
 * extractRichText prefers macOS `textutil`, but that tool does not exist on
 * Linux/CI, where rich-text ingest must still degrade gracefully. rtfToText is
 * the pure-JS fallback used when textutil is absent; these pin that it strips
 * control words, groups, and escapes to plain text on any platform.
 */
import test from 'node:test';
import assert from 'node:assert';
import { rtfToText } from '../lib/document-extract.mjs';

test('strips a simple RTF document to its text', () => {
  assert.equal(
    rtfToText('{\\rtf1\\ansi Hello from a sterile RTF document.}').trim(),
    'Hello from a sterile RTF document.',
  );
});

test('drops font/color tables and resolves escapes', () => {
  const rtf = '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 caf\\\'e9 \\par done}';
  const out = rtfToText(rtf);
  assert.match(out, /café/);
  assert.match(out, /done/);
  assert.doesNotMatch(out, /fonttbl|Arial/);
});

test('translates paragraph breaks to newlines', () => {
  const out = rtfToText('{\\rtf1 line one\\par line two}');
  assert.match(out, /line one\n\s*line two/);
});

test('never throws on malformed input', () => {
  assert.doesNotThrow(() => rtfToText('not really rtf {{{ \\bad'));
  assert.equal(typeof rtfToText(''), 'string');
});
