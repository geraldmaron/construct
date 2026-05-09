#!/usr/bin/env node
/**
 * lib/hooks/mcp-health-check.mjs — MCP health check hook — verifies MCP servers are reachable before tool use.
 *
 * Runs as PreToolUse on MCP tool calls. Checks that the target MCP server is running and reachable. Emits a warning (does not block) if the server is unavailable.
 *
 * @p95ms 51
 * @maxBlockingScope none (PreToolUse, warn-only)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const CACHE_PATH = `${homedir()}/.cx/mcp-health.json`;
const CACHE_TTL_MS = 60_000;
const markFailure = process.argv.includes('--mark-failure');

let input = {};
try {
  const raw = readFileSync(0, 'utf8').trim();
  if (raw) input = JSON.parse(raw);
} catch { /* no stdin or not JSON */ }

const toolName = input?.tool_name || input?.tool_input?.tool_name || '';

if (!toolName.startsWith('mcp__')) {
  if (!markFailure) { process.stdout.write(JSON.stringify(input) + '\n'); }
  process.exit(0);
}

const serverSlug = toolName.split('__')[1] || '';

let cache = {};
try { cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { /* fresh */ }

if (markFailure) {
  const entry = cache[serverSlug] || { status: 'healthy', since: 0, failures: 0 };
  entry.failures = (entry.failures || 0) + 1;
  entry.status = 'unhealthy';
  entry.since = Date.now();
  cache[serverSlug] = entry;
  try { writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2)); } catch { /* best effort */ }
  process.exit(0);
}

const entry = cache[serverSlug];
if (entry?.status === 'unhealthy' && (Date.now() - entry.since) < CACHE_TTL_MS) {
  process.stderr.write(
    `[mcp-health] The ${serverSlug} connection is unavailable (failed ${entry.failures} time${entry.failures !== 1 ? 's' : ''} recently). Skipping this step.\n`
  );
  process.exit(2);
}

process.stdout.write(JSON.stringify(input) + '\n');
process.exit(0);
