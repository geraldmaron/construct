/**
 * tests/functional/enterprise-doctor-fail-closed.functional.test.mjs
 *
 * ADR-0057's construct-status contract: a FAIL-CLOSED enterprise capability
 * (tenant-isolation, isolated-workers) "must not be a warning; it must be a
 * hard error" surfaced "at startup (during construct doctor)". A LATER
 * capability (rbac, signed-mcp-allowlists) has no runtime effect and must
 * not read as a doctor failure at all.
 *
 * Spawns the real `construct doctor` binary in enterprise mode against a
 * throwaway HOME and asserts on its actual exit code and stdout — not a
 * mocked check list — so a future edit that softens the fail-closed gate
 * back into a warning is caught here.
 *
 * Bead: construct-9oi4.8 (LMCP-H, ADR-0057 follow-up)
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

function env(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-enterprise-doctor-'));
  return {
    home,
    env: {
      ...process.env,
      HOME: home,
      CX_HOME_OVERRIDE: home,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      CONSTRUCT_DEPLOYMENT_MODE: 'enterprise',
      CONSTRUCT_TENANT_ID: 'cx-enterprise-doctor-tenant',
      ...extra,
    },
    cleanup() { fs.rmSync(home, { recursive: true, force: true }); },
  };
}

function runDoctor(extraEnv) {
  const ctx = env(extraEnv);
  try {
    return spawnSync(process.execPath, [BIN, 'doctor'], {
      cwd: REPO, env: ctx.env, encoding: 'utf8', timeout: 180_000,
    });
  } finally {
    ctx.cleanup();
  }
}

// A single enterprise-mode doctor run covers both assertions below — spawning
// `construct doctor` shells out to the real `bd` binary as part of its beads-
// hygiene check, so each invocation is comparatively expensive; one spawn per
// mode keeps this test from compounding that cost.

test('construct doctor in enterprise mode: fail-closed hard-fails, later-wave stays informational', () => {
  const result = runDoctor();
  assert.ok(result.stdout, `doctor produced no stdout (status=${result.status}, signal=${result.signal}).\nstderr: ${(result.stderr || '').slice(0, 2000)}`);

  const failClosedLine = result.stdout.split('\n').find((l) => l.includes('Mode capabilities (enterprise)') && l.includes('fail-closed'));
  assert.ok(failClosedLine, `doctor output should include a fail-closed capabilities line.\nstdout: ${result.stdout.slice(0, 2000)}`);
  assert.match(failClosedLine, /✗/, 'a fail-closed gap must render as a hard failure, not ⚠');
  assert.match(failClosedLine, /tenant-isolation|isolated-workers|Tenant isolation|Isolated worker containers/i);

  const laterLine = result.stdout.split('\n').find((l) => l.includes('Mode capabilities (enterprise)') && l.includes('later wave'));
  assert.ok(laterLine, `doctor output should include a later-wave capabilities line.\nstdout: ${result.stdout.slice(0, 2000)}`);
  assert.match(laterLine, /✓/, 'a later-wave capability must never render as a doctor failure or warning symbol');
  assert.match(laterLine, /RBAC|rbac|Signed MCP allowlists|signed-mcp-allowlists/i);

  assert.equal(result.status, 1, 'doctor must exit non-zero while enterprise fail-closed capabilities are unimplemented — a hard error, not a warning');
});

test('construct doctor in solo mode is unaffected by the enterprise fail-closed gate', () => {
  const result = runDoctor({ CONSTRUCT_DEPLOYMENT_MODE: 'solo', CONSTRUCT_TENANT_ID: undefined });
  assert.ok(result.stdout, `doctor produced no stdout (status=${result.status}, signal=${result.signal}).\nstderr: ${(result.stderr || '').slice(0, 2000)}`);

  const line = result.stdout.split('\n').find((l) => l.includes('Mode capabilities (solo)'));
  assert.ok(line, `doctor output should include a solo Mode capabilities line.\nstdout: ${result.stdout.slice(0, 2000)}`);
  assert.match(line, /✓/, 'solo mode is fully-implemented and must not be affected by the enterprise fail-closed gate');
});
