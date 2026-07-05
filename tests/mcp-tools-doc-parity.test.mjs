/**
 * tests/mcp-tools-doc-parity.test.mjs — every registered MCP tool is documented.
 *
 * The MCP tool reference (docs/guides/reference/mcp-tools.md) is hand-authored. This
 * guard imports the real merged tool catalog from lib/mcp/server.mjs
 * (ALL_TOOL_DEFS — the hand-maintained HARDCODED_TOOL_DEFS plus any
 * self-registered `*.tool.mjs` module under lib/mcp/tools/, see
 * lib/mcp/tool-registry.mjs) and asserts each tool name appears as a
 * `### `name`` heading in the doc, so a tool cannot ship undocumented. It also
 * flags doc headings that map to no registered tool (stale entries).
 * construct_call itself is the gateway, not a catalog entry, so it is allowed
 * in the doc.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

async function registeredToolNames() {
  const { ALL_TOOL_DEFS } = await import(`../lib/mcp/server.mjs?doc-parity=${Date.now()}`);
  return ALL_TOOL_DEFS.map((t) => t.name);
}

function documentedToolNames() {
  const doc = readFileSync(join(ROOT, 'docs', 'guides', 'reference', 'mcp-tools.md'), 'utf8');
  return (doc.match(/^### `[a-z_]+`/gm) || []).map((h) => h.replace(/^### `/, '').replace(/`$/, ''));
}

test('every registered MCP tool has a doc entry', async () => {
  const registered = await registeredToolNames();
  const documented = new Set(documentedToolNames());
  const missing = registered.filter((name) => !documented.has(name));
  assert.equal(missing.length, 0, `undocumented MCP tools: ${missing.join(', ')}`);
});

test('no doc entry references a tool that is no longer registered', async () => {
  const registered = new Set(await registeredToolNames());
  registered.add('call'); // the gateway tool — documented, not a catalog entry
  const stale = documentedToolNames().filter((name) => !registered.has(name));
  assert.equal(stale.length, 0, `stale MCP-tool doc entries: ${stale.join(', ')}`);
});
