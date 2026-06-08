/**
 * lib/storage/backend.mjs — shared storage backend helpers.
 *
 * Construct now uses embedded LanceDB and Git-backed state. 
 * createSqlClient and related helpers are retained as stubs to prevent
 * breaking existing imports, but they no longer facilitate local 
 * Postgres orchestration.
 */

export function createSqlClient(env = process.env) {
  // Construct no longer manages local Postgres. External DATABASE_URL is
  // ignored for local-first operations.
  return null;
}

export async function probeSqlClient(client) {
  return { status: 'unavailable', message: 'SQL backend is no longer used for local operations' };
}

export async function closeSqlClient(client) {
  return Promise.resolve();
}
