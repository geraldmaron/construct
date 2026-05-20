#!/usr/bin/env node
/**
 * lib/storage/sql-store.mjs — lightweight shared SQL storage facade.
 */
import { createSqlClient, probeSqlClient } from './backend.mjs';
import { resolveDatabaseUrl } from '../env-config.mjs';

export function hasSqlStore(env = process.env) {
  return Boolean(resolveDatabaseUrl(env));
}

export function detectStoreMode(env = process.env) {
  if (resolveDatabaseUrl(env)) return 'postgres';
  return 'file';
}

export function describeSqlStore(env = process.env) {
  const mode = detectStoreMode(env);
  return {
    mode,
    configured: mode !== 'file',
    sharedReady: mode === 'postgres',
    fallbackAvailable: mode === 'file',
    hasDatabaseUrl: Boolean(resolveDatabaseUrl(env)),
  };
}

export async function describeSqlStoreHealth(env = process.env) {
  const store = describeSqlStore(env);
  if (store.mode !== 'postgres') return sqlStoreHealth(env);
  const client = createSqlClient(env);
  try {
    return await probeSqlClient(client);
  } finally {
    if (client) await client.end({ timeout: 5 }).catch(() => {});
  }
}

export function sqlStoreHealth(env = process.env) {
  const store = describeSqlStore(env);
  if (store.mode === 'postgres') {
    return { status: 'configured', message: 'Shared Postgres store is configured' };
  }
  return { status: 'unavailable', message: 'No SQL store configured; using file-state only' };
}
