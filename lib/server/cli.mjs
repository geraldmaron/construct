/**
 * lib/server/cli.mjs — `construct server` command surface
 * mirroring lib/workspace/cli.mjs's dispatch
 * shape: numeric exit codes, process.stdout/stderr.write rather than
 * console.*.
 *
 * Subcommands:
 *   start [--host=] [--port=]   Start the shared workspace server. Requires
 *                                DATABASE_URL/CONSTRUCT_DATABASE_URL to be a
 *                                reachable Postgres instance (createSqlClient
 *                                returns null otherwise; this command refuses
 *                                to start rather than silently running with
 *                                no durable store).
 *   migrate                     Apply pending Postgres migrations and exit —
 *                                the deployment image's init step
 *                                (docker-compose.yml's `migrate` service).
 */

import { createSqlClient, closeSqlClient, probeSqlClient } from '../storage/backend.mjs';
import { applyMigrations } from '../db/migrate.mjs';
import { startServer } from './http.mjs';

function parseFlag(args, name) {
  const flag = args.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.slice(name.length + 3) : undefined;
}

async function runStart(args, { env }) {
  const sql = createSqlClient(env);
  if (!sql) {
    process.stderr.write('construct server start requires a reachable Postgres client: set DATABASE_URL or CONSTRUCT_DATABASE_URL.\n');
    return 1;
  }
  const probe = await probeSqlClient(sql);
  if (probe.status !== 'available') {
    process.stderr.write(`construct server start: Postgres is not reachable — ${probe.message}\n`);
    await closeSqlClient(sql);
    return 1;
  }
  await applyMigrations(sql);

  const host = parseFlag(args, 'host');
  const port = parseFlag(args, 'port');
  const { server, host: boundHost, port: boundPort } = await startServer({
    sql, env, host, port: port ? Number(port) : undefined,
  });
  process.stdout.write(`construct server listening on http://${boundHost}:${boundPort}\n`);

  const shutdown = async () => {
    server.close();
    await closeSqlClient(sql);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return new Promise(() => {});
}

async function runMigrate(_args, { env }) {
  const sql = createSqlClient(env);
  if (!sql) {
    process.stderr.write('construct server migrate requires a reachable Postgres client: set DATABASE_URL or CONSTRUCT_DATABASE_URL.\n');
    return 1;
  }
  try {
    const result = await applyMigrations(sql);
    process.stdout.write(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ') || '(none pending)'}\n`);
    return 0;
  } finally {
    await closeSqlClient(sql);
  }
}

/**
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv }} [ctx]
 * @returns {Promise<number>} exit code (`start` never resolves on success,
 *   running until SIGINT/SIGTERM)
 */
export async function runServerCli(args, { env = process.env } = {}) {
  const sub = args[0] || 'start';
  if (sub === 'start') return runStart(args.slice(1), { env });
  if (sub === 'migrate') return runMigrate(args.slice(1), { env });
  process.stderr.write(`Unknown server subcommand: ${sub}. Available: start, migrate\n`);
  return 1;
}
