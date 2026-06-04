/**
 * tests/functional/host-config-parity.functional.test.mjs
 *
 * Sterile cross-host config audit: spawns the real sync-specialists.mjs into an
 * isolated tmp HOME + tmp project and asserts every IDE surface lands at the
 * canonical path with the host's canonical top-level key and entry shape — the
 * schema each host actually reads (official docs + the host binaries' resolvers,
 * 2026-06-03). Catches the "looks installed but the host ignores it" class
 * (the OpenCode `.opencode/config.json` and VS Code `github.copilot.mcpServers`
 * bugs). Hosts are never executed.
 *
 * Canonical project schema asserted:
 *   VS Code   .vscode/mcp.json         top-level `servers`
 *   Cursor    .cursor/mcp.json         top-level `mcpServers`
 *   OpenCode  .opencode/opencode.json  top-level `mcp`, local command = array
 *   Codex     .codex/config.toml       [mcp_servers."id"]
 *   Claude    .claude/agents/*.md + .claude/settings.json
 *   Copilot   .github/prompts/*.prompt.md
 *
 * Global scope must NOT seed any host config the user did not already have.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = join(REPO_ROOT, 'scripts', 'sync-specialists.mjs');

function makeEnv() {
  const sandbox = mkdtempSync(join(tmpdir(), 'host-config-'));
  const HOME = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  return { sandbox, HOME, project, cleanup() { rmSync(sandbox, { recursive: true, force: true }); } };
}

function runSync(env, scope) {
  return spawnSync(process.execPath, [SYNC_SCRIPT, scope], {
    cwd: env.project,
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, HOME: env.HOME, CONSTRUCT_SKIP_POSTINSTALL: '1' },
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
    assert.ok(opencode.agent && Object.keys(opencode.agent).length >= 2, 'OpenCode agent table present');
    const localEntry = Object.values(opencode.mcp).find((e) => e.type === 'local');
    if (localEntry) assert.ok(Array.isArray(localEntry.command), 'OpenCode local `command` is an array');

    // Codex — `.codex/config.toml` with [mcp_servers."id"] + agent tomls.
    const codexToml = readFileSync(p('.codex/config.toml'), 'utf8');
    assert.match(codexToml, /\[mcp_servers\./, 'Codex declares [mcp_servers.*]');
    assert.ok(readdirSync(p('.codex/agents')).some((f) => f.endsWith('.toml')), 'Codex agent tomls present');

    // Claude — agents + settings.json (mcpServers).
    assert.ok(existsSync(p('.claude/agents/construct.md')), 'Claude orchestrator agent present');
    const claudeSettings = readJson(p('.claude/settings.json'));
    assert.ok(claudeSettings.mcpServers && typeof claudeSettings.mcpServers === 'object', 'Claude uses `mcpServers`');

    // Copilot — prompt files. VS Code/Copilot agent mode reads the project's
    // .claude/agents natively, so Construct does not write a duplicate
    // .github/agents set (it duplicated every agent in the picker).
    assert.ok(existsSync(p('.github/prompts/construct.prompt.md')), 'Copilot orchestrator prompt present');
    assert.ok(!existsSync(p('.github/agents')), 'no duplicate .github/agents set (VS Code reads .claude/agents)');
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
  } finally {
    env.cleanup();
  }
});
