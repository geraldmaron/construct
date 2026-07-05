/**
 * tests/audit/f14-tools/token-budget-instrumentation.red.mjs — F14 [S2][S15] budget + telemetry.
 *
 * RED fixture (must FAIL against current code). Anthropic "writing tools for
 * agents" treats the serialized tool surface as a token budget to be measured and
 * the call path as something to instrument for calls/tokens/errors. Two grounded
 * defects:
 *
 *   1. STALE BUDGET CLAIM. Both the server comment (lib/mcp/server.mjs, "The
 *      71-tool flat surface alone (~10.6k tokens)") and the public docs
 *      (docs/guides/reference/mcp-tools.md, "a flat 71-tool surface (~10.6k
 *      tokens)") assert a size that diverges from the catalog, which holds ~75
 *      tools serializing to ~14.8k tokens flat. A budget the docs quote must
 *      track the catalog, or the headroom argument that justifies the gateway is
 *      unverifiable. The assertion recomputes the live figure and requires the
 *      documented count to equal the actual catalog size.
 *
 *   2. NO PER-CALL INSTRUMENTATION. The CallTool dispatcher imports the OTel
 *      GenAI span helper (withGenAiSpan, GenAiAttrs, injectTraceContext) but never
 *      opens a span or records a per-tool call/token/error metric — only NAME
 *      MISSES are recorded (recordToolNameMiss). A dead telemetry import is the
 *      tell: successful calls, latencies, and errors per tool are not measured, so
 *      the tool surface cannot be evaluated against real usage.
 *
 * Contract (CX-AUDIT-TOOLS-001/-003): keep the documented budget derived from the
 * live catalog and instrument the dispatch path for calls/tokens/errors. Passes
 * once the documented count matches the catalog and the dispatcher actually uses
 * its imported span helper.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const SERVER_PATH = join(ROOT, 'lib', 'mcp', 'server.mjs');
const DOC_PATH = join(ROOT, 'docs', 'guides', 'reference', 'mcp-tools.md');

// server.mjs composes ALL_TOOL_DEFS as [...HARDCODED_TOOL_DEFS, ...SCANNED_TOOL_DEFS]
// (LMCP-B5 self-registered tools) — the literal, eval-able array now lives under
// the HARDCODED_TOOL_DEFS name.

function readCatalogNames() {
  const src = readFileSync(SERVER_PATH, 'utf8');
  const arrStart = src.indexOf('HARDCODED_TOOL_DEFS = [');
  let i = src.indexOf('[', arrStart);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  // The tools array is pure data (no function calls), safe to evaluate.
  return eval(`(${src.slice(i, end + 1)})`).map((t) => t.name); // eslint-disable-line no-eval
}

test('[S2][S15] the documented flat-surface tool count matches the live catalog', () => {
  const actual = readCatalogNames().length;
  const doc = readFileSync(DOC_PATH, 'utf8');
  const src = readFileSync(SERVER_PATH, 'utf8');

  const docClaim = doc.match(/flat[\s-]*(\d+)[\s-]*tool/i);
  const srcClaim = src.match(/(\d+)-tool flat surface/i);

  assert.ok(docClaim, 'docs/guides/reference/mcp-tools.md no longer quotes a "flat N-tool surface" figure to verify');
  assert.equal(
    Number(docClaim[1]),
    actual,
    `docs claim a flat ${docClaim[1]}-tool surface but the catalog holds ${actual} tools — stale budget claim`,
  );
  if (srcClaim) {
    assert.equal(
      Number(srcClaim[1]),
      actual,
      `server comment claims a ${srcClaim[1]}-tool flat surface but the catalog holds ${actual} tools — stale budget claim`,
    );
  }
});

test('[S2][S15] the CallTool dispatcher instruments calls via its imported span helper', () => {
  const src = readFileSync(SERVER_PATH, 'utf8');

  // The import line itself does not count as use; require the helper to actually
  // wrap the dispatch so calls/tokens/errors are recorded per tool.
  const importsSpan = /import\s*\{[^}]*withGenAiSpan[^}]*\}\s*from/.test(src);
  assert.ok(importsSpan, 'precondition: server imports withGenAiSpan (the dead-import baseline this test targets)');

  const handlerStart = src.indexOf('CallToolRequestSchema, async (request)');
  assert.ok(handlerStart !== -1, 'could not locate the CallTool handler');
  const handlerBody = src.slice(handlerStart, src.indexOf('\n});', handlerStart) + 4);

  assert.match(
    handlerBody,
    /withGenAiSpan\s*\(/,
    'CallTool dispatch never opens a GenAI span: per-tool call/token/error telemetry is not recorded (withGenAiSpan imported but unused)',
  );
});
