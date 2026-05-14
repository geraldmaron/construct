/**
 * tests/services-langfuse.test.mjs — `startManagedLangfuse` + `isRemoteLangfuse`.
 *
 * Pins the local-first invariant: Construct never points at cloud.langfuse.com
 * by default. Verifies that startManagedLangfuse short-circuits for explicitly
 * remote URLs and otherwise spins the local stack with auto-seeded keys.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

function __rootDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

import {
  LANGFUSE_LOCAL_BASEURL,
  LANGFUSE_LOCAL_PUBLIC_KEY,
  LANGFUSE_LOCAL_SECRET_KEY,
  LANGFUSE_LOCAL_ADMIN_EMAIL,
  LANGFUSE_LOCAL_ADMIN_PASSWORD,
  isRemoteLangfuse,
  startManagedLangfuse,
  langfuseComposePath,
} from '../lib/services/langfuse.mjs';
import { parseEnvFile } from '../lib/env-config.mjs';

describe('isRemoteLangfuse', () => {
  it('treats empty string as not remote (local default)', () => {
    assert.equal(isRemoteLangfuse(''), false);
    assert.equal(isRemoteLangfuse(undefined), false);
  });
  it('treats localhost URLs as local', () => {
    assert.equal(isRemoteLangfuse('http://localhost:54330'), false);
    assert.equal(isRemoteLangfuse('http://localhost'), false);
    assert.equal(isRemoteLangfuse('http://127.0.0.1:54330'), false);
  });
  it('treats anything else as remote (including cloud.langfuse.com)', () => {
    assert.equal(isRemoteLangfuse('https://cloud.langfuse.com'), true);
    assert.equal(isRemoteLangfuse('https://langfuse.acme.example'), true);
    assert.equal(isRemoteLangfuse('https://us.cloud.langfuse.com'), true);
  });
});

describe('startManagedLangfuse', () => {
  let tmpHome;
  let tmpRoot;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-lf-home-'));
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-lf-root-'));
    fs.mkdirSync(path.join(tmpRoot, 'langfuse'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'langfuse', 'docker-compose.yml'), 'services:\n  langfuse-web: {}\n');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('short-circuits for remote LANGFUSE_BASEURL — never spins local docker', async () => {
    let spawnCalled = false;
    const result = await startManagedLangfuse({
      rootDir: tmpRoot,
      homeDir: tmpHome,
      env: { LANGFUSE_BASEURL: 'https://langfuse.acme.example' },
      composeRunner: { command: 'docker', argsPrefix: ['compose'] },
      spawnDetached: () => { spawnCalled = true; return { logPath: '/dev/null' }; },
      verifyKeysFn: async () => ({ status: 'verified' }),
    });
    assert.equal(result.status, 'configured');
    assert.equal(result.url, 'https://langfuse.acme.example');
    assert.equal(spawnCalled, false, 'no docker compose up for remote URL');
  });

  it('spins local stack and writes seeded keys + admin login to ~/.construct/config.env', async () => {
    const spawnCalls = [];
    const result = await startManagedLangfuse({
      rootDir: tmpRoot,
      homeDir: tmpHome,
      env: {},
      composeRunner: { command: 'docker', argsPrefix: ['compose'] },
      spawnDetached: (cmd, args, _home, log) => {
        spawnCalls.push({ cmd, args, log });
        return { logPath: path.join(tmpHome, '.construct', 'runtime', log) };
      },
      verifyKeysFn: async () => ({ status: 'verified' }),
    });

    assert.equal(result.status, 'started');
    assert.equal(result.url, LANGFUSE_LOCAL_BASEURL);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].cmd, 'docker');
    assert.ok(spawnCalls[0].args.includes('up'), 'spawned `compose up`');
    assert.ok(spawnCalls[0].args.includes('-d'), 'spawned detached');

    const env = parseEnvFile(path.join(tmpHome, '.construct', 'config.env'));
    assert.equal(env.LANGFUSE_BASEURL, LANGFUSE_LOCAL_BASEURL);
    assert.equal(env.LANGFUSE_PUBLIC_KEY, LANGFUSE_LOCAL_PUBLIC_KEY);
    assert.equal(env.LANGFUSE_SECRET_KEY, LANGFUSE_LOCAL_SECRET_KEY);
    assert.equal(env.LANGFUSE_ADMIN_EMAIL, LANGFUSE_LOCAL_ADMIN_EMAIL, 'admin email surfaced for user login');
    assert.equal(env.LANGFUSE_ADMIN_PASSWORD, LANGFUSE_LOCAL_ADMIN_PASSWORD, 'admin password surfaced for user login');

    assert.deepEqual(result.credentials, {
      adminEmail: LANGFUSE_LOCAL_ADMIN_EMAIL,
      adminPassword: LANGFUSE_LOCAL_ADMIN_PASSWORD,
      publicKey: LANGFUSE_LOCAL_PUBLIC_KEY,
      secretKey: LANGFUSE_LOCAL_SECRET_KEY,
    }, 'result includes credentials block so callers can print a login summary');
  });

  it('confirms seeded login matches docker-compose LANGFUSE_INIT_USER_* values', async () => {
    const compose = fs.readFileSync(path.join(__rootDir(), 'langfuse', 'docker-compose.yml'), 'utf8');
    const emailMatch = compose.match(/LANGFUSE_INIT_USER_EMAIL:\s*"([^"]+)"/);
    const pwMatch = compose.match(/LANGFUSE_INIT_USER_PASSWORD:\s*"([^"]+)"/);
    assert.ok(emailMatch, 'LANGFUSE_INIT_USER_EMAIL set in compose');
    assert.ok(pwMatch, 'LANGFUSE_INIT_USER_PASSWORD set in compose');
    assert.equal(emailMatch[1], LANGFUSE_LOCAL_ADMIN_EMAIL,
      'compose seed email matches module constant — drift would silently break user login');
    assert.equal(pwMatch[1], LANGFUSE_LOCAL_ADMIN_PASSWORD,
      'compose seed password matches module constant — drift would silently break user login');
  });

  it('confirms langfuse-web binds to 127.0.0.1:54330 only (Construct port block, not network-exposed)', () => {
    const compose = fs.readFileSync(path.join(__rootDir(), 'langfuse', 'docker-compose.yml'), 'utf8');
    assert.match(compose, /"127\.0\.0\.1:54330:3000"/,
      'seeded admin creds + open port = footgun on untrusted networks; bind localhost only');
    assert.doesNotMatch(compose, /^\s*-\s*"3000:3000"\s*$/m,
      'no all-interfaces binding for langfuse-web');
    assert.doesNotMatch(compose, /^\s*-\s*"127\.0\.0\.1:3000:3000"\s*$/m,
      'no stock :3000 host mapping — collides with Next.js / Vite dev servers');
  });

  it('uses the 54330+ Construct port block for every host-facing mapping', () => {
    const compose = fs.readFileSync(path.join(__rootDir(), 'langfuse', 'docker-compose.yml'), 'utf8');
    const hostPorts = [...compose.matchAll(/127\.0\.0\.1:(\d+):/g)].map((m) => Number(m[1]));
    assert.ok(hostPorts.length >= 7, `expected ≥7 host-facing ports, got ${hostPorts.length}`);
    for (const port of hostPorts) {
      assert.ok(port >= 54330 && port <= 54339,
        `host port ${port} is outside Construct's 54330-54339 reserved block — collisions likely`);
    }
    assert.match(compose, /NEXTAUTH_URL: http:\/\/localhost:54330/,
      'NEXTAUTH_URL must match host-facing langfuse-web port or OAuth redirects break');
    assert.match(compose, /LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT: http:\/\/localhost:54335/,
      'browser-facing S3 endpoint must match host-facing minio port');
  });

  it('exports LANGFUSE_LOCAL_BASEURL pointing at the Construct port block', () => {
    assert.equal(LANGFUSE_LOCAL_BASEURL, 'http://localhost:54330',
      'constant must match the host-facing port in langfuse/docker-compose.yml');
  });

  it('returns unavailable when compose file is missing', async () => {
    fs.rmSync(path.join(tmpRoot, 'langfuse', 'docker-compose.yml'));
    const result = await startManagedLangfuse({
      rootDir: tmpRoot,
      homeDir: tmpHome,
      env: {},
      composeRunner: { command: 'docker', argsPrefix: ['compose'] },
      spawnDetached: () => { throw new Error('should not be called'); },
    });
    assert.equal(result.status, 'unavailable');
    assert.match(result.note, /missing/);
  });

  it('reports degraded status when verify fails with auth-failed (keys rejected)', async () => {
    const result = await startManagedLangfuse({
      rootDir: tmpRoot,
      homeDir: tmpHome,
      env: {},
      composeRunner: { command: 'docker', argsPrefix: ['compose'] },
      spawnDetached: () => ({ logPath: '/tmp/lf.log' }),
      verifyKeysFn: async () => ({ status: 'auth-failed' }),
    });
    assert.equal(result.status, 'degraded');
    assert.match(result.note, /keys rejected/);
  });

  it('points langfuseComposePath at the bundled compose file', () => {
    assert.equal(langfuseComposePath('/repo'), path.join('/repo', 'langfuse', 'docker-compose.yml'));
  });
});
