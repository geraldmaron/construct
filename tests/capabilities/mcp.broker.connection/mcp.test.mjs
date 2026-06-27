/**
 * tests/capabilities/mcp.broker.connection/mcp.test.mjs — P0 MCP surface smoke gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { exposedTools } from '../../../lib/mcp/server.mjs';

test('MCP flat core tool set is bounded and includes orchestration_policy', () => {
  const tools = exposedTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.length <= 16, `core tool surface too large: ${names.length}`);
  assert.ok(names.includes('orchestration_policy'));
  assert.ok(names.includes('get_skill'));
});
