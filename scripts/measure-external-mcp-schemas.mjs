#!/usr/bin/env node
/**
 * scripts/measure-external-mcp-schemas.mjs — capture tools/list schemas for heavy external MCPs.
 *
 * Probes each server in HEAVY_EXTERNAL_MCP_IDS, writes tests/fixtures/mcp-tool-schemas/{id}.json
 * plus manifest.json, and prints per-server token estimates. Re-run when catalog package pins
 * change. github needs GITHUB_TOKEN (or GH_TOKEN); memory needs cm at CONSTRUCT_MEMORY_BRIDGE_URL
 * or a reachable backend URL passed via --memory-url.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../lib/mcp-catalog.json' with { type: 'json' };
import { resolveSecret } from '../lib/providers/secret-resolver.mjs';
import { loadStoredOAuth, copilotApiHeaders } from '../lib/providers/copilot-auth.mjs';
import {
  probeStdioMcpTools,
  probeHttpMcpTools,
  probeMemoryBridgeTools,
} from '../lib/mcp/stdio-mcp-probe.mjs';
import { HEAVY_EXTERNAL_MCP_IDS, estimateToolTokens } from '../lib/mcp/tool-budget.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const EXTERNAL_MCP_SCHEMA_FIXTURE_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'mcp-tool-schemas');
const BRIDGE = join(REPO_ROOT, 'lib', 'mcp', 'memory-bridge.mjs');

function catalogEntry(id) {
  const row = catalog.mcps.find((m) => m.id === id);
  if (!row) throw new Error(`Unknown MCP id in catalog: ${id}`);
  return row;
}

function writeFixture(id, tools) {
  const schemaTokens = estimateToolTokens(tools);
  const doc = {
    capturedAt: new Date().toISOString(),
    serverId: id,
    toolCount: tools.length,
    schemaTokens,
    tools,
  };
  writeFileSync(join(EXTERNAL_MCP_SCHEMA_FIXTURE_DIR, `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  return doc;
}

async function captureServer(id, { memoryUrl }) {
  const row = catalogEntry(id);
  if (id === 'memory') {
    return probeMemoryBridgeTools({
      bridgePath: BRIDGE,
      backendUrl: memoryUrl || process.env.CONSTRUCT_MEMORY_BRIDGE_URL || 'http://127.0.0.1:8765/',
    });
  }
  if (row.type === 'url' || id === 'github') {
    const envToken = resolveSecret('GITHUB_TOKEN', { allowAmbient: true })
      || resolveSecret('GH_TOKEN', { allowAmbient: true });
    const oauth = loadStoredOAuth()?.oauthToken?.trim() || null;
    const bearer = envToken?.trim() || oauth;
    if (!bearer) {
      throw new Error('github: set GITHUB_TOKEN, GH_TOKEN, or run construct creds login copilot');
    }
    return probeHttpMcpTools(row.url, {
      Authorization: `Bearer ${bearer}`,
      ...copilotApiHeaders(),
    });
  }
  const command = row.command || 'npx';
  const args = row.args || [];
  return probeStdioMcpTools(command, args, { env: row.env || {} });
}

async function main() {
  const memoryUrl = process.argv.find((a) => a.startsWith('--memory-url='))?.slice('--memory-url='.length);
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);
  const ids = only ? only.split(',').map((s) => s.trim()) : [...HEAVY_EXTERNAL_MCP_IDS];

  mkdirSync(EXTERNAL_MCP_SCHEMA_FIXTURE_DIR, { recursive: true });

  const servers = {};
  let totalSchemaTokens = 0;
  const failures = [];

  for (const id of ids) {
    try {
      const tools = await captureServer(id, { memoryUrl });
      const doc = writeFixture(id, tools);
      servers[id] = { toolCount: doc.toolCount, schemaTokens: doc.schemaTokens, capturedAt: doc.capturedAt };
      totalSchemaTokens += doc.schemaTokens;
      process.stderr.write(`${id}\t${doc.toolCount} tools\t${doc.schemaTokens} schema tokens\n`);
    } catch (err) {
      failures.push({ id, error: err.message || String(err) });
      process.stderr.write(`${id}\tFAILED\t${err.message || err}\n`);
    }
  }

  const manifest = {
    measuredAt: new Date().toISOString(),
    method: 'tools/list via stdio or HTTP probe; schemaTokens = JSON.stringify(tools).length * 0.25',
    servers,
    totalSchemaTokens,
    failures,
  };
  writeFileSync(join(EXTERNAL_MCP_SCHEMA_FIXTURE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (failures.length > 0) {
    process.exitCode = 1;
    process.stderr.write(`\n${failures.length} server(s) failed — fixtures for successful captures were written.\n`);
  } else {
    process.stderr.write(`\nTotal heavy external MCP schema tokens: ${totalSchemaTokens}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
