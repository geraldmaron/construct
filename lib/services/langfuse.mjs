/**
 * lib/services/langfuse.mjs — local Langfuse stack management.
 *
 * Construct is local-first. By default Langfuse runs as a Docker stack from
 * `langfuse/docker-compose.yml`, with credentials auto-seeded via the
 * `LANGFUSE_INIT_*` env vars baked into that compose. Cloud Langfuse is
 * supported only when the user explicitly sets `LANGFUSE_BASEURL` to a
 * non-localhost URL — no default points at cloud.langfuse.com.
 *
 * Both `construct setup` (first-time bootstrap) and `construct up` (per-session
 * start) call `startManagedLangfuse` from here; this module is the single
 * place that knows how to spin and verify the local stack.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getUserEnvPath, writeEnvValues } from '../env-config.mjs';

// Construct reserves the 54330-54339 host port block for its Langfuse stack
// (Postgres already occupies 54329). Container-internal ports stay on the
// stock service defaults — only host-facing mappings move into this range so
// developers running Next.js, Prometheus, Redis, MinIO, or Supabase locally
// don't hit collisions.

export const LANGFUSE_LOCAL_BASEURL = 'http://localhost:54330';
export const LANGFUSE_LOCAL_PUBLIC_KEY = 'pk-lf-construct-local';
export const LANGFUSE_LOCAL_SECRET_KEY = 'sk-lf-construct-local';
export const LANGFUSE_LOCAL_ADMIN_EMAIL = 'admin@construct.local';
export const LANGFUSE_LOCAL_ADMIN_PASSWORD = 'construct-admin';
export const LANGFUSE_VERIFY_MAX_RETRIES = 12;
export const LANGFUSE_VERIFY_INTERVAL_MS = 5000;

export function isRemoteLangfuse(url = '') {
  if (!url) return false;
  return !url.includes('localhost') && !url.includes('127.0.0.1');
}

export function langfuseComposePath(rootDir) {
  return path.join(rootDir, 'langfuse', 'docker-compose.yml');
}

// Keep only the N most recent stash pairs (.dump + .json) in the stash dir.

export function pruneStashDir(dir, keep = 3) {
  try {
    const dumps = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.dump'))
      .sort()
      .reverse();
    for (const dump of dumps.slice(keep)) {
      fs.rmSync(path.join(dir, dump), { force: true });
      fs.rmSync(path.join(dir, dump.replace('.dump', '.json')), { force: true });
    }
  } catch { /* non-critical */ }
}

/**
 * Verify Langfuse API keys work against a running container. If the container
 * started from a stale volume (pre-LANGFUSE_INIT_* era), keys won't be seeded
 * — stash trace data, drop the volume, recreate the container so the init
 * runs on fresh migration, then rehydrate.
 */
