/**
 * tests/functional/install-legacy-global-cleanup.functional.test.mjs
 *
 * Legacy global cleanup must be explicit. It removes ambient Construct
 * adapters/MCP/history from user-global tool config, but preserves vanilla
 * host config and does not uninstall a global construct CLI package.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-install-cleanup-'));
  tmpDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function seedLegacyHome(home) {
  fs.mkdirSync(path.join(home, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(home, '.construct', 'config.env'), 'CONSTRUCT_TRACE_BACKEND=local\n');
  fs.mkdirSync(path.join(home, '.local', 'share', 'construct'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Library', 'LaunchAgents'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library', 'LaunchAgents', 'dev.construct.pressure-release.plist'), '<plist />\n');

  writeJson(path.join(home, '.claude', 'settings.json'), {
    permissions: { allow: ['Bash(git status:*)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '~/.construct/lib/hooks/pretool.mjs' }] }] },
    mcpServers: {
      memory: { command: 'node', args: ['memory-bridge.mjs'] },
      context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
    },
  });

  writeJson(path.join(home, '.config', 'opencode', 'opencode.json'), {
    $schema: 'https://opencode.ai/config.json',
    agent: {
      construct: { model: 'anthropic/claude-sonnet-4' },
      general: { model: 'openai/gpt-5' },
    },
    mcp: {
      'construct-mcp': { type: 'local', command: ['construct', 'mcp'] },
      github: { type: 'remote', url: 'https://api.githubcopilot.com/mcp/' },
    },
  });

  writeJson(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'), {
    servers: {
      'construct-mcp': { command: 'construct', args: ['mcp'] },
      github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' },
    },
  });

  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), `
model = "gpt-5"

[mcp_servers."construct-mcp"]
command = "construct"
args = ["mcp"]

[mcp_servers."context7"]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[agents.construct]
name = "Construct"
`.trimStart(), 'utf8');

  fs.mkdirSync(path.join(home, '.claude', 'projects', 'Users-test-construct'), { recursive: true });
}

test('--cleanup-legacy-global with project scope removes only legacy global Construct state', () => {
  const home = freshHome();
  seedLegacyHome(home);

  const res = spawnSync('node', [BIN, 'install', '--scope=project', '--cleanup-legacy-global'], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, HOME: home },
  });

  assert.equal(res.status, 0, `expected exit 0, got ${res.status} — stderr: ${res.stderr}`);
  assert.match(res.stdout, /Legacy global cleanup: removed/i);
  assert.match(res.stdout, /scope: project/i);

  assert.equal(fs.existsSync(path.join(home, '.construct')), false, 'legacy ~/.construct must be removed');
  assert.equal(fs.existsSync(path.join(home, '.local', 'share', 'construct')), false, 'legacy data dir must be removed');
  assert.equal(fs.existsSync(path.join(home, 'Library', 'LaunchAgents', 'dev.construct.pressure-release.plist')), false, 'legacy LaunchAgent plist must be removed');
  assert.equal(fs.existsSync(path.join(home, '.claude', 'projects', 'Users-test-construct')), false, 'Construct history dirs must be removed');

  const claude = readJson(path.join(home, '.claude', 'settings.json'));
  assert.deepEqual(claude.permissions, { allow: ['Bash(git status:*)'] });
  assert.equal(claude.hooks, undefined);
  assert.deepEqual(Object.keys(claude.mcpServers), ['context7']);

  const opencode = readJson(path.join(home, '.config', 'opencode', 'opencode.json'));
  assert.equal(opencode.agent.construct, undefined);
  assert.deepEqual(opencode.agent.general, { model: 'openai/gpt-5' });
  assert.equal(opencode.mcp['construct-mcp'], undefined);
  assert.ok(opencode.mcp.github);

  const vscode = readJson(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
  assert.deepEqual(Object.keys(vscode.servers), ['github']);

  const codex = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  assert.doesNotMatch(codex, /construct-mcp|agents\.construct/);
  assert.match(codex, /mcp_servers\."context7"/);
});
