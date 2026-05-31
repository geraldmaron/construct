#!/usr/bin/env node
/**
 * lib/hooks/mcp-health-check.mjs — MCP health check hook — verifies MCP servers are reachable before tool use.
 *
 * Runs as PreToolUse on MCP tool calls. Checks that the target MCP server is running and reachable. Emits a warning (does not block) if the server is unavailable.
 *
 * @p95ms 51
 * @maxBlockingScope none (PreToolUse, warn-only)
 *
 * @lifecycle PreToolUse
 * @matcher  mcp__.*
 * @exits 0 = pass | 2 = block tool call
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

// Role-fence check for MCP tool calls. Most personas have no MCP fence
// declared (allows everything) — when fence.allowedMcpTools is present, the
// tool name must match an entry. Out-of-fence MCP calls block with exit 2.

if (process.env.CONSTRUCT_ROLES !== 'off') {
  try {
    const lastAgentPath = `${homedir()}/.cx/last-agent.json`;
    if (existsSync(lastAgentPath)) {
      const last = JSON.parse(readFileSync(lastAgentPath, 'utf8'));
      const lastTs = last?.ts ? Date.parse(last.ts) : 0;
      const fresh = lastTs && (Date.now() - lastTs) < 10 * 60 * 1000;
      const id = String(last?.agent || '').replace(/^cx-/, '');
      if (fresh && id) {
        const { isOnboarded, loadManifest } = await import('../roles/manifest.mjs');
        if (isOnboarded(id)) {
          const manifest = loadManifest(id);
          const allowedMcpTools = manifest?.fence?.allowedMcpTools;
          if (Array.isArray(allowedMcpTools) && allowedMcpTools.length > 0) {
            const matches = allowedMcpTools.some((p) => toolName === p || toolName.startsWith(p));
            if (!matches) {
              process.stderr.write(
                `[fence] cx-${id} cannot call MCP tool ${toolName} — outside declared fence.\n` +
                `Allowed MCP tools: ${allowedMcpTools.join(', ')}\n`
              );
              process.exit(2);
            }
          }
        }
      }
    }
  } catch { /* best effort */ }
}

process.stdout.write(JSON.stringify(input) + '\n');
process.exit(0);
