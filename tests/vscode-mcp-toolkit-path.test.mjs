/**
 * tests/vscode-mcp-toolkit-path.test.mjs
 *
 * A merged .vscode/mcp.json preserves existing server entries so user edits
 * survive a re-sync. mcpEntryPointsOutsideToolkit is the exception that keeps a
 * construct-owned server path from a different toolkit root from being preserved
 * forever — the bug that left VS Code/Copilot launching a deleted checkout and
 * the orchestrator with no construct-mcp tools.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpEntryPointsOutsideToolkit, pinVscodeChatSettings } from '../scripts/sync-worker-profiles.mjs';

const ROOT = '/Users/dev/Developer/Projects/construct';

test('a construct toolkit path outside the current root is stale', () => {
  const entry = { command: 'node', args: ['/Users/dev/Git/construct/lib/mcp/server.mjs'] };
  assert.equal(mcpEntryPointsOutsideToolkit(entry, ROOT), true);
});

test('a construct toolkit path under the current root is not stale', () => {
  const entry = { command: 'node', args: [`${ROOT}/lib/mcp/server.mjs`] };
  assert.equal(mcpEntryPointsOutsideToolkit(entry, ROOT), false);
});

test('a user-owned server with no toolkit path is preserved', () => {
  const npx = { command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
  const remote = { type: 'http', url: 'https://example.com/mcp' };
  assert.equal(mcpEntryPointsOutsideToolkit(npx, ROOT), false);
  assert.equal(mcpEntryPointsOutsideToolkit(remote, ROOT), false);
  assert.equal(mcpEntryPointsOutsideToolkit(undefined, ROOT), false);
});

test('the memory bridge path under a foreign root is stale too', () => {
  const entry = { command: 'node', args: ['/opt/old/construct/lib/mcp/memory-bridge.mjs'] };
  assert.equal(mcpEntryPointsOutsideToolkit(entry, ROOT), true);
});

// pinVscodeChatSettings writes the documented chat.agentFilesLocations hint so
// VS Code prefers .github/agents over the .claude/agents compatibility scan,
// without ever clobbering a settings file it cannot strictly parse (JSONC).

test('writes the agent-location pin when no settings.json exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['chat.agentFilesLocations']['.github/agents'], true);
    assert.equal(s['chat.agentFilesLocations']['.claude/agents'], false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('merges into valid JSON settings, preserving existing keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'editor.tabSize': 2 }));
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['editor.tabSize'], 2, 'existing keys survive');
    assert.ok(s['chat.agentFilesLocations'], 'pin added');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('merges managed keys into a JSONC settings.json, preserving existing keys (comments are stripped on rewrite)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, '.vscode', 'settings.json'), '{\n  // user comment\n  "editor.tabSize": 4\n}\n');
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['editor.tabSize'], 4, 'existing key preserved');
    assert.ok(s['chat.mcp.autoStart'] !== undefined, 'managed MCP autostart key added');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('respects an existing chat.agentFilesLocations choice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    const existing = { 'chat.agentFilesLocations': { 'custom/agents': true } };
    writeFileSync(join(dir, '.vscode', 'settings.json'), JSON.stringify(existing));
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.deepEqual(s['chat.agentFilesLocations'], { 'custom/agents': true }, 'user choice preserved');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('associates the JSONC config files as jsonc so VS Code does not flag their comments (construct-zsng)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['files.associations']?.['construct.config.json'], 'jsonc');
    assert.equal(s['files.associations']?.['construct.config.local.json'], 'jsonc');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deep-merges files.associations into a user map without dropping their entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'files.associations': { '*.myext': 'json' } }));
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['files.associations']['*.myext'], 'json', 'user association preserved');
    assert.equal(s['files.associations']['construct.config.json'], 'jsonc', 'construct association added');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('eager-starts MCP servers via chat.mcp.autoStart (camelCase, VS Code id) so construct-mcp is live without a manual Start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['chat.mcp.autoStart'], 'always');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('applies each managed setting independently — an existing agent pin still gets the mcp autostart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    writeFileSync(join(dir, '.vscode', 'settings.json'), JSON.stringify({ 'chat.agentFilesLocations': { 'custom/agents': true } }));
    pinVscodeChatSettings(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.deepEqual(s['chat.agentFilesLocations'], { 'custom/agents': true }, 'user agent pin preserved');
    assert.equal(s['chat.mcp.autoStart'], 'always', 'mcp autostart still added independently');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
