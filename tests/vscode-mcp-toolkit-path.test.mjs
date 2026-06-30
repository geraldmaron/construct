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
import { mcpEntryPointsOutsideToolkit, pinVscodeAgentLocations } from '../scripts/sync-specialists.mjs';

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

// pinVscodeAgentLocations writes the documented chat.agentFilesLocations hint so
// VS Code prefers .github/agents over the .claude/agents compatibility scan,
// without ever clobbering a settings file it cannot strictly parse (JSONC).

test('writes the agent-location pin when no settings.json exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    pinVscodeAgentLocations(dir);
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
    pinVscodeAgentLocations(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.equal(s['editor.tabSize'], 2, 'existing keys survive');
    assert.ok(s['chat.agentFilesLocations'], 'pin added');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('does not clobber a JSONC settings.json it cannot strictly parse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    const original = '{\n  // user comment\n  "editor.tabSize": 4\n}\n';
    writeFileSync(join(dir, '.vscode', 'settings.json'), original);
    pinVscodeAgentLocations(dir);
    assert.equal(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'), original, 'commented file left untouched');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('respects an existing chat.agentFilesLocations choice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-vscode-settings-'));
  try {
    mkdirSync(join(dir, '.vscode'), { recursive: true });
    const existing = { 'chat.agentFilesLocations': { 'custom/agents': true } };
    writeFileSync(join(dir, '.vscode', 'settings.json'), JSON.stringify(existing));
    pinVscodeAgentLocations(dir);
    const s = JSON.parse(readFileSync(join(dir, '.vscode', 'settings.json'), 'utf8'));
    assert.deepEqual(s['chat.agentFilesLocations'], { 'custom/agents': true }, 'user choice preserved');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
