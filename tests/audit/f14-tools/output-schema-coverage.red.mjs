/**
 * tests/audit/f14-tools/output-schema-coverage.red.mjs — F14 [S2][S15] structured outputs.
 *
 * RED fixture (must FAIL against current code). Every Construct MCP tool returns
 * machine-consumed data: the CallTool handler serializes each result with
 * JSON.stringify and ships it as a single text block (lib/mcp/server.mjs). Per
 * Anthropic "writing tools for agents", tools returning structured data the model
 * must parse should declare an OUTPUT SCHEMA so the host can validate shape and
 * the model can rely on field names. The MCP SDK supports `outputSchema` +
 * `structuredContent` for exactly this.
 *
 * Today not one of the catalog tools declares an outputSchema (grep for
 * outputSchema/output_schema across lib/mcp returns nothing). This fixture
 * enumerates the catalog and asserts every machine-consumed tool carries an
 * outputSchema — proving the gap with the full list of tools lacking one.
 *
 * Scope note: a small set of tools are effectively side-effecting acknowledgements
 * (no structured payload a caller parses). They are exempted by name below so the
 * assertion targets genuine data-returning tools; the exemption list is
 * deliberately tiny, so the failure is dominated by real data tools.
 *
 * Contract (CX-AUDIT-TOOLS-002): declare output schemas for machine-consumed MCP
 * tools and return structuredContent. Passes once each non-exempt catalog tool
 * declares an outputSchema.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, '..', '..', '..', 'lib', 'mcp', 'server.mjs');

function readCatalog() {
  const src = readFileSync(SERVER_PATH, 'utf8');
  const arrStart = src.indexOf('ALL_TOOL_DEFS = [');
  let i = src.indexOf('[', arrStart);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  // The tools array is pure data (no function calls), safe to evaluate.
  return eval(`(${src.slice(i, end + 1)})`); // eslint-disable-line no-eval
}

// Pure side-effecting acks with no parsed payload. Kept intentionally minimal so
// the assertion bites on real data-returning tools rather than being defined away.

const SIDE_EFFECTING_EXEMPT = new Set([
  'storage_sync', 'storage_reset', 'delete_ingested_artifacts',
]);

test('[S2][S15] every machine-consumed MCP tool declares an output schema', () => {
  const catalog = readCatalog();
  const missing = catalog
    .filter((t) => !SIDE_EFFECTING_EXEMPT.has(t.name))
    .filter((t) => !t.outputSchema && !t.output_schema)
    .map((t) => t.name);

  assert.deepEqual(
    missing,
    [],
    `MCP tools returning machine-consumed data with NO output schema (${missing.length}/${catalog.length}):\n  ${missing.join('\n  ')}`,
  );
});
