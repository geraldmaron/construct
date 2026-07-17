/**
 * tests/security/mermaid-sanitize.test.mjs — construct-4uxq0.9.11 Mermaid
 * rendering hardening.
 *
 * Covers packages/cx-ui/components/mermaid-sanitize.ts (the allowlist SVG
 * sanitizer, size cap, and render-timeout wrapper) plus a source-inspection
 * regression test confirming packages/cx-ui/components/mermaid.tsx wires
 * `securityLevel: 'strict'` and the sanitize/size-cap/timeout helpers into
 * the render path. No React component render happens in these tests: the
 * repo carries no jsdom/testing-library harness, and adding one is out of
 * scope for the bead (no new npm dependencies) — so the size-cap and
 * timeout paths are asserted against the same predicate/wrapper the
 * component calls, and the `securityLevel`/wiring checks are grep-provable
 * against the source, both allowed explicitly by the bead's completion
 * evidence section.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  MERMAID_CHART_SIZE_LIMIT,
  MermaidTimeoutError,
  isChartOversized,
  sanitizeMermaidSvg,
  withTimeout,
} from '../../packages/cx-ui/components/mermaid-sanitize.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mermaidTsxPath = path.join(__dirname, '../../packages/cx-ui/components/mermaid.tsx');

test('sanitizeMermaidSvg strips <script> tags, paired and self-closing', () => {
  const paired = '<svg><script>alert(1)</script><rect/></svg>';
  const selfClosing = '<svg><script src="evil.js"/><rect/></svg>';
  assert.equal(sanitizeMermaidSvg(paired).includes('<script'), false);
  assert.equal(sanitizeMermaidSvg(selfClosing).includes('<script'), false);
  assert.match(sanitizeMermaidSvg(paired), /<rect\/>/);
});

test('sanitizeMermaidSvg strips on\\w+ event-handler attributes in any quoting style', () => {
  const doubleQuoted = '<svg><rect onclick="alert(1)"/></svg>';
  const singleQuoted = "<svg><rect onmouseover='alert(1)'/></svg>";
  const unquoted = '<svg><rect onfocus=alert(1)/></svg>';
  for (const input of [doubleQuoted, singleQuoted, unquoted]) {
    const out = sanitizeMermaidSvg(input);
    assert.equal(/\son\w+\s*=/i.test(out), false, `expected no event handler left in: ${out}`);
  }
});

test('sanitizeMermaidSvg strips javascript: and data:text/html URLs from href and xlink:href', () => {
  const jsHref = '<svg><a href="javascript:alert(1)"><rect/></a></svg>';
  const jsXlink = '<svg><a xlink:href="javascript:alert(1)"><rect/></a></svg>';
  const dataHtml = "<svg><a href='data:text/html,<script>alert(1)</script>'><rect/></a></svg>";
  for (const input of [jsHref, jsXlink, dataHtml]) {
    const out = sanitizeMermaidSvg(input);
    assert.equal(/javascript:/i.test(out), false, `expected no javascript: left in: ${out}`);
    assert.equal(/data:text\/html/i.test(out), false, `expected no data:text/html left in: ${out}`);
  }
});

test('sanitizeMermaidSvg removes <foreignObject>, paired and self-closing', () => {
  const paired = '<svg><foreignObject><div>html label</div></foreignObject><rect/></svg>';
  const selfClosing = '<svg><foreignObject width="1" height="1"/><rect/></svg>';
  assert.equal(sanitizeMermaidSvg(paired).includes('foreignObject'), false);
  assert.equal(sanitizeMermaidSvg(selfClosing).includes('foreignObject'), false);
});

test('sanitizeMermaidSvg hardens safe http(s) anchors with rel=noopener noreferrer and target=_blank', () => {
  const input = '<svg><a href="https://example.com/docs">link</a></svg>';
  const out = sanitizeMermaidSvg(input);
  assert.match(out, /href="https:\/\/example\.com\/docs"/);
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test('sanitizeMermaidSvg replaces a pre-existing target/rel on a safe anchor rather than duplicating it', () => {
  const input = '<svg><a href="https://example.com" target="_top" rel="opener">link</a></svg>';
  const out = sanitizeMermaidSvg(input);
  const targetMatches = out.match(/target=/g) || [];
  const relMatches = out.match(/rel=/g) || [];
  assert.equal(targetMatches.length, 1);
  assert.equal(relMatches.length, 1);
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test('sanitizeMermaidSvg leaves non-link anchors and ordinary SVG content untouched', () => {
  const input = '<svg><a class="node"><rect width="10" height="10"/><text>hello</text></a></svg>';
  const out = sanitizeMermaidSvg(input);
  assert.equal(out, input);
});

test('sanitizeMermaidSvg neutralizes a realistic multi-vector payload while preserving legitimate markup', () => {
  const input = [
    '<svg viewBox="0 0 100 100">',
    '<script>document.location="https://evil.example"</script>',
    '<g class="node" onload="alert(1)">',
    '<rect width="50" height="20" fill="#fff"/>',
    '<text>Deploy</text>',
    '</g>',
    '<a href="javascript:alert(2)"><text>bad link</text></a>',
    '<a href="https://docs.example.com/runbook"><text>runbook</text></a>',
    '<foreignObject><div onclick="alert(3)">html label</div></foreignObject>',
    '</svg>',
  ].join('');
  const out = sanitizeMermaidSvg(input);
  assert.equal(out.includes('<script'), false);
  assert.equal(/\son\w+\s*=/i.test(out), false);
  assert.equal(out.includes('foreignObject'), false);
  assert.equal(/javascript:/i.test(out), false);
  assert.match(out, /<rect width="50" height="20" fill="#fff"\/>/);
  assert.match(out, /<text>Deploy<\/text>/);
  assert.match(out, /href="https:\/\/docs\.example\.com\/runbook"/);
  assert.match(out, /target="_blank"/);
});

test('isChartOversized rejects charts over the size cap and allows charts at or under it', () => {
  const atLimit = 'a'.repeat(MERMAID_CHART_SIZE_LIMIT);
  const overLimit = 'a'.repeat(MERMAID_CHART_SIZE_LIMIT + 1);
  const wellUnder = 'graph TD; A-->B;';
  assert.equal(isChartOversized(wellUnder), false);
  assert.equal(isChartOversized(atLimit), false);
  assert.equal(isChartOversized(overLimit), true);
});

test('withTimeout resolves normally when the underlying promise settles before the deadline', async () => {
  const result = await withTimeout(Promise.resolve('svg-markup'), 1000);
  assert.equal(result, 'svg-markup');
});

test('withTimeout rejects with MermaidTimeoutError when the render never settles', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const neverResolves = new Promise(() => {});
  const pending = withTimeout(neverResolves, 8000);
  let caught = null;
  pending.catch((err) => { caught = err; });
  t.mock.timers.tick(8000);
  await assert.rejects(pending, MermaidTimeoutError);
  await Promise.resolve();
  assert.ok(caught instanceof MermaidTimeoutError);
});

test('mermaid.tsx wires securityLevel to strict, not loose', () => {
  const source = readFileSync(mermaidTsxPath, 'utf8');
  assert.match(source, /securityLevel:\s*'strict'/);
  assert.equal(/securityLevel:\s*'loose'/.test(source), false);
});

test('mermaid.tsx wires the size cap, timeout wrapper, and sanitize pass into the render path', () => {
  const source = readFileSync(mermaidTsxPath, 'utf8');
  assert.match(source, /isChartOversized\(chart\)/);
  assert.match(source, /withTimeout\(mermaid\.render\(/);
  assert.match(source, /sanitizeMermaidSvg\(svg\)/);
  assert.match(source, /ref\.current\.innerHTML = safeSvg/);
});
