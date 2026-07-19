/**
 * tests/functional/model-registry-wiring.functional.test.mjs
 *
 * Drives the real `construct models resolve --json` binary and proves the model
 * registry (specialists/org/models.json under CONSTRUCT_TOOLKIT_DIR) is reachable on
 * the embedded resolution path — the embedded resolver defaults registryPath to
 * the toolkit registry so a dropped-in models.json binds tier defaults. Asserts:
 * a registry tier resolves with no env pin; an env pin overrides the registry;
 * and with neither
 * a registry file nor an env pin the resolver still degrades to config-error
 * (no implicit defaults).
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
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const tmpDirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

// A minimal toolkit whose org tree mirrors the repo (assembleRegistry requires
// specialists/org to exist) plus the registry file under test.
function toolkitWith(models) {
  const dir = freshDir('cx-registry-toolkit-');
  const org = path.join(dir, 'specialists', 'org');
  fs.cpSync(path.join(REPO_ROOT, 'specialists', 'org'), org, { recursive: true });
  if (models) {
    fs.writeFileSync(path.join(org, 'models.json'), JSON.stringify({ models }, null, 2));
  }
  return dir;
}

// A machine-ambient credential (a provider API key in the environment, an
// authenticated `gh` CLI, a running `ollama` daemon) is a real source the
// resolver consults, so the no-registry/no-pin case would otherwise resolve
// the uccl.2 credential-family-fallback instead of config-error. Every case
// runs against a scrubbed baseline (empty PATH via process.execPath, all
// provider + CONSTRUCT_MODEL_* keys blanked) so the assertions isolate the registry.
function resolveModel(args, env = {}) {
  const cwd = freshDir('cx-registry-cwd-');
  const res = spawnSync(process.execPath, [BIN, 'models', 'resolve', '--json', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      PATH: '',
      ANTHROPIC_API_KEY: '',
      OPENROUTER_API_KEY: '',
      OPEN_ROUTER_API_KEY: '',
      OPENAI_API_KEY: '',
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      OLLAMA_BASE_URL: '',
      OLLAMA_HOST: '',
      LOCAL_LLM_BASE_URL: '',
      CONSTRUCT_MODEL_REASONING: '',
      CONSTRUCT_MODEL_STANDARD: '',
      CONSTRUCT_MODEL_FAST: '',
      CONSTRUCT_MODEL_REASONING: '',
      CONSTRUCT_MODEL_STANDARD: '',
      CONSTRUCT_MODEL_FAST: '',
      ...env,
    },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('a registry models.json under CONSTRUCT_TOOLKIT_DIR resolves the tier model with no env pin', () => {
  const toolkit = toolkitWith({
    standard: { primary: 'anthropic/claude-sonnet-4-6', fallback: [] },
  });
  const out = resolveModel(['--tier', 'standard'], { CONSTRUCT_TOOLKIT_DIR: toolkit });
  assert.equal(out.data.resolutionSource, 'tier-default');
  assert.equal(out.data.selectedModel, 'anthropic/claude-sonnet-4-6');
  assert.equal(out.data.tierSource, 'registry');
});

test('an env pin overrides the registry tier default', () => {
  const toolkit = toolkitWith({
    standard: 'anthropic/claude-sonnet-4-6',
  });
  const out = resolveModel(['--tier', 'standard'], {
    CONSTRUCT_TOOLKIT_DIR: toolkit,
    CONSTRUCT_MODEL_STANDARD: 'anthropic/claude-opus-4-6',
  });
  assert.equal(out.data.resolutionSource, 'tier-default');
  assert.equal(out.data.selectedModel, 'anthropic/claude-opus-4-6');
  assert.equal(out.data.tierSource, 'env override');
});

test('no registry file and no env pin still degrades to config-error (no implicit defaults)', () => {
  const toolkit = toolkitWith(null);
  const out = resolveModel(['--tier', 'fast'], { CONSTRUCT_TOOLKIT_DIR: toolkit });
  assert.equal(out.data.resolutionSource, 'config-error');
});
