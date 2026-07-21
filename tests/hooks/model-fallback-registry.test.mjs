/**
 * tests/hooks/model-fallback-registry.test.mjs
 *
 * Locks in that lib/hooks/model-fallback.mjs loads
 * registry/models.json under CONSTRUCT_TOOLKIT_DIR and passes it to
 * selectFallbackModel as registryModels, so a registry-declared fallback
 * chain can actually be selected on a retryable provider failure, and that
 * no provider cooldown file is written on any no-op path (only after a
 * fallback is actually applied).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'lib', 'hooks', 'model-fallback.mjs');

const tmpDirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    rmTmpDir(dir);
  }
});

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function writeRegistry(toolkitDir, models) {
  fs.cpSync(path.join(REPO_ROOT, 'registry'), path.join(toolkitDir, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(toolkitDir, 'registry', 'models.json'), JSON.stringify({ models }, null, 2));
}

function runHook({ toolkitDir, homeDir, cwd, hookInput }) {
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    cwd,
    input: JSON.stringify(hookInput),
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      CONSTRUCT_TOOLKIT_DIR: toolkitDir,
    },
  });
  return res;
}

function cooldownPath(homeDir) {
  return path.join(homeDir, '.local', 'state', 'construct', 'provider-cooldowns.json');
}

test('a registry-declared cross-provider fallback is selected once registryModels is in scope', () => {
  const toolkitDir = freshDir('cx-hook-toolkit-');
  const homeDir = freshDir('cx-hook-home-');
  const cwd = freshDir('cx-hook-cwd-');
  writeRegistry(toolkitDir, {
    standard: { primary: 'anthropic/claude-opus-4-6', fallback: ['openrouter/qwen/qwen3-coder:free'] },
  });

  const res = runHook({
    toolkitDir,
    homeDir,
    cwd,
    hookInput: { error: { message: '429 too many requests', provider: 'anthropic' } },
  });

  assert.equal(res.status, 0, `hook should exit 0 — stderr: ${res.stderr}`);
  assert.match(res.stderr, /Switching standard → openrouter\/qwen\/qwen3-coder:free/);
  const envContent = fs.readFileSync(path.join(cwd, '.env'), 'utf8');
  assert.match(envContent, /CONSTRUCT_MODEL_STANDARD=openrouter\/qwen\/qwen3-coder:free/);
  assert.ok(fs.existsSync(cooldownPath(homeDir)), 'a cooldown file is written after a fallback is actually applied');
});

test('no cooldown file is written when no registry/candidate resolves (no-op path)', () => {
  const toolkitDir = freshDir('cx-hook-toolkit-empty-');
  const homeDir = freshDir('cx-hook-home-empty-');
  const cwd = freshDir('cx-hook-cwd-empty-');

  const res = runHook({
    toolkitDir,
    homeDir,
    cwd,
    hookInput: { error: { message: '429 too many requests', provider: 'anthropic' } },
  });

  assert.equal(res.status, 0, `hook should exit 0 — stderr: ${res.stderr}`);
  assert.ok(!fs.existsSync(cooldownPath(homeDir)), 'no cooldown file may be written on a no-op fallback path');
  assert.ok(!fs.existsSync(path.join(cwd, '.env')), 'no .env write on a no-op fallback path');
});

test('without a registry file, behavior is unchanged: null candidate, escalate, no crash', () => {
  const toolkitDir = freshDir('cx-hook-toolkit-norf-');
  const homeDir = freshDir('cx-hook-home-norf-');
  const cwd = freshDir('cx-hook-cwd-norf-');

  const res = runHook({
    toolkitDir,
    homeDir,
    cwd,
    hookInput: { error: { message: 'unrelated non-retryable failure' } },
  });

  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');
  assert.ok(!fs.existsSync(cooldownPath(homeDir)));
});
