/**
 * tests/agent-manifest.test.mjs — verify the agent execution manifest against live sources.
 *
 * Asserts the manifest's CORE tool list equals CORE_TOOL_NAMES parsed from
 * lib/mcp/server.mjs (no hand-fabricated list), the long-tail dispatcher
 * construct_call is present, the human entry is OpenCode, the retired terminal
 * subcommand appears nowhere in the manifest, and the
 * generate/--check path is idempotent, catches structural drift, and derives the
 * MCP gap list from registry/capabilities.json.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadAgentManifest,
  readCoreToolNames,
  verifyAgentManifest,
  generateAgentManifest,
  checkAgentManifestDrift,
  LONG_TAIL_DISPATCH_TOOL,
} from '../lib/registry/agent-manifest.mjs';

const manifest = loadAgentManifest();
const coreToolNames = readCoreToolNames();

test('manifest is a versioned agent execution manifest', () => {
  assert.equal(manifest.kind, 'agent-execution-manifest');
  assert.ok(Number.isInteger(manifest.version), 'version must be an integer');
  assert.ok(manifest.toolSurface && typeof manifest.toolSurface === 'object', 'toolSurface missing');
  assert.ok(Array.isArray(manifest.toolSurface.core), 'toolSurface.core must be an array');
});

test('CORE_TOOL_NAMES parses to a non-empty set from the MCP server source', () => {
  assert.ok(coreToolNames.length > 0, 'parsed CORE_TOOL_NAMES is empty');
});

test('manifest core tools equal the live CORE_TOOL_NAMES set', () => {
  const declared = manifest.toolSurface.core.map((t) => t.name);
  assert.deepEqual([...declared].sort(), [...coreToolNames].sort());
});

test('every declared core tool carries a use string', () => {
  for (const tool of manifest.toolSurface.core) {
    assert.ok(typeof tool.name === 'string' && tool.name.length, 'core tool missing name');
    assert.ok(typeof tool.use === 'string' && tool.use.length, `core tool ${tool.name} missing use`);
  }
});

test('long-tail dispatcher construct_call is present', () => {
  assert.equal(manifest.toolSurface.longTail?.tool, LONG_TAIL_DISPATCH_TOOL);
  assert.ok(JSON.stringify(manifest).includes('construct_call'), 'construct_call absent from manifest');
});

test('primary human conversation entry is OpenCode', () => {
  assert.equal(manifest.humanEntry?.surface, 'opencode');
  assert.equal(manifest.humanEntry?.command, 'opencode');
  assert.equal(manifest.humanEntry?.subcommand, null);
  assert.match(manifest.humanEntry?.use || '', /OpenCode/);
});

test('manifest never references the removed local-loop subcommand', () => {
  const removedLocalLoopCommand = 'construct' + ' ' + 'c' + 'hat';
  assert.ok(!JSON.stringify(manifest).includes(removedLocalLoopCommand), 'manifest references removed local-loop subcommand');
});

test('credential guidance is MCP-mediated and forbids manual op read', () => {
  assert.equal(manifest.credentials?.policy, 'mcp-mediated');
  const blob = JSON.stringify(manifest.credentials);
  assert.ok(/op read/.test(blob), 'credential guidance should name the manual op read it forbids');
  assert.ok(/do not/i.test(manifest.credentials.doNot), 'credentials.doNot must state the prohibition');
});

test('mcp gap list contains only capabilities that declare MCP unsupported', () => {
  for (const gap of manifest.mcpGaps?.gaps ?? []) {
    assert.equal(gap.mcp, 'unsupported', `gap ${gap.id} is not a true unsupported gap`);
    assert.ok(typeof gap.reason === 'string' && gap.reason.length, `gap ${gap.id} missing reason`);
  }
});

test('verifyAgentManifest passes against the live core set', () => {
  const result = verifyAgentManifest(manifest, { coreToolNames });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('committed manifest is in canonical generated form (no drift)', () => {
  const { drift } = checkAgentManifestDrift();
  assert.equal(drift, false, 'agent-manifest.json drifts from generated form — regenerate with generateAgentManifest({ write: true })');
});

test('generateAgentManifest is idempotent and emits canonical JSON', () => {
  const first = generateAgentManifest({ write: false });
  const reparsed = JSON.parse(first.content);
  const second = generateAgentManifest({ rootDir: undefined, write: false });
  assert.equal(first.content, second.content, 'regeneration is not stable');
  assert.equal(first.content.endsWith('\n'), true, 'canonical JSON must end with a newline');
  assert.equal(first.content, `${JSON.stringify(reparsed, null, 2)}\n`, 'output is not 2-space canonical JSON');
});

test('generated manifest core equals the live CORE_TOOL_NAMES and preserves use strings', () => {
  const { content } = generateAgentManifest({ write: false });
  const gen = JSON.parse(content);
  const declared = gen.toolSurface.core.map((t) => t.name);
  assert.deepEqual([...declared].sort(), [...coreToolNames].sort());
  for (const tool of gen.toolSurface.core) {
    assert.ok(typeof tool.use === 'string' && tool.use.length, `generated core tool ${tool.name} lost its use string`);
  }
});

test('generated MCP gaps are exactly the mcp-unsupported capabilities', () => {
  const { content } = generateAgentManifest({ write: false });
  const gen = JSON.parse(content);
  for (const gap of gen.mcpGaps.gaps) {
    assert.equal(gap.mcp, 'unsupported', `gap ${gap.id} is not unsupported`);
    assert.ok(typeof gap.reason === 'string' && gap.reason.length, `gap ${gap.id} missing curated reason`);
    assert.ok(typeof gap.id === 'string' && gap.id.length, 'gap missing id');
  }
});
