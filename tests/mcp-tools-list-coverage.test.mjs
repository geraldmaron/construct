/**
 * tests/mcp-tools-list-coverage.test.mjs
 *
 * Pins the rule: every name dispatched by the MCP server's CallTool handler
 * must be advertised in its ListTools handler with a well-formed input
 * schema. Closes the discovery gap surfaced by `construct-efwp`: tools
 * registered only in the dispatcher are invokable if a caller knows the
 * name but invisible to LLMs that introspect via tools/list.
 *
 * The rule is enforced by static parse. dispatchToolByName's `name === 'x'`
 * branches still live in lib/mcp/server.mjs; the advertised `name: 'x'` tool
 * schema blocks were split out (construct-rf26.10) into
 * lib/mcp/tool-definitions-{project,skills,memory,workflow}.mjs to keep
 * server.mjs under the house line-count limit. The test reads server.mjs for
 * dispatch names and the concatenated tool-definitions-*.mjs sources for
 * advertised names/blocks, then asserts symmetric coverage plus shape
 * requirements on each ListTools entry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_DIR = join(HERE, '..', 'lib', 'mcp');
const SERVER_PATH = join(MCP_DIR, 'server.mjs');
const TOOL_DEF_FILES = [
  'tool-definitions-project.mjs',
  'tool-definitions-skills.mjs',
  'tool-definitions-memory.mjs',
  'tool-definitions-workflow.mjs',
];

const DISPATCH_SOURCE = readFileSync(SERVER_PATH, 'utf8');
// The `call` gateway tool's own advertisement (name: 'call') stays inline in
// server.mjs (it depends on LONG_TAIL_DEFS, computed at runtime), so the
// advertised-name source includes server.mjs alongside the split-out catalog.
const ADVERTISED_SOURCE = [DISPATCH_SOURCE, ...TOOL_DEF_FILES.map((f) => readFileSync(join(MCP_DIR, f), 'utf8'))]
  .join('\n');

function extractDispatchedNames(src) {
  const names = new Set();
  const re = /name === '([a-z_]+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

function extractAdvertisedNames(src) {
  const names = new Set();
  const re = /name: '([a-z_]+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

function extractAdvertisedToolBlocks(src) {
  const blocks = [];
  const re = /\{\s*name: '([a-z_]+)',\s*description: ('[^']+'|"[^"]+"|`[^`]+`)[\s\S]*?inputSchema: \{([\s\S]*?)\n\s{6}\},\n\s{4}\}/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    blocks.push({ name: m[1], description: m[2], schemaBody: m[3] });
  }
  return blocks;
}

test('every dispatched MCP tool is advertised in ListTools', () => {
  const dispatched = extractDispatchedNames(DISPATCH_SOURCE);
  const advertised = extractAdvertisedNames(ADVERTISED_SOURCE);
  const missing = [...dispatched].filter((n) => !advertised.has(n)).sort();
  assert.deepEqual(missing, [], `Tools dispatched in CallToolRequestSchema but missing from ListToolsRequestSchema: ${missing.join(', ')}. Add a registration entry with description + inputSchema to one of lib/mcp/tool-definitions-*.mjs.`);
});

test('no ListTools entry advertises a name the dispatcher does not handle', () => {
  const dispatched = extractDispatchedNames(DISPATCH_SOURCE);
  const advertised = extractAdvertisedNames(ADVERTISED_SOURCE);
  const orphaned = [...advertised].filter((n) => !dispatched.has(n)).sort();
  assert.deepEqual(orphaned, [], `Tools advertised in ListToolsRequestSchema but not dispatched: ${orphaned.join(', ')}. Either add a dispatch branch in lib/mcp/server.mjs or remove the registration.`);
});

test('every advertised tool has type: object inputSchema with at least a description', () => {
  const blocks = extractAdvertisedToolBlocks(ADVERTISED_SOURCE);
  assert.ok(blocks.length > 0, 'no tool blocks extracted — the source-shape parser may have drifted');
  const malformed = [];
  for (const b of blocks) {
    if (!/type:\s*'object'/.test(b.schemaBody)) malformed.push(`${b.name}: inputSchema must declare type: 'object'`);
    if (!b.description || b.description.length < 3) malformed.push(`${b.name}: missing or empty description`);
  }
  assert.deepEqual(malformed, [], `malformed tool blocks:\n  ${malformed.join('\n  ')}`);
});
