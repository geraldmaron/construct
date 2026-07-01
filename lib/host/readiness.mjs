/**
 * lib/host/readiness.mjs — host-config readiness classifier for VS Code / Copilot.
 *
 * Distinguishes the discrete states a host-config can be in — from missing config
 * through various partial-setup failure modes to healthy — rather than collapsing
 * readiness to a binary file-presence check. Each state has an associated next-step
 * hint surfaced by `construct doctor` to guide the developer toward a working setup.
 *
 * classifyHostReadiness({ host, settingsPath, mcpPath, root }) returns a reasonCode
 * from HOST_READINESS_REASONS. Resolution order: missing_config → stale_path →
 * jsonc_unpatched → wrong_key → disabled → healthy (runtime states untrusted /
 * server_start_failure / missing_tool / sandbox_disabled require a live host session
 * and are returned when the caller supplies runtimeState evidence).
 */

import fs from 'node:fs';
import path from 'node:path';

export const HOST_READINESS_REASONS = Object.freeze([
  'missing_config',
  'stale_path',
  'jsonc_unpatched',
  'wrong_key',
  'untrusted',
  'disabled',
  'server_start_failure',
  'missing_tool',
  'sandbox_disabled',
  'healthy',
]);

export const HOST_READINESS_NEXT_STEPS = Object.freeze({
  missing_config: 'Run `construct sync` to generate host config files.',
  stale_path: 'Run `construct sync` to refresh the MCP server path.',
  jsonc_unpatched: 'Run `construct sync` to merge managed settings into your settings.json.',
  wrong_key: 'Run `construct sync` to correct the MCP autostart setting key.',
  untrusted: 'Open VS Code, find the MCP server notification, and grant trust.',
  disabled: 'Set `chat.mcp.autoStart: "always"` in your VS Code settings.',
  server_start_failure: 'Check the MCP server log: `construct mcp:logs`.',
  missing_tool: 'Run `construct sync` and restart VS Code.',
  sandbox_disabled: 'Enable the MCP sandbox in VS Code extension settings.',
  healthy: null,
});

const MANAGED_MCP_KEY_PATTERN = /\/lib\/mcp\/[a-z0-9-]+\.mjs$/i;
const AUTOSTART_KEY = 'chat.mcp.autoStart';
const AUTOSTART_KEY_WRONG_CASE_PATTERN = /^chat\.mcp\.autostart$/i;

function tryReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function isJsoncFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

export function classifyHostReadiness({
  host = 'vscode',
  settingsPath = null,
  mcpPath = null,
  root = null,
  runtimeState = null,
} = {}) {
  if (mcpPath && !fs.existsSync(mcpPath)) return 'missing_config';

  if (mcpPath && root) {
    const mcp = tryReadJson(mcpPath);
    if (mcp) {
      const servers = mcp.servers ?? {};
      const hasStale = Object.values(servers).some((s) => {
        const args = Array.isArray(s?.args) ? s.args : [];
        return args.some((arg) => {
          if (typeof arg !== 'string') return false;
          const normalArg = arg.replace(/\\/g, '/');
          const normalRoot = root.replace(/\\/g, '/');
          return MANAGED_MCP_KEY_PATTERN.test(normalArg) && !normalArg.startsWith(`${normalRoot}/`);
        });
      });
      if (hasStale) return 'stale_path';
    }
  }

  if (settingsPath) {
    if (fs.existsSync(settingsPath)) {
      if (isJsoncFile(settingsPath)) return 'jsonc_unpatched';
      const settings = tryReadJson(settingsPath);
      if (settings) {
        const hasWrongCase = Object.keys(settings).some(
          (k) => k !== AUTOSTART_KEY && AUTOSTART_KEY_WRONG_CASE_PATTERN.test(k),
        );
        if (hasWrongCase) return 'wrong_key';
        if (settings[AUTOSTART_KEY] === 'never' || settings[AUTOSTART_KEY] === false) {
          return 'disabled';
        }
      }
    }
  }

  if (runtimeState) return runtimeState;

  return 'healthy';
}
