/**
 * lib/storage/backend.mjs — shared storage backend helpers.
 *
 * Construct uses embedded LanceDB and Git-backed state by default. When a
 * Postgres URL is configured, createSqlClient returns the optional Postgres.js
 * tagged-template client for shared run-store and migration paths.
 */

import { createRequire } from 'node:module';
import { resolveDatabaseUrl } from '../env-config.mjs';

const require = createRequire(import.meta.url);

function clean(value) {
  return String(value ?? '').trim();
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePostgresUrl(env) {
  return clean(env?.DATABASE_URL || env?.CONSTRUCT_DATABASE_URL || resolveDatabaseUrl(env));
}

function resolveSsl(value) {
  const raw = clean(value).toLowerCase();
  if (!raw || raw === 'false' || raw === '0' || raw === 'disable') return false;
  if (raw === 'true' || raw === '1') return true;
  if (['require', 'prefer', 'verify-full'].includes(raw)) return raw;
  return false;
}

function loadPostgresFactory(postgresFactory) {
  if (postgresFactory) return postgresFactory;
  try {
    const mod = require('postgres');
    return mod.default || mod;
  } catch (err) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw err;
  }
}

export function createSqlClient(env = process.env, { postgresFactory } = {}) {
  const url = resolvePostgresUrl(env);
  if (!url) return null;

  const postgres = loadPostgresFactory(postgresFactory);
  if (!postgres) return null;

  return postgres(url, {
    max: positiveInt(env?.CONSTRUCT_DB_MAX_CONNECTIONS, 5),
    idle_timeout: positiveInt(env?.CONSTRUCT_DB_IDLE_TIMEOUT_SECONDS, 20),
    connect_timeout: positiveInt(env?.CONSTRUCT_DB_CONNECT_TIMEOUT_SECONDS, 10),
    ssl: resolveSsl(env?.CONSTRUCT_DB_SSL || env?.PGSSLMODE),
    prepare: true,
    onnotice: false,
    connection: { application_name: clean(env?.CONSTRUCT_DB_APPLICATION_NAME) || 'construct' },
  });
}

export async function probeSqlClient(client) {
  if (!client) return { status: 'unavailable', message: 'SQL client is not configured. Set DATABASE_URL or CONSTRUCT_DATABASE_URL.' };
  try {
    await client`SELECT 1 AS ok`;
    return { status: 'available', message: 'Postgres connection succeeded' };
  } catch (err) {
    return { status: 'unavailable', message: err?.message || String(err) };
  }
}

export async function closeSqlClient(client) {
  if (client?.end) await client.end({ timeout: 5 });
}
