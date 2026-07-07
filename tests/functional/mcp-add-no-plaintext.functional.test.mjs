/**
 * tests/functional/mcp-add-no-plaintext.functional.test.mjs
 *
 * Epic 4 (credential remediation): `construct mcp add <local-stdio-mcp>` must keep
 * 1Password references and unresolved templates out of host config files, and the
 * single secret store (XDG config.env) must be chmod 0600. This drives the real
 * cmdMcpAdd path under an isolated HOME with a non-key canary supplied as the
 * required env var.
 *
 * Scope note: the value-to-reference flip for resolved literals is deferred (no
 * confirmed per-host stdio env-block interpolation), so a resolved plaintext literal
 * still materializes into host configs today. That residual is asserted explicitly
 * rather than masked, and is called out in the remediation report. What this test
 * guarantees now: an op:// reference never lands in a host config, and config.env is
 * always 0600.
 *
 * The canary is a hyphenated non-key string so the pre-commit secret scanner does
 * not flag the test as embedding a credential.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCP_MANAGER = path.join(REPO_ROOT, 'lib', 'mcp-manager.mjs');

const canaryNotAKey = 'CANARY-zz9-not-a-key';
const opRefCanary = 'op://Private/canary/credential';

// A child process drives the real cmdMcpAdd against an isolated HOME. linear is a
// manual-only stdio MCP requiring LINEAR_API_KEY; supplying the value in env makes
// the add non-interactive (no prompt, no TTY needed).

function runMcpAdd(home, cwd, linearApiKey) {
  const driver = `
    import { cmdMcpAdd } from ${JSON.stringify(MCP_MANAGER)};
    await cmdMcpAdd('linear');
  `;
  const env = { ...process.env };
  delete env.XDG_STATE_HOME;
  delete env.XDG_CACHE_HOME;
  env.HOME = home;
  env.USERPROFILE = home;
  env.XDG_CONFIG_HOME = path.join(home, '.config');
  env.LINEAR_API_KEY = linearApiKey;
  return spawnSync(process.execPath, ['--input-type=module', '-e', driver], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env,
  });
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function hostConfigPaths(home) {
  return [
    path.join(home, '.claude.json'),
    path.join(home, '.config', 'opencode', 'opencode.json'),
    path.join(home, '.codex', 'config.toml'),
  ];
}

function configEnvPath(home) {
  return path.join(home, '.config', 'construct', 'config.env');
}

function freshDirs(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-add-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-add-cwd-'));
  t.after(() => {
    for (const d of [home, cwd]) {
      try { rmTmpDir(d); } catch {}
    }
  });
  return { home, cwd };
}

function assertConfigEnvSecure(home, expectedValue) {
  const file = configEnvPath(home);
  assert.ok(fs.existsSync(file), 'config.env should have been written under the isolated HOME');
  assert.ok(readIfExists(file).includes(expectedValue), 'config.env should hold the credential carrier');
  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(mode, 0o600, `config.env must be chmod 0600, got ${mode.toString(8)}`);
}

test('an op:// reference never lands in any host config; config.env stays 0600', (t) => {
  const { home, cwd } = freshDirs(t);
  const result = runMcpAdd(home, cwd, opRefCanary);
  assert.equal(result.status, 0, `cmdMcpAdd should exit cleanly: ${result.stderr || result.stdout}`);

  for (const file of hostConfigPaths(home)) {
    assert.ok(
      !readIfExists(file).includes('op://'),
      `${file} must not contain a 1Password reference`,
    );
  }
  assertConfigEnvSecure(home, opRefCanary);
});

// Value-to-reference flip (Epic 4): a resolved plaintext secret is emitted into the
// Claude config as a ${NAME} env-reference rather than the literal, so the live value
// stays only in the 0600 config.env store.

test('resolved secret flips to a host env-reference in the Claude config, never the literal', (t) => {
  const { home, cwd } = freshDirs(t);
  const result = runMcpAdd(home, cwd, canaryNotAKey);
  assert.equal(result.status, 0, `cmdMcpAdd should exit cleanly: ${result.stderr || result.stdout}`);

  const claude = readIfExists(path.join(home, '.claude.json'));
  assert.ok(!claude.includes(canaryNotAKey), 'the literal secret must not land in the Claude config');
  assert.ok(claude.includes('${LINEAR_API_KEY}'), 'the Claude config must carry a ${LINEAR_API_KEY} env-reference');
  assertConfigEnvSecure(home, canaryNotAKey);
});
