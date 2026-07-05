/**
 * tests/audit/f14-tools/exposure-parity.red.mjs — F14 [R36] tool-surface partition invariant.
 *
 * RED fixture (must FAIL against current code). The MCP tool catalog
 * (ALL_TOOL_DEFS) is split into a flat core (CORE_TOOL_NAMES) and a long tail
 * reached through the `call` gateway, whose enum is LONG_TAIL_DEFS. Three
 * surfaces are kept in sync BY HAND: the catalog, the CORE_TOOL_NAMES set, and
 * the docs. Existing guards (mcp-tools-list-coverage, agent-manifest) parse the
 * server SOURCE with a `name: '...'` regex and never assert the RUNTIME exposed
 * surface, so they cannot see a core/long-tail PARTITION break.
 *
 * The partition invariant that nothing guards: the actually-exposed flat tools
 * (exposedTools() minus the gateway) and the `call` enum must together cover the
 * full catalog EXACTLY ONCE — no name in CORE_TOOL_NAMES that is absent from the
 * catalog (which would silently drop a tool from BOTH the flat surface and the
 * enum, making it unreachable), no catalog tool missing from both, and no overlap.
 *
 * The fixture imports the REAL exported runtime surface and asserts an AUTOMATED
 * partition check exists by performing it. A round-trip derivation of the catalog
 * from a single declarative source is also required — none exists today; the
 * catalog is 75 inline object literals. The partition happens to hold currently,
 * so the assertion that BITES is a synthetic typo'd core name that must be
 * REJECTED by a real invariant — and no such invariant exists to reject it.
 *
 * Contract (CX-AUDIT-TOOLS-001): generate the tool registry/docs/dispatch from ONE
 * source and enforce the core/long-tail partition automatically. Passes once a
 * runtime parity check rejects a core name that is not a real catalog tool.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { exposedTools } from '../../../lib/mcp/server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, '..', '..', '..', 'lib', 'mcp', 'server.mjs');

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

// The runtime exposed surface is the only authority on what tools/list actually
// serves. Source-regex guards see object literals, not this. Splitting it here is
// what lets the partition be checked against the real catalog.

function runtimeSurface() {
  const exposed = exposedTools();
  const gateway = exposed.find((t) => t.name === 'call');
  const flat = exposed.filter((t) => t.name !== 'call').map((t) => t.name);
  const enumNames = gateway?.inputSchema?.properties?.tool?.enum ?? [];
  return { flat, enumNames, gateway };
}

test('[R36] flat core + call enum partition the catalog exactly once (no gap, no overlap)', () => {
  const catalog = new Set(readCatalogNames());
  const { flat, enumNames } = runtimeSurface();
  const surfaced = [...flat, ...enumNames];

  const overlap = flat.filter((n) => enumNames.includes(n));
  assert.deepEqual(overlap.sort(), [], `tools both flat AND in the call enum: ${overlap.join(', ')}`);

  const dupes = surfaced.filter((n, idx) => surfaced.indexOf(n) !== idx);
  assert.deepEqual([...new Set(dupes)].sort(), [], `tools surfaced more than once: ${[...new Set(dupes)].join(', ')}`);

  const missing = [...catalog].filter((n) => !flat.includes(n) && !enumNames.includes(n));
  assert.deepEqual(missing.sort(), [], `catalog tools reachable via neither flat surface nor call enum: ${missing.join(', ')}`);

  const phantom = surfaced.filter((n) => !catalog.has(n));
  assert.deepEqual([...new Set(phantom)].sort(), [], `surfaced names absent from the catalog: ${[...new Set(phantom)].join(', ')}`);
});

test('[R36] an AUTOMATED parity check rejects a core name that is not a real catalog tool', async () => {
  // A typo in the hand-maintained CORE_TOOL_NAMES (e.g. project_contxt) must be
  // refused by a runtime invariant fed from a single source of truth. The fix
  // ships an importable parity helper; the import MUST resolve once it lands.

  let assertCoreSubsetOfCatalog = null;
  try {
    ({ assertCoreSubsetOfCatalog } = await import('../../../lib/mcp/tool-surface-parity.mjs'));
  } catch {
    assertCoreSubsetOfCatalog = null;
  }
  assert.ok(
    typeof assertCoreSubsetOfCatalog === 'function',
    'no automated core-subset-of-catalog parity check exists (lib/mcp/tool-surface-parity.mjs). '
    + 'CORE_TOOL_NAMES is hand-maintained and a typo silently drops a tool from both the flat surface and the call enum.',
  );

  const catalog = new Set(readCatalogNames());
  const typo = 'project_contxt';
  assert.throws(
    () => assertCoreSubsetOfCatalog([...catalog].slice(0, 3).concat(typo), catalog),
    /catalog/i,
    'the parity check must throw when a declared core name is absent from the catalog',
  );
});
