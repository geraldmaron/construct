/**
 * lib/services/telemetry-backend.mjs — local services stack management.
 *
 * Manages the local Postgres service (services/docker-compose.yml).
 * In solo mode, Postgres runs as a Docker container with pgvector enabled.
 *
 * Remote telemetry backends (for trace ingestion) are configured via
 * CONSTRUCT_TELEMETRY_URL / CONSTRUCT_TELEMETRY_PUBLIC_KEY /
 * CONSTRUCT_TELEMETRY_SECRET_KEY env vars. This module handles local
 * infrastructure only — it does not manage telemetry dashboard services.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getUserEnvPath, writeEnvValues } from '../env-config.mjs';

/** Local Postgres port (within Construct's 54329-54339 reserved block). */
export const POSTGRES_LOCAL_PORT = 54332;

export function isRemoteTelemetry(url = '') {
  if (!url) return false;
  return !url.includes('localhost') && !url.includes('127.0.0.1');
}

export function servicesComposePath(rootDir) {
  return path.join(rootDir, 'services', 'docker-compose.yml');
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
 * Verify that the Postgres service is reachable. Returns a status object.
 * Verifies the Postgres service is up and ready.
 */
export async function verifyPostgresHealth({
  port = POSTGRES_LOCAL_PORT,
  fetchFn = globalThis.fetch,
  maxRetries = 5,
  intervalMs = 2000,
} = {}) {
  // We can't use fetch against Postgres (it's not HTTP), so just check pg_isready via docker
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = spawnSync('docker', [
        'exec', 'construct-postgres',
        'pg_isready', '-U', 'construct', '-d', 'construct',
      ], { stdio: 'pipe', timeout: 3000 });
      if (result.status === 0) return { status: 'verified' };
    } catch { /* not ready yet */ }
    if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: 'unreachable' };
}

/**
 * Verify telemetry backend keys (remote HTTP).
 * 
 */
export async function verifyTelemetryKeys({
  baseUrl,
  publicKey,
  secretKey,
  composeRunner,
  composeFile,
  homeDir = os.homedir(),
  maxRetries = 5,
  intervalMs = 2000,
  spawnSyncFn = spawnSync,
  fetchFn = globalThis.fetch,
  overallTimeoutMs = 0,
} = {}) {
  const resolvedBaseUrl =
    baseUrl ??
    process.env.CONSTRUCT_TELEMETRY_URL ??
    '';
  const resolvedPublicKey =
    publicKey ??
    process.env.CONSTRUCT_TELEMETRY_PUBLIC_KEY ??
    '';
  const resolvedSecretKey =
    secretKey ??
    process.env.CONSTRUCT_TELEMETRY_SECRET_KEY ??
    '';

  if (!resolvedPublicKey || !resolvedSecretKey || !resolvedBaseUrl) {
    return { status: 'unconfigured' };
  }

  async function doVerify() {
    const auth = `Basic ${Buffer.from(`${resolvedPublicKey}:${resolvedSecretKey}`).toString('base64')}`;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetchFn(`${resolvedBaseUrl}/api/public/health`, {
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (res.ok) break;
      } catch { /* not ready yet */ }
      if (attempt < maxRetries - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetchFn(`${resolvedBaseUrl}/api/public/traces?limit=1`, {
        headers: { Authorization: auth },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (res.ok) return { status: 'verified' };
    } catch {
      return { status: 'unreachable' };
    }
    return { status: 'auth-failed', reseeded: false };
  }

  if (overallTimeoutMs > 0) {
    return Promise.race([
      doVerify(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('verifyTelemetryKeys timeout')), overallTimeoutMs),
      ),
    ]);
  }
  return doVerify();
}

/**
 * Bring up the local Postgres service via services/docker-compose.yml.
 * Starts the local Postgres service via services/docker-compose.yml.
 */
export async function startManagedServices({
  rootDir,
  homeDir = os.homedir(),
  env = process.env,
  composeRunner,
  spawnDetached,
} = {}) {
  if (!rootDir) throw new Error('startManagedServices: rootDir is required');
  if (!composeRunner) throw new Error('startManagedServices: composeRunner is required');
  if (!spawnDetached) throw new Error('startManagedServices: spawnDetached is required');

  const composeFile = servicesComposePath(rootDir);
  if (!fs.existsSync(composeFile)) {
    return { status: 'unavailable', note: `services compose file missing at ${composeFile}` };
  }

  const { logPath } = spawnDetached(
    composeRunner.command,
    [...composeRunner.argsPrefix, '-p', 'construct-services', '-f', composeFile, 'up', '-d'],
    homeDir,
    'services.log',
  );

  return {
    status: 'started',
    note: `Postgres started — connect at localhost:${POSTGRES_LOCAL_PORT}`,
    composeFile,
    logPath,
  };
}


