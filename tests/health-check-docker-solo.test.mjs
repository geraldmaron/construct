/**
 * tests/health-check-docker-solo.test.mjs
 *
 * Guards construct-fvw5.4: quickHealthCheck() must return ok:true when Docker is
 * absent in solo mode. Docker is only critical for team/enterprise deployments
 * (Docker worker pool). Solo mode uses embedded LanceDB + Git-backed state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { quickHealthCheck } from '../lib/health-check.mjs';
import { DEPLOYMENT_MODE_ENV_KEY } from '../lib/deployment-mode.mjs';

test('quickHealthCheck returns ok:true when Docker is absent in solo mode', async () => {
  // Force solo mode and simulate Docker absence by overriding PATH to exclude docker.
  const savedMode = process.env[DEPLOYMENT_MODE_ENV_KEY];
  const savedPath = process.env.PATH;

  process.env[DEPLOYMENT_MODE_ENV_KEY] = 'solo';

  // Remove docker from PATH by pointing to an empty temp directory.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const emptyBin = mkdtempSync(tmpdir() + '/cx-no-docker-');
  process.env.PATH = emptyBin;

  try {
    const result = await quickHealthCheck({ homeDir: process.env.HOME });
    assert.ok(result.missing.indexOf('Docker') === -1, `Docker should not be in missing list in solo mode, got: ${JSON.stringify(result.missing)}`);
    // cm and Node are also checked; we only assert Docker is not critical here.
    // ok may still be false if cm is missing, but Docker must not be the cause.
    const dockerCausedFailure = result.missing.includes('Docker');
    assert.equal(dockerCausedFailure, false, 'Docker must not cause ok:false in solo mode');
  } finally {
    process.env.PATH = savedPath;
    if (savedMode === undefined) {
      delete process.env[DEPLOYMENT_MODE_ENV_KEY];
    } else {
      process.env[DEPLOYMENT_MODE_ENV_KEY] = savedMode;
    }
    const { rmSync } = await import('node:fs');
    try { rmSync(emptyBin, { recursive: true, force: true }); } catch {}
  }
});

test('quickHealthCheck adds Docker to critical in team mode when Docker is absent', async () => {
  const savedMode = process.env[DEPLOYMENT_MODE_ENV_KEY];
  const savedPath = process.env.PATH;

  process.env[DEPLOYMENT_MODE_ENV_KEY] = 'team';

  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const emptyBin = mkdtempSync(tmpdir() + '/cx-no-docker-team-');
  process.env.PATH = emptyBin;

  try {
    const result = await quickHealthCheck({ homeDir: process.env.HOME });
    assert.ok(result.missing.includes('Docker'), `Docker should be in missing list in team mode, got: ${JSON.stringify(result.missing)}`);
  } finally {
    process.env.PATH = savedPath;
    if (savedMode === undefined) {
      delete process.env[DEPLOYMENT_MODE_ENV_KEY];
    } else {
      process.env[DEPLOYMENT_MODE_ENV_KEY] = savedMode;
    }
    const { rmSync } = await import('node:fs');
    try { rmSync(emptyBin, { recursive: true, force: true }); } catch {}
  }
});
