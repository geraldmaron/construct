/**
 * tests/functional/embedded-contract-model-resolve.functional.test.mjs
 *
 * Drives the real `construct models resolve --json` binary in an isolated tmpdir
 * and asserts the versioned envelope, the resolution precedence end-to-end, and
 * the load-bearing guarantee that a credential placed in the environment never
 * appears in the contract output.
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

const tmpDirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-model-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch {}
  }
});

function resolveModel(args, env = {}) {
  const cwd = freshCwd();
  const res = spawnSync('node', [BIN, 'models', 'resolve', '--json', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: cwd, // Redirect HOME to isolation dir
      USERPROFILE: cwd,
      ...env
    },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

// A machine-ambient CLI session (`gh auth status`, a running `ollama` daemon)
// is a real credential source isProviderConfigured consults outside `env` —
// so a case asserting no-credential config-error must also strip PATH access
// to those binaries, or an authenticated developer machine falsely resolves
// the credential-family-fallback this suite does not exercise.
function resolveModelNoAmbientProviders(args, env = {}) {
  const cwd = freshCwd();
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
      ...env
    },
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('models resolve --json returns a versioned envelope on the cli surface', () => {
  const env = resolveModel(['--host-model', 'anthropic/claude-sonnet-4-6']);
  assert.match(env.contractVersion, /^\d+\.\d+\.\d+$/);
  assert.ok(env.constructVersion);
  assert.equal(env.surface, 'cli');
  assert.ok(env.deploymentMode);
  assert.equal(env.data.resolutionSource, 'host-model');
  assert.equal(env.data.selectedModel, 'anthropic/claude-sonnet-4-6');
});

test('models resolve --json honors the precedence chain', () => {
  // Same-family fallback fires when the host provider is recognized.
  assert.equal(
    resolveModel(['--host-provider', 'anthropic', '--tier', 'reasoning']).data.resolutionSource,
    'same-family-fallback',
  );

  // Tier-default fires when an env override resolves the requested tier.
  assert.equal(
    resolveModel(['--tier', 'fast'], { CONSTRUCT_MODEL_FAST: 'anthropic/claude-haiku-4-6' }).data.resolutionSource,
    'tier-default',
  );

  // Construct ships no implicit defaults. An unconfigured tier
  // with no credential anywhere returns a structured config-error rather
  // than silently substituting an Anthropic default or a credential-derived
  // family fallback (construct-uccl.2).
  assert.equal(
    resolveModelNoAmbientProviders(['--tier', 'fast']).data.resolutionSource,
    'config-error',
  );

  // Unrecognized host model without cross-provider permission → config-error.
  assert.equal(
    resolveModelNoAmbientProviders(['--host-model', 'mystery/x']).data.resolutionSource,
    'config-error',
  );

  // Cross-provider permission lets the resolver cascade to the tier default;
  // without a configured tier or credential that still ends in config-error.
  assert.equal(
    resolveModelNoAmbientProviders(['--host-model', 'mystery/x', '--allow-cross-provider']).data.resolutionSource,
    'config-error',
  );
});

test('a credential in the environment never leaks into contract output', () => {
  const env = resolveModel(['--host-model', 'anthropic/claude-sonnet-4-6'], { ANTHROPIC_API_KEY: 'cred-canary-model-fn-0001' });
  const serialized = JSON.stringify(env);
  assert.equal(serialized.includes('cred-canary-model-fn-0001'), false, 'secret must not appear in output');
  assert.equal(env.data.requiresCredential, false, 'credential present → requiresCredential false');
});
