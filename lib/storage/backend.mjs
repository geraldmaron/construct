/**
 * lib/storage/backend.mjs — shared storage backend helpers.
 *
 * Construct uses embedded LanceDB and Git-backed state. createSqlClient and
 * related helpers are stubs that keep existing imports working without
 * orchestrating local Postgres.
 */

export function createSqlClient(env = process.env) {
  // Stub: local-first operations skip Postgres, so external DATABASE_URL has
  // no effect here.

  return null;
}

export async function probeSqlClient(client) {
  return { status: 'unavailable', message: 'SQL backend is no longer used for local operations' };
}

export async function closeSqlClient(client) {
  return Promise.resolve();
}
