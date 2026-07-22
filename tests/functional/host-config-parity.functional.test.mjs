/**
 * tests/functional/host-config-parity.functional.test.mjs
 *
 * Sterile cross-host config audit: spawns the real sync-worker-profiles.mjs into an
 * isolated tmp HOME + tmp project and asserts every IDE surface lands at the
 * canonical path with the host's canonical top-level key and entry shape — the
 * schema each host actually reads (official docs + the host binaries' resolvers,
 * 2026-06-03). Catches the "looks installed but the host ignores it" class
 * (the OpenCode `.opencode/config.json` and VS Code `github.copilot.mcpServers`
 * bugs). Hosts are never executed.
 *
 * @capability mcp.tool-budget.trim
 *
 * Canonical project schema asserted:
 *   VS Code   .vscode/mcp.json         top-level `servers`
 *   Cursor    .cursor/mcp.json         top-level `mcpServers`
 *   OpenCode  .opencode/opencode.json  top-level `mcp`, local command = array
 *   Codex     .codex/config.toml       [mcp_servers."id"]
 *   Claude    .claude/agents/*.md + .mcp.json (project-scope MCP servers;
 *             settings.json carries hooks/permissions only, never mcpServers)
 *   Copilot   .github/prompts/*.prompt.md
 *
 * Global scope must NOT seed any host config the user did not already have.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-worker-profiles.mjs');

// `construct sync` now defaults to detected hosts (ADR-0027 §1); a sterile HOME
// detects none, so pin the full set to audit every IDE surface.

const ALL_HOSTS = 'claude,codex,copilot,opencode,vscode,cursor';

function makeEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), 'host-config-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  return { sandbox, HOME, project, cleanup() { rmTmpDir(sandbox); } };
}

function runSync(env, scope) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, scope], {
    cwd: env.project,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, HOME: env.HOME, CONSTRUCT_SKIP_POSTINSTALL: '1', CONSTRUCT_SYNC_HOSTS: ALL_HOSTS },
  });
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

test('project sync writes each IDE surface at its canonical path + key + entry shape', () => {
  const env = makeEnv();
  try {
    const r = runSync(env, '--project');
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const p = (rel) => join(env.project, rel);

    // VS Code — `.vscode/mcp.json`, top-level `servers` (NOT mcpServers).
    const vscode = readJson(p('.vscode/mcp.json'));
    assert.ok(vscode.servers && typeof vscode.servers === 'object', 'VS Code uses top-level `servers`');
    assert.ok(!('mcpServers' in vscode), 'VS Code must not use `mcpServers`');
    const vEntry = Object.values(vscode.servers)[0];
    assert.ok(vEntry.command || vEntry.type === 'http', 'VS Code stdio entry has command, or remote has type:http');

    // Cursor — `.cursor/mcp.json`, top-level `mcpServers` (NOT servers).
    const cursor = readJson(p('.cursor/mcp.json'));
    assert.ok(cursor.mcpServers && typeof cursor.mcpServers === 'object', 'Cursor uses top-level `mcpServers`');
    assert.ok(!('servers' in cursor), 'Cursor must not use `servers`');

    // OpenCode — `.opencode/opencode.json`, top-level `mcp`, local command = array.
    assert.ok(!existsSync(p('.opencode/config.json')), 'OpenCode must not write the ignored config.json');
    const opencode = readJson(p('.opencode/opencode.json'));
    assert.ok(opencode.mcp && typeof opencode.mcp === 'object', 'OpenCode uses top-level `mcp`');
    assert.ok(opencode.agent && Object.keys(opencode.agent).length === 4, 'OpenCode agent table present with orchestrator + helper agents');
    assert.ok(opencode.agent.construct, 'OpenCode orchestrator present');
    assert.ok(opencode.agent.title, 'OpenCode title helper present');
    assert.ok(opencode.agent.summary, 'OpenCode summary helper present');
    assert.ok(opencode.agent.compaction, 'OpenCode compaction helper present');
    assert.match(opencode.agent.construct.prompt || '', /construct-mcp_orchestration_policy/, 'OpenCode prompt must name the host-facing orchestration policy tool');
    assert.match(opencode.agent.construct.prompt || '', /construct-mcp_orchestration_run/, 'OpenCode prompt must name the host-facing orchestration run tool');
    const localEntry = Object.values(opencode.mcp).find((e) => e.type === 'local');
    if (localEntry) assert.ok(Array.isArray(localEntry.command), 'OpenCode local `command` is an array');

    // Codex — `.codex/config.toml` with [mcp_servers."id"] + agent tomls.
    const codexToml = readFileSync(p('.codex/config.toml'), 'utf8');
    assert.match(codexToml, /\[mcp_servers\./, 'Codex declares [mcp_servers.*]');
    assert.ok(readdirSync(p('.codex/agents')).some((f) => f.endsWith('.toml')), 'Codex agent tomls present');

    // Claude — agents + .mcp.json (mcpServers). settings.json is not a file
    // Claude Code reads MCP server definitions from (construct-ranh).
    assert.ok(existsSync(p('.claude/agents/construct.md')), 'Claude orchestrator agent present');
    const claudeSettings = readJson(p('.claude/settings.json'));
    assert.equal(claudeSettings.mcpServers, undefined, 'settings.json must not carry MCP server definitions');
    const claudeMcpJson = readJson(p('.mcp.json'));
    assert.ok(claudeMcpJson.mcpServers && typeof claudeMcpJson.mcpServers === 'object', 'Claude project scope uses .mcp.json `mcpServers`');

    // Copilot — a /construct prompt plus a VS Code custom agent. The agent file
    // carries VS-Code-namespaced tool grants (`<server>/*`, `web/fetch`); the
    // Claude-format names in .claude/agents are ignored by VS Code, so a picker
    // entry sourced from there alone has no usable tools.
    assert.ok(existsSync(p('.github/prompts/construct.prompt.md')), 'Copilot orchestrator prompt present');
    const copilotAgent = readFileSync(p('.github/agents/construct.agent.md'), 'utf8');
    assert.match(copilotAgent, /construct-mcp\/orchestration_policy/, 'VS Code agent grants the orchestration_policy tool');
    assert.match(copilotAgent, /construct-mcp\/orchestration_run/, 'VS Code agent grants the orchestration_run tool');
    assert.ok(!copilotAgent.includes('construct-mcp/*'), 'VS Code agent must not use a wildcard grant — least-privilege');
  } finally {
    env.cleanup();
  }
});

// The construct MCP server (lib/mcp/server.mjs) is the backbone of the specialist
// loop (project_context/get_skill/get_template/orchestration_policy/agent_contract).
// Every selected host that carries MCP config must wire it, or that host's agent
// is mute. Detection keys off the server.mjs reference, not the entry id, so it
// survives per-host id transforms (e.g. OpenCode getOpenCodeMcpId). Guards the
// Claude project writer, which must source MCP from the registry (not only a
// curated template) so construct-mcp is never dropped for one host.
test('construct-mcp (the construct server) is wired for every selected host', () => {
  const env = makeEnv();
  try {
    const r = runSync(env, '--project');
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const p = (rel) => join(env.project, rel);

    const wiresConstructServer = (file) => {
      if (!existsSync(file)) return false;
      return /lib[\\/]mcp[\\/]server\.mjs/.test(readFileSync(file, 'utf8'));
    };

    const hostConfigs = {
      'Claude Code': p('.mcp.json'),
      'VS Code': p('.vscode/mcp.json'),
      Cursor: p('.cursor/mcp.json'),
      OpenCode: p('.opencode/opencode.json'),
      Codex: p('.codex/config.toml'),
    };
    for (const [host, file] of Object.entries(hostConfigs)) {
      assert.ok(existsSync(file), `${host}: config ${file} must exist`);
      assert.ok(wiresConstructServer(file), `${host}: config must wire the construct MCP server (lib/mcp/server.mjs)`);
    }
  } finally {
    env.cleanup();
  }
});

// Generated host configs are per-machine and gitignored, but must still never
// inline a credential — tokens belong in env references, not config files (the
// cross-tool norm; a community-documented secret-leak class). Asserts every MCP
// config carries only env/header-style references, no raw key material.
test('no generated host config inlines a plaintext secret', () => {
  const env = makeEnv();
  try {
    const r = runSync(env, '--project');
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const p = (rel) => join(env.project, rel);

    const secretShaped = [
      /\bsk-[A-Za-z0-9]{20,}\b/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
      /"(?:authorization|api[_-]?key|token|secret|password)"\s*:\s*"(?!\{env:|\{file:|Bearer \{)[^"]{12,}"/i,
    ];
    for (const rel of ['.claude/settings.json', '.mcp.json', '.vscode/mcp.json', '.cursor/mcp.json', '.opencode/opencode.json', '.codex/config.toml']) {
      const file = p(rel);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const re of secretShaped) {
        assert.ok(!re.test(text), `${rel}: must not inline a secret (matched ${re}); use an env reference`);
      }
    }
  } finally {
    env.cleanup();
  }
});

test('global sync never seeds a host config the user did not already have', () => {
  const env = makeEnv();
  try {
    const r = runSync(env, '--global');
    assert.equal(r.status, 0, r.stderr || r.stdout);

    // No VS Code user mcp.json created anywhere under the isolated HOME.
    const vscodeRoots = [
      join(env.HOME, 'Library', 'Application Support', 'Code'),
      join(env.HOME, '.config', 'Code'),
      join(env.HOME, 'AppData', 'Roaming', 'Code'),
    ];
    for (const root of vscodeRoots) {
      assert.ok(!existsSync(join(root, 'User', 'mcp.json')), `no seeded VS Code mcp.json under ${root}`);
      assert.ok(!existsSync(join(root, 'User', 'settings.json')), `no seeded VS Code settings.json under ${root}`);
    }
    // Cursor + OpenCode global are likewise only-if-exists.
    assert.ok(!existsSync(join(env.HOME, '.cursor', 'mcp.json')), 'no seeded ~/.cursor/mcp.json');
    assert.ok(!existsSync(join(env.HOME, '.config', 'opencode', 'opencode.json')), 'no seeded global opencode.json');
    // ~/.claude.json is Claude Code's own runtime state file; global sync must
    // not fabricate it just to seed MCP servers for a user who never ran `claude`.
    assert.ok(!existsSync(join(env.HOME, '.claude.json')), 'no seeded ~/.claude.json');
  } finally {
    env.cleanup();
  }
});
