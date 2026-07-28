/**
 * tests/functional/opencode-primary-surface.functional.test.mjs — OpenCode-first surface.
 *
 * @capability surfaces.opencode-primary
 *
 * OpenCode is the first-class conversational surface. The construct CLI remains
 * for setup/admin/headless contracts and must not launch a local conversation loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-worker-profiles.mjs');

// The kill-guard keeps any unexpected interactive path from wedging CI.
function runBin(argv, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-opencode-surface-'));
    const child = spawn(process.execPath, ['bin/construct', ...argv], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        HOME: home,
        CONSTRUCT_HOME_OVERRIDE: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(home, '.local', 'state'),
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        OPENROUTER_API_KEY: '',
        OPEN_ROUTER_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        CONSTRUCT_OP_ENV_FILE: '',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(guard);
      rmTmpDir(home);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(guard);
      rmTmpDir(home);
      resolve({ code, stdout, stderr });
    });
  });
}

test('unknown global flag points users at OpenCode setup', async () => {
  const result = await runBin(['--list']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown global flag: .*--list/);
  assert.match(result.stderr, /OpenCode is the primary conversation surface/);
});

test('construct without a command shows CLI guidance instead of launching a local loop', async () => {
  const result = await runBin([]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage:\s*construct <command>/);
  assert.match(result.stdout, /OpenCode is the primary conversation surface/);
  assert.doesNotMatch(result.stdout, /\/layers .*\/help .*\/exit/);
});

test('removed local conversation command returns an OpenCode remediation hint', async () => {
  const result = await runBin(['c' + 'hat']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(`Unknown command: ${'c' + 'hat'}`));
  assert.match(result.stderr, /local conversation UI has been removed/i);
  assert.match(result.stderr, /construct sync/);
});

test('OpenCode project sync remains the primary conversation surface wiring', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-opencode-primary-'));
  const home = path.join(sandbox, 'HOME');
  const project = path.join(sandbox, 'project');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  try {
    const res = spawn(process.execPath, [SYNC_SCRIPT, '--project'], {
      cwd: project,
      env: {
        ...process.env,
        HOME: home,
        CONSTRUCT_HOME_OVERRIDE: home,
        CONSTRUCT_SKIP_POSTINSTALL: '1',
        CONSTRUCT_SYNC_HOSTS: 'opencode',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    return new Promise((resolve, reject) => {
      const guard = setTimeout(() => res.kill('SIGKILL'), 90_000);
      res.stdout.on('data', (chunk) => { stdout += chunk; });
      res.stderr.on('data', (chunk) => { stderr += chunk; });
      res.on('error', reject);
      res.on('close', (code) => {
        clearTimeout(guard);
        try {
          assert.equal(code, 0, stderr || stdout);
          const configPath = path.join(project, '.opencode', 'opencode.json');
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          assert.ok(config.agent?.construct, 'OpenCode construct front-door agent is present');
          assert.ok(config.mcp && JSON.stringify(config.mcp).includes('lib/mcp/server.mjs'), 'OpenCode wires construct-mcp');
          assert.ok(Array.isArray(config.plugin) && config.plugin.some((p) => /construct-fallback\.js$/.test(p)), 'OpenCode runtime plugin is wired');
          resolve();
        } catch (err) {
          reject(err);
        } finally {
          rmTmpDir(sandbox);
        }
      });
    });
  } catch (err) {
    rmTmpDir(sandbox);
    throw err;
  }
});
