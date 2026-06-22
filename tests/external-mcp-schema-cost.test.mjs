/**
 * external-mcp-schema-cost.test.mjs — lock measured heavy-external MCP schema token cost.
 *
 * Fixtures under tests/fixtures/mcp-tool-schemas/ are captured by
 * scripts/measure-external-mcp-schemas.mjs. This test ensures the committed
 * total stays stable and matches estimateToolTokens applied to each fixture.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  measuredHeavyExternalMcpCosts,
  getMeasuredHeavyExternalMcpTokenCost,
  loadExternalMcpSchemaFixture,
} from '../lib/mcp/external-schema-cost.mjs';
import { HEAVY_EXTERNAL_MCP_IDS, estimateToolTokens } from '../lib/mcp/tool-budget.mjs';

test('every heavy external MCP server has a committed tools/list fixture', () => {
  for (const id of HEAVY_EXTERNAL_MCP_IDS) {
    const row = loadExternalMcpSchemaFixture(id);
    assert.ok(row.toolCount > 0, `${id} fixture must list at least one tool`);
    assert.equal(row.schemaTokens, estimateToolTokens(row.tools), `${id} schemaTokens must match estimateToolTokens`);
  }
});

test('measured heavy-external MCP total matches fixture manifest (2026-06-22 capture)', () => {
  const { servers, totalSchemaTokens } = measuredHeavyExternalMcpCosts();
  assert.equal(Object.keys(servers).length, HEAVY_EXTERNAL_MCP_IDS.length);
  assert.equal(servers.github.toolCount, 47);
  assert.equal(servers.github.schemaTokens, 30128);
  assert.equal(servers.playwright.toolCount, 23);
  assert.equal(totalSchemaTokens, 37281);
  assert.equal(getMeasuredHeavyExternalMcpTokenCost(), 37281);
});