export async function verifyLangfuseKeys({
  baseUrl = LANGFUSE_LOCAL_BASEURL,
  publicKey = LANGFUSE_LOCAL_PUBLIC_KEY,
  secretKey = LANGFUSE_LOCAL_SECRET_KEY,
  composeRunner,
  composeFile,
  homeDir = os.homedir(),
  maxRetries = LANGFUSE_VERIFY_MAX_RETRIES,
  intervalMs = LANGFUSE_VERIFY_INTERVAL_MS,
  spawnSyncFn = spawnSync,
  fetchFn = globalThis.fetch,
  overallTimeoutMs = 0,
} = {}) {
  async function doVerify() {
    const auth = `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetchFn(`${baseUrl}/api/public/health`, { signal: controller.signal }).finally(() => clearTimeout(timer));
        if (res.ok) break;
      } catch { /* not ready yet */ }
      if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetchFn(`${baseUrl}/api/public/traces?limit=1`, {
        headers: { Authorization: auth },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) return { status: 'verified' };
    } catch {
      return { status: 'unreachable' };
    }

    if (!composeRunner || !composeFile) return { status: 'auth-failed', reseeded: false };

    const stashDir = path.join(homeDir, '.construct', 'backups', 'langfuse');
    fs.mkdirSync(stashDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dumpFile = path.join(stashDir, `traces-${timestamp}.dump`);
    const manifestFile = path.join(stashDir, `traces-${timestamp}.json`);

    const authTables = [
      'organizations', 'org_memberships', 'projects', 'project_memberships',
      'api_keys', 'users', 'accounts', 'sessions', '_prisma_migrations',
    ];
    const excludeArgs = authTables.flatMap((t) => ['--exclude-table-data', t]);

    const dump = spawnSyncFn('docker', [
      'exec', 'construct-langfuse-db',
      'pg_dump', '-U', 'langfuse', '-d', 'langfuse',
      '-Fc',
      '--data-only',
      ...excludeArgs,
    ], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 200 * 1024 * 1024 });

    const hasData = dump.status === 0 && dump.stdout?.length > 100;
    if (hasData) {
      fs.writeFileSync(dumpFile, dump.stdout);
      fs.writeFileSync(manifestFile, JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        reason: 'langfuse-key-reseed',
        dumpFile: path.basename(dumpFile),
        dumpBytes: dump.stdout.length,
        excludedTables: authTables,
        langfuseVersion: '3',
      }, null, 2) + '\n');
    }

    const args = [...composeRunner.argsPrefix, '-p', 'construct-langfuse', '-f', composeFile];
    spawnSyncFn(composeRunner.command, [...args, 'down', '-v'], { stdio: 'ignore' });
    spawnSyncFn(composeRunner.command, [...args, 'up', '-d'], { stdio: 'ignore' });

    let healthy = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetchFn(`${baseUrl}/api/public/traces?limit=1`, {
          headers: { Authorization: auth },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (res.ok) { healthy = true; break; }
      } catch { /* still starting */ }
    }

    if (healthy && hasData) {
      spawnSyncFn('docker', [
        'cp', dumpFile, 'construct-langfuse-db:/tmp/traces.dump',
      ], { stdio: 'ignore' });
      const restore = spawnSyncFn('docker', [
        'exec', 'construct-langfuse-db',
        'pg_restore', '-U', 'langfuse', '-d', 'langfuse',
        '--data-only', '--disable-triggers', '--no-owner',
        '/tmp/traces.dump',
      ], { stdio: 'ignore' });

      pruneStashDir(stashDir, 3);
      return { status: 'reseeded', dataPreserved: restore.status === 0, stashPath: dumpFile };
    }

    if (healthy) return { status: 'reseeded', dataPreserved: false };

    return { status: 'auth-failed', reseeded: true };
  }

  if (overallTimeoutMs > 0) {
    return Promise.race([
      doVerify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('verifyLangfuseKeys timeout')), overallTimeoutMs)),
    ]);
  }
  return doVerify();
}

/**
 * Bring the local Langfuse stack up from `langfuse/docker-compose.yml`.
 * Writes the local keys back to `~/.construct/config.env` so subsequent
 * processes resolve them. Returns a status payload with the resolved URL,
 * verify outcome, and seeded credentials.
 *
 * If `LANGFUSE_BASEURL` already points at a remote URL, returns without
 * starting anything (caller still gets a `{ status: 'configured' }` result
 * so it can report the remote URL to the user).
 */
export async function startManagedLangfuse({
  rootDir,
  homeDir = os.homedir(),
  env = process.env,
  composeRunner,
  spawnDetached,
  verifyKeysFn = verifyLangfuseKeys,
  writeEnvFn = writeEnvValues,
} = {}) {
  if (!rootDir) throw new Error('startManagedLangfuse: rootDir is required');
  if (!composeRunner) throw new Error('startManagedLangfuse: composeRunner is required (call detectDockerCompose first)');
  if (!spawnDetached) throw new Error('startManagedLangfuse: spawnDetached is required');

  const remote = isRemoteLangfuse(env.LANGFUSE_BASEURL ?? '');
  if (remote) {
    return { status: 'configured', url: env.LANGFUSE_BASEURL, note: 'using configured remote Langfuse URL' };
  }

  const composeFile = langfuseComposePath(rootDir);
  if (!fs.existsSync(composeFile)) {
    return { status: 'unavailable', note: `langfuse compose file missing at ${composeFile}` };
  }

  const { logPath } = spawnDetached(
    composeRunner.command,
    [...composeRunner.argsPrefix, '-p', 'construct-langfuse', '-f', composeFile, 'up', '-d'],
    homeDir,
    'langfuse.log',
  );

  const envPath = getUserEnvPath(homeDir);
  writeEnvFn(envPath, {
    LANGFUSE_BASEURL: LANGFUSE_LOCAL_BASEURL,
    LANGFUSE_PUBLIC_KEY: LANGFUSE_LOCAL_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: LANGFUSE_LOCAL_SECRET_KEY,
    LANGFUSE_ADMIN_EMAIL: LANGFUSE_LOCAL_ADMIN_EMAIL,
    LANGFUSE_ADMIN_PASSWORD: LANGFUSE_LOCAL_ADMIN_PASSWORD,
  });

  const verify = await verifyKeysFn({
    composeRunner,
    composeFile,
    homeDir,
    maxRetries: 3,
    intervalMs: 2000,
    overallTimeoutMs: 30000,
  });

  const note = verify.status === 'reseeded'
    ? 'keys reseeded — stale volume was recreated'
    : verify.status === 'auth-failed'
      ? `keys rejected — manual reset needed; logs: ${logPath}`
      : `startup complete; logs: ${logPath}`;

  return {
    status: verify.status === 'auth-failed' ? 'degraded' : 'started',
    url: LANGFUSE_LOCAL_BASEURL,
    note,
    composeFile,
    logPath,
    verify: verify.status,
    credentials: {
      adminEmail: LANGFUSE_LOCAL_ADMIN_EMAIL,
      adminPassword: LANGFUSE_LOCAL_ADMIN_PASSWORD,
      publicKey: LANGFUSE_LOCAL_PUBLIC_KEY,
      secretKey: LANGFUSE_LOCAL_SECRET_KEY,
    },
  };
}
