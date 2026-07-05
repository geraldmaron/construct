/**
 * tests/functional/uninstall-coverage.functional.test.mjs
 *
 * Coverage for the four reversers ADR-0027 §Consequences requires `construct
 * uninstall` to perform: the dev.construct.pressure-release LaunchAgent, a
 * Construct-set git core.hooksPath, the memory MCP registration across Claude /
 * OpenCode / Codex configs, and the opt-in pgvector image removal. Also covers
 * construct-ranh's MCP write-path migration: ~/.claude.json (machine scope)
 * and <project>/.mcp.json (project scope) must be stripped of Construct-managed
 * entries alongside the legacy ~/.claude/settings.json path.
 *
 * Each test seeds the install-created state in an isolated HOME + tmp git repo,
 * drives the real runUninstall with --home / --cwd overrides, and asserts the
 * state is reversed. The custom-hooksPath case asserts a user value survives.
 * launchctl / docker are never required: the LaunchAgent assertion runs only on
 * darwin (where install creates the plist) and the image case exercises the
 * --with-images gate without pulling a real image.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { runUninstall, parseArgs } from '../../lib/uninstall/uninstall.mjs';

function makeSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), 'cx-uninstall-cov-'));
  const home = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { sandbox, home, project, cleanup: () => rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}

function gitInit(cwd) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  spawnSync('git', ['init', '-q'], { cwd, env });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd, env });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd, env });
  return env;
}

function getHooksPath(cwd, env) {
  const res = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd, env, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : '';
}

function uninstall(home, project, args = []) {
  return runUninstall(['--yes', `--home=${home}`, `--cwd=${project}`, '--scope=all', ...args]);
}

test('uninstall unsets core.hooksPath when it points at .beads/hooks', async () => {
  const env = makeSandbox();
  try {
    const gitEnv = gitInit(env.project);
    spawnSync('git', ['config', 'core.hooksPath', '.beads/hooks'], { cwd: env.project, env: gitEnv });
    assert.equal(getHooksPath(env.project, gitEnv), '.beads/hooks', 'precondition: hooksPath set');

    const result = await uninstall(env.home, env.project);
    assert.ok(result.removed.some((r) => r.id === 'project-git-hookspath'), 'hooksPath category must run');
    assert.equal(getHooksPath(env.project, gitEnv), '', 'core.hooksPath must be unset after uninstall');
  } finally { env.cleanup(); }
});

test('uninstall preserves a user-customized core.hooksPath', async () => {
  const env = makeSandbox();
  try {
    const gitEnv = gitInit(env.project);
    spawnSync('git', ['config', 'core.hooksPath', '.my/custom-hooks'], { cwd: env.project, env: gitEnv });
    assert.equal(getHooksPath(env.project, gitEnv), '.my/custom-hooks', 'precondition: custom hooksPath set');

    const result = await uninstall(env.home, env.project);
    assert.ok(!result.removed.some((r) => r.id === 'project-git-hookspath'), 'custom hooksPath must not be touched');
    assert.equal(getHooksPath(env.project, gitEnv), '.my/custom-hooks', 'custom core.hooksPath must survive');
  } finally { env.cleanup(); }
});

test('uninstall strips the memory MCP from Claude, OpenCode, and Codex configs', async () => {
  const env = makeSandbox();
  try {
    const claudePath = join(env.home, '.claude', 'settings.json');
    const opencodePath = join(env.home, '.config', 'opencode', 'opencode.json');
    const codexPath = join(env.home, '.codex', 'config.toml');
    mkdirSync(dirname(claudePath), { recursive: true });
    mkdirSync(dirname(opencodePath), { recursive: true });
    mkdirSync(dirname(codexPath), { recursive: true });

    writeFileSync(claudePath, JSON.stringify({
      mcpServers: {
        memory: { command: 'node', args: ['x/memory-bridge.mjs'] },
        github: { command: 'gh-mcp' },
      },
    }, null, 2) + '\n');
    writeFileSync(opencodePath, JSON.stringify({
      mcp: {
        memory: { type: 'local', command: ['node', 'x'] },
        cass: { type: 'remote', url: 'http://127.0.0.1:8765/' },
        playwright: { type: 'local', command: ['npx', 'pw'] },
      },
    }, null, 2) + '\n');
    writeFileSync(codexPath, [
      '[mcp_servers.memory]',
      'command = "node"',
      'args = ["x/memory-bridge.mjs"]',
      '',
      '[mcp_servers.github]',
      'command = "gh-mcp"',
      '',
    ].join('\n'));

    const result = await uninstall(env.home, env.project);
    assert.ok(result.removed.some((r) => r.id === 'machine-memory-mcp'), 'memory MCP category must run');

    const claude = JSON.parse(readFileSync(claudePath, 'utf8'));
    assert.equal('memory' in (claude.mcpServers ?? {}), false, 'memory removed from Claude settings');
    assert.equal('github' in claude.mcpServers, true, 'other Claude MCP servers preserved');

    const opencode = JSON.parse(readFileSync(opencodePath, 'utf8'));
    assert.equal('memory' in (opencode.mcp ?? {}), false, 'memory removed from OpenCode config');
    assert.equal('cass' in opencode.mcp, false, 'legacy cass key removed from OpenCode config');
    assert.equal('playwright' in opencode.mcp, true, 'other OpenCode MCPs preserved');

    const codex = readFileSync(codexPath, 'utf8');
    assert.equal(codex.includes('[mcp_servers.memory]'), false, 'memory table removed from Codex config');
    assert.equal(codex.includes('[mcp_servers.github]'), true, 'other Codex MCP tables preserved');
  } finally { env.cleanup(); }
});

test('uninstall strips the memory MCP from ~/.claude.json (construct-ranh scope)', async () => {
  const env = makeSandbox();
  try {
    const claudeUserConfigPath = join(env.home, '.claude.json');
    writeFileSync(claudeUserConfigPath, JSON.stringify({
      oauthAccount: { emailAddress: 'user@example.com' },
      mcpServers: {
        memory: { command: 'node', args: ['x/memory-bridge.mjs'] },
        github: { command: 'gh-mcp' },
      },
    }, null, 2) + '\n');

    const result = await uninstall(env.home, env.project);
    assert.ok(result.removed.some((r) => r.id === 'machine-memory-mcp'), 'memory MCP category must run');

    const claudeUserConfig = JSON.parse(readFileSync(claudeUserConfigPath, 'utf8'));
    assert.equal('memory' in (claudeUserConfig.mcpServers ?? {}), false, 'memory removed from ~/.claude.json');
    assert.equal('github' in claudeUserConfig.mcpServers, true, 'other Claude MCP servers preserved');
    assert.deepEqual(claudeUserConfig.oauthAccount, { emailAddress: 'user@example.com' }, 'unrelated ~/.claude.json state untouched');
  } finally { env.cleanup(); }
});

test('uninstall strips Construct-managed servers from project .mcp.json (construct-ranh scope)', async () => {
  const env = makeSandbox();
  try {
    const mcpJsonPath = join(env.project, '.mcp.json');
    writeFileSync(mcpJsonPath, JSON.stringify({
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
        'construct-mcp': { command: 'node', args: ['run.mjs', 'mcp'] },
        'user-private-server': { command: 'node', args: ['private.mjs'] },
      },
    }, null, 2) + '\n');

    const result = await uninstall(env.home, env.project);
    assert.ok(result.removed.some((r) => r.id === 'project-settings'), 'project-settings category must run');

    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    assert.equal('context7' in mcpJson.mcpServers, false, 'context7 stripped from .mcp.json');
    assert.equal('construct-mcp' in mcpJson.mcpServers, false, 'construct-mcp stripped from .mcp.json');
    assert.ok(mcpJson.mcpServers['user-private-server'], 'user mcp server preserved in .mcp.json');
  } finally { env.cleanup(); }
});

test('uninstall removes the pressure-release LaunchAgent plist', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('LaunchAgent install path is darwin-only');
    return;
  }
  const env = makeSandbox();
  try {
    const plistPath = join(env.home, 'Library', 'LaunchAgents', 'dev.construct.pressure-release.plist');
    mkdirSync(dirname(plistPath), { recursive: true });
    writeFileSync(plistPath, '<?xml version="1.0"?><plist></plist>\n');
    assert.equal(existsSync(plistPath), true, 'precondition: plist exists');

    const result = await uninstall(env.home, env.project);
    assert.ok(result.removed.some((r) => r.id === 'machine-launchagent'), 'LaunchAgent category must run');
    assert.equal(existsSync(plistPath), false, 'LaunchAgent plist must be removed');
  } finally { env.cleanup(); }
});

test('pgvector image removal is gated behind --with-images', async () => {
  const env = makeSandbox();
  try {
    const dryDefault = await runUninstall(['--dry-run', `--home=${env.home}`, `--cwd=${env.project}`]);
    assert.ok(
      !dryDefault.skipped.includes('machine-pgvector-image'),
      'image category must not appear without --with-images',
    );

    assert.equal(parseArgs(['--with-images']).withImages, true, '--with-images must set the flag');
    assert.equal(parseArgs([]).withImages, false, 'default leaves withImages false');
  } finally { env.cleanup(); }
});

test('uninstall is idempotent when nothing install-created remains', async () => {
  const env = makeSandbox();
  try {
    gitInit(env.project);
    const first = await uninstall(env.home, env.project);
    assert.ok(Array.isArray(first.removed), 'first run returns a result');
    const second = await uninstall(env.home, env.project);
    assert.equal(second.canceled, false, 'second run does not error');
    assert.ok(!second.removed.some((r) => /error:/.test(r.detail || '')), 'no errors on a clean second run');
  } finally { env.cleanup(); }
});
