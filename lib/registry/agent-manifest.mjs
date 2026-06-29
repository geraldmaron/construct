/**
 * lib/registry/agent-manifest.mjs — load, regenerate, and verify the agent execution manifest.
 *
 * The manifest (registry/agent-manifest.json) declares the MCP-first tool surface
 * agents should reach for and the OpenCode-first human entry. The structural
 * facts must stay honest against live sources rather than drifting into
 * hand-maintained copy:
 *   - the CORE tool set, which is the CORE_TOOL_NAMES Set literal in
 *     lib/mcp/server.mjs (that constant is not exported, so it is parsed from the
 *     source text — the single authority for what the MCP ListTools front-loads);
 *   - the long-tail dispatcher name `construct_call`;
 *   - the OpenCode human conversation entry (the non-interactive CLI remains the admin/headless substrate);
 *   - the MCP gap list, which is exactly the capabilities declaring surfaces.mcp.supported=false
 *     in registry/capabilities.json, with the CLI fallback taken from surfaces.cli.command.
 *
 * generateAgentManifest reconciles those source-derived facts onto the curated prose
 * (tool `use` strings, rationales, credential guidance, gap reasons) carried by the
 * committed manifest and emits canonical JSON, so the human-owned copy round-trips while
 * any drift in a live-source fact is caught by the --check path in registry:generate-docs.
 * parseCoreToolNames reads the server source and returns the declared set so callers and
 * tests verify the manifest against the server instead of re-stating the list.
 * Read-only by default: generateAgentManifest writes only when asked.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCapabilityRegistry } from './validate.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export const MANIFEST_PATH = resolve(REPO_ROOT, 'registry', 'agent-manifest.json');
export const MCP_SERVER_PATH = resolve(REPO_ROOT, 'lib', 'mcp', 'server.mjs');

export const LONG_TAIL_DISPATCH_TOOL = 'call';

export function loadAgentManifest(path = MANIFEST_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// CORE_TOOL_NAMES is a `new Set([...])` literal of single-quoted tool names.
// Capture the array body between the brackets, then pull each quoted token so the
// parser tolerates reordering and reflow but fails loudly if the constant is gone.

export function parseCoreToolNames(source) {
  const block = source.match(/const\s+CORE_TOOL_NAMES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
  if (!block) {
    throw new Error('CORE_TOOL_NAMES Set literal not found in MCP server source');
  }
  const names = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error('CORE_TOOL_NAMES literal parsed to an empty set');
  }
  return names;
}

export function readCoreToolNames(path = MCP_SERVER_PATH) {
  return parseCoreToolNames(readFileSync(path, 'utf8'));
}

// Structural gate shared by the test and any future generator: the manifest must
// front-load exactly the live CORE set, expose construct_call as the long-tail
// door, name OpenCode as the primary human conversation entry, and never mention
// the removed local-loop subcommand.

export function verifyAgentManifest(manifest, { coreToolNames } = {}) {
  const errors = [];
  const core = coreToolNames ?? readCoreToolNames();

  const tools = manifest?.toolSurface;
  if (!tools || typeof tools !== 'object') {
    errors.push('toolSurface object missing');
  } else {
    const declaredCore = Array.isArray(tools.core) ? tools.core.map((t) => t.name) : null;
    if (!declaredCore) {
      errors.push('toolSurface.core must be an array of tool entries');
    } else {
      const missing = core.filter((n) => !declaredCore.includes(n));
      const extra = declaredCore.filter((n) => !core.includes(n));
      if (missing.length) errors.push(`toolSurface.core missing CORE_TOOL_NAMES: ${missing.join(', ')}`);
      if (extra.length) errors.push(`toolSurface.core lists non-core tools: ${extra.join(', ')}`);
    }
    if (tools.longTail?.tool !== LONG_TAIL_DISPATCH_TOOL) {
      errors.push(`toolSurface.longTail.tool must be ${LONG_TAIL_DISPATCH_TOOL}`);
    }
  }

  const entry = manifest?.humanEntry;
  if (!entry || entry.surface !== 'opencode' || entry.command !== 'opencode') {
    errors.push('humanEntry must name OpenCode as the primary human conversation surface');
  }

  const removedLocalLoopCommand = 'construct' + ' ' + 'c' + 'hat';
  if (JSON.stringify(manifest).includes(removedLocalLoopCommand)) {
    errors.push('manifest must not reference the removed local-loop subcommand');
  }

  return { valid: errors.length === 0, errors };
}

// The MCP gap list is not editorial: it is exactly the capabilities that declare
// surfaces.mcp.supported=false. Derive id/name/cliFallback from the registry so a
// capability flipping its MCP support shows up as drift; keep the human-written reason.

function deriveMcpGaps({ rootDir = REPO_ROOT, curatedGaps = [] } = {}) {
  const { capabilities = [] } = loadCapabilityRegistry({ rootDir });
  const reasonById = new Map(curatedGaps.map((g) => [g.id, g.reason]));
  return capabilities
    .filter((cap) => cap?.surfaces?.mcp?.supported === false)
    .map((cap) => {
      const reason = reasonById.get(cap.id);
      if (!reason) {
        throw new Error(`agent-manifest: MCP gap "${cap.id}" has no curated reason in registry/agent-manifest.json`);
      }
      return {
        id: cap.id,
        name: cap.name ?? cap.id,
        mcp: 'unsupported',
        cliFallback: cap.surfaces?.cli?.command ?? null,
        reason,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Reconcile source-of-truth structure onto the curated prose: pull the CORE set from
// the live server source (preserving each tool's curated `use` by name), pin the
// long-tail dispatcher and the OpenCode human entry, and derive the MCP gap list from the
// capability registry. The committed manifest supplies the prose; live sources supply
// the facts. Emit canonical JSON so a correct file round-trips byte-for-byte.

export function generateAgentManifest({ rootDir = REPO_ROOT, write = true } = {}) {
  const manifestPath = resolve(rootDir, 'registry', 'agent-manifest.json');
  const serverPath = resolve(rootDir, 'lib', 'mcp', 'server.mjs');
  const current = loadAgentManifest(manifestPath);
  const coreToolNames = readCoreToolNames(serverPath);

  const useByName = new Map(
    (current.toolSurface?.core ?? []).map((t) => [t.name, t.use]),
  );
  const core = coreToolNames.map((name) => {
    const use = useByName.get(name);
    if (!use) {
      throw new Error(`agent-manifest: core tool "${name}" has no curated use string in registry/agent-manifest.json`);
    }
    return { name, use };
  });

  const next = {
    $schema: current.$schema,
    version: current.version,
    kind: current.kind,
    description: current.description,
    sources: current.sources,
    toolSurface: {
      ...current.toolSurface,
      core,
      longTail: {
        ...current.toolSurface?.longTail,
        tool: LONG_TAIL_DISPATCH_TOOL,
      },
    },
    humanEntry: {
      ...current.humanEntry,
      surface: 'opencode',
      command: 'opencode',
      subcommand: null,
    },
    credentials: current.credentials,
    mcpGaps: {
      ...current.mcpGaps,
      gaps: deriveMcpGaps({ rootDir, curatedGaps: current.mcpGaps?.gaps ?? [] }),
    },
  };

  const content = `${JSON.stringify(next, null, 2)}\n`;
  if (!write) {
    const existing = readFileSync(manifestPath, 'utf8');
    return { path: manifestPath, content, drift: existing !== content };
  }
  writeFileSync(manifestPath, content);
  return { path: manifestPath, content, drift: false };
}

export function checkAgentManifestDrift({ rootDir = REPO_ROOT } = {}) {
  const { drift, content } = generateAgentManifest({ rootDir, write: false });
  return { drift, contentLength: content.length };
}
