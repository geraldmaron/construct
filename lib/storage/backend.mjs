#!/usr/bin/env node
/**
 * lib/storage/backend.mjs — shared storage backend helpers for SQL/vector wiring.
 */
import postgres from 'postgres';
import { resolveDatabaseUrl } from '../env-config.mjs';

function cleanUrl(url) {
  return String(url || '').trim();
}

export function createSqlClient(env = process.env) {
  const databaseUrl = cleanUrl(resolveDatabaseUrl(env));
  if (!databaseUrl) return null;
  return postgres(databaseUrl, {
    max: Number.parseInt(env.CONSTRUCT_DB_POOL_SIZE || '5', 10),
    idle_timeout: Number.parseInt(env.CONSTRUCT_DB_IDLE_TIMEOUT_MS || '30000', 10),
    connect_timeout: Number.parseInt(env.CONSTRUCT_DB_CONNECT_TIMEOUT_MS || '5000', 10),
  });
}

export async function probeSqlClient(client) {
  if (!client) return { status: 'unavailable', message: 'No SQL client configured' };
  try {
    await client`select 1 as ok`;
    return { status: 'healthy', message: 'Shared Postgres store reachable' };
  } catch (error) {
    return { status: 'degraded', message: `SQL store unreachable: ${error?.message || 'unknown error'}` };
  }
}

export async function closeSqlClient(client) {
  if (!client) return;
  await client.end({ timeout: 5 });
}

export function readVectorConfig(env = process.env) {
  const endpoint = cleanUrl(env.CONSTRUCT_VECTOR_URL);
  const indexPath = cleanUrl(env.CONSTRUCT_VECTOR_INDEX_PATH);
  return {
    endpoint: endpoint || null,
    indexPath: indexPath || null,
    model: cleanUrl(env.CONSTRUCT_VECTOR_MODEL) || null,
  };
}
