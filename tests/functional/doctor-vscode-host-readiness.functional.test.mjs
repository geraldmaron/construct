/**
 * tests/functional/doctor-vscode-host-readiness.functional.test.mjs
 *
 * classifyHostReadiness (lib/host/readiness.mjs) distinguishes discrete VS Code
 * MCP host-config states (jsonc_unpatched/disabled/healthy, etc.) instead of
 * collapsing readiness to settings.json presence. It was dead code — its sole
 * caller was a fixture test — until wired into `construct doctor` here
 * (construct-1yhp: "wire classifyHostReadiness into doctor"). Spawns the real
 * binary against a fake VS Code install in an isolated HOME.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function vscodeSettingsPath(home) {
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  if (process.platform === 'win32') return join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
  return join(home, '.config', 'Code', 'User', 'settings.json');
}

function vscodeAppSupportRoot(home) {
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'Code');
  if (process.platform === 'win32') return join(home, 'AppData', 'Roaming', 'Code');
  return join(home, '.config', 'Code');
}

function makeHome(settingsContent) {
  const sandbox = mkdtempSync(join(tmpdir(), 'doctor-vscode-readiness-'));
  const home = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(vscodeAppSupportRoot(home), { recursive: true });
  const settingsPath = vscodeSettingsPath(home);
  mkdirSync(dirname(settingsPath), { recursive: true });
  if (settingsContent !== null) writeFileSync(settingsPath, settingsContent);
  mkdirSync(project, { recursive: true });
  return { sandbox, home, project, cleanup() { rmTmpDir(sandbox); } };
}

// cwd must be an isolated project dir, not REPO_ROOT — this repo's own
// committed .vscode/mcp.json points at a fixed checkout path, which would
// otherwise leak a real stale_path finding into every case here.

function runDoctor(ctx) {
  return spawnSync(process.execPath, [BIN, 'doctor'], {
    cwd: ctx.project,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, HOME: ctx.home, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' },
  });
}

test('doctor reports jsonc_unpatched when VS Code settings.json has comments', () => {
  const ctx = makeHome('// user settings\n{\n  "editor.tabSize": 2\n}\n');
  try {
    const r = runDoctor(ctx);
    const line = r.stdout.split('\n').find((l) => l.includes('VS Code MCP host readiness'));
    assert.ok(line, `doctor output should include a VS Code MCP host readiness line.\nstdout: ${r.stdout.slice(0, 800)}`);
    assert.match(line, /jsonc_unpatched/);
    assert.match(line, /construct sync/);
  } finally {
    ctx.cleanup();
  }
});

test('doctor reports disabled when chat.mcp.autoStart is never', () => {
  const ctx = makeHome(JSON.stringify({ 'chat.mcp.autoStart': 'never' }));
  try {
    const r = runDoctor(ctx);
    const line = r.stdout.split('\n').find((l) => l.includes('VS Code MCP host readiness'));
    assert.ok(line, `doctor output should include a VS Code MCP host readiness line.\nstdout: ${r.stdout.slice(0, 800)}`);
    assert.match(line, /disabled/);
  } finally {
    ctx.cleanup();
  }
});

test('doctor reports healthy when settings.json has no blocking keys', () => {
  const ctx = makeHome(JSON.stringify({ 'editor.tabSize': 2 }));
  try {
    const r = runDoctor(ctx);
    const line = r.stdout.split('\n').find((l) => l.includes('VS Code MCP host readiness'));
    assert.ok(line, `doctor output should include a VS Code MCP host readiness line.\nstdout: ${r.stdout.slice(0, 800)}`);
    assert.match(line, /healthy/);
    assert.match(line, /✓/, 'the host readiness line is advisory and must never fail the gate');
  } finally {
    ctx.cleanup();
  }
});

test('doctor omits the host readiness line when VS Code is not installed', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'doctor-vscode-readiness-'));
  const home = join(sandbox, 'HOME');
  const project = join(sandbox, 'project');
  mkdirSync(home, { recursive: true });
  mkdirSync(project, { recursive: true });
  try {
    const r = runDoctor({ home, project });
    const line = r.stdout.split('\n').find((l) => l.includes('VS Code MCP host readiness'));
    assert.equal(line, undefined, 'no VS Code install signal → no host-readiness finding, not a false negative');
  } finally {
    rmTmpDir(sandbox);
  }
});
