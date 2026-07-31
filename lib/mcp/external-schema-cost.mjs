/**
 * lib/mcp/external-schema-cost.mjs — measured token cost for heavy external MCP servers.
 *
 * Committed fixtures under tests/fixtures/mcp-tool-schemas/ hold captured tools/list
 * payloads per server. Regenerate with scripts/measure-external-mcp-schemas.mjs.
 * Sums schemaTokens via estimateToolTokens (JSON length × 0.25) for sync-time trim
 * comments and footnotes.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEAVY_EXTERNAL_MCP_IDS, estimateToolTokens } from './tool-budget.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const EXTERNAL_MCP_SCHEMA_FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'mcp-tool-schemas');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Load one server's committed fixture; missing files throw so CI fails loudly.

export function loadExternalMcpSchemaFixture(serverId) {
  const path = join(EXTERNAL_MCP_SCHEMA_FIXTURE_DIR, `${serverId}.json`);
  if (!existsSync(path)) {
    throw new Error(`Missing external MCP schema fixture: ${path}`);
  }
  const doc = readJson(path);
  const tools = Array.isArray(doc.tools) ? doc.tools : [];
  const schemaTokens = Number.isFinite(doc.schemaTokens)
    ? doc.schemaTokens
    : estimateToolTokens(tools);
  return {
    serverId,
    capturedAt: doc.capturedAt || null,
    toolCount: tools.length,
    schemaTokens,
    tools,
  };
}

// Per-server breakdown plus total for HEAVY_EXTERNAL_MCP_IDS.

export function measuredHeavyExternalMcpCosts() {
  const servers = {};
  let totalSchemaTokens = 0;
  for (const id of HEAVY_EXTERNAL_MCP_IDS) {
    const row = loadExternalMcpSchemaFixture(id);
    servers[id] = {
      toolCount: row.toolCount,
      schemaTokens: row.schemaTokens,
      capturedAt: row.capturedAt,
    };
    totalSchemaTokens += row.schemaTokens;
  }
  return { servers, totalSchemaTokens };
}

export function measuredHeavyExternalMcpTokenCost() {
  return measuredHeavyExternalMcpCosts().totalSchemaTokens;
}

// Lazy constant — fixtures may be absent while scripts/measure-external-mcp-schemas.mjs runs.

let cachedMeasuredTotal = null;

export function getMeasuredHeavyExternalMcpTokenCost() {
  if (cachedMeasuredTotal === null) {
    cachedMeasuredTotal = measuredHeavyExternalMcpTokenCost();
  }
  return cachedMeasuredTotal;
}
