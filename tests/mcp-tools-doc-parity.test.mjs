/**
 * tests/mcp-tools-doc-parity.test.mjs — every registered MCP tool is documented.
 *
 * The MCP tool reference (docs/guides/reference/mcp-tools.md) is hand-authored. This
 * guard parses the full tool catalog from lib/mcp/server.mjs (ALL_TOOL_DEFS, a
 * pure data array — every tool, including the long tail reachable through the
 * construct_call gateway) and asserts each tool name appears as a `### `name``
 * heading in the doc, so a tool cannot ship undocumented. It also flags doc
 * headings that map to no registered tool (stale entries). construct_call itself
 * is the gateway, not a catalog entry, so it is allowed in the doc.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function registeredToolNames() {
  const src = readFileSync(join(ROOT, 'lib', 'mcp', 'server.mjs'), 'utf8');
  const arrStart = src.indexOf('ALL_TOOL_DEFS = [');
  let i = src.indexOf('[', arrStart);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  // The tools array is pure data (no function calls), safe to evaluate.
  const tools = eval(`(${src.slice(i, end + 1)})`); // eslint-disable-line no-eval
  return tools.map((t) => t.name);
}

function documentedToolNames() {
  const doc = readFileSync(join(ROOT, 'docs', 'guides', 'reference', 'mcp-tools.md'), 'utf8');
  return (doc.match(/^### `[a-z_]+`/gm) || []).map((h) => h.replace(/^### `/, '').replace(/`$/, ''));
}

test('every registered MCP tool has a doc entry', () => {
  const registered = registeredToolNames();
  const documented = new Set(documentedToolNames());
  const missing = registered.filter((name) => !documented.has(name));
  assert.equal(missing.length, 0, `undocumented MCP tools: ${missing.join(', ')}`);
});

test('no doc entry references a tool that is no longer registered', () => {
  const registered = new Set(registeredToolNames());
  registered.add('construct_call'); // the gateway tool — documented, not a catalog entry
  const stale = documentedToolNames().filter((name) => !registered.has(name));
  assert.equal(stale.length, 0, `stale MCP-tool doc entries: ${stale.join(', ')}`);
});
