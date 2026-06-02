/**
 * tests/mcp-tools-doc-parity.test.mjs — every registered MCP tool is documented.
 *
 * The MCP tool reference (docs/reference/mcp-tools.md) is hand-authored. This
 * guard parses the tool registry from lib/mcp/server.mjs (the ListTools handler,
 * a pure data array) and asserts each tool name appears as a `### `name``
 * heading in the doc, so a tool cannot ship undocumented. It also flags doc
 * headings that map to no registered tool (stale entries).
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
  const arrStart = src.indexOf('tools: [', src.indexOf('ListToolsRequestSchema'));
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
  const doc = readFileSync(join(ROOT, 'docs', 'reference', 'mcp-tools.md'), 'utf8');
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
  const stale = documentedToolNames().filter((name) => !registered.has(name));
  assert.equal(stale.length, 0, `stale MCP-tool doc entries: ${stale.join(', ')}`);
});
