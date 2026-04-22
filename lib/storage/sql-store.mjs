#!/usr/bin/env node
/**
 * lib/storage/sql-store.mjs — lightweight shared SQL storage facade.
 */
import { existsSync } from 'node:fs';
import { createSqlClient, probeSqlClient } from './backend.mjs';

export function hasSqlStore(env = process.env) {
  return Boolean(env.DATABASE_URL || env.CONSTRUCT_SQLITE_PATH || env.CONSTRUCT_DB_PATH);
}

export function detectStoreMode(env = process.env) {
  if (env.DATABASE_URL) return 'postgres';
  if (env.CONSTRUCT_SQLITE_PATH || env.CONSTRUCT_DB_PATH) return 'sqlite';
  return 'file';
}

export function describeSqlStore(env = process.env) {
  const mode = detectStoreMode(env);
  return {
    mode,
    configured: mode !== 'file',
    sharedReady: mode === 'postgres',
    fallbackAvailable: mode === 'file' || mode === 'sqlite',
    path: env.CONSTRUCT_SQLITE_PATH || env.CONSTRUCT_DB_PATH || null,
    hasDatabaseUrl: Boolean(env.DATABASE_URL),
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
  if (store.mode === 'sqlite') {
    return { status: 'configured', message: 'SQLite-backed store is configured' };
  }
  return { status: 'unavailable', message: 'No SQL store configured; using file-state only' };
}

export function canOpenLocalSqlite(env = process.env) {
  const candidate = env.CONSTRUCT_SQLITE_PATH || env.CONSTRUCT_DB_PATH || null;
  return candidate ? existsSync(candidate) : false;
}
