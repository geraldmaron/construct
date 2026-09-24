/**
 * cli/migrate.ts — upgrade a project's state database from an older format,
 * backing it up first. This is the only path that changes a store's format:
 * commands that read never do, and a server that finds an older store
 * reports it instead of upgrading it under another session's feet.
 *
 * Every Construct session on the project is stopped first: one still running
 * an older Construct would go on writing to the store after the upgrade,
 * without the new format's protections. So the upgrade is refused while
 * another process has the store open, unless forced. The backup is taken under
 * the upgrade's own write lock, so it holds exactly the store the upgrade
 * starts from, and it is removed again when the upgrade fails without
 * changing the store.
 */

import { chmodSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUSY_TIMEOUT_MS, isBusyError, openStateStore, type StateStore } from '../kernel/state/open.ts';
import { STATE_FORMAT_VERSION, StateBusyError, UnsupportedStateError } from '../kernel/state/format.ts';
import { boolFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { bindProject, createContext, ProjectBusyError, type CliContext } from './context.ts';
import { processesHolding } from './holders.ts';
import { esc, OperationError, say, writeJson } from './output.ts';

const STOP_SESSIONS = 'Stop every Construct session on this project first (close its agent sessions, or stop their MCP servers)';

export const MIGRATE_SPEC: CommandSpec = {
  path: ['migrate'],
  gloss: 'upgrade this project’s state from an older format, after writing a backup beside it; stop every Construct session on this project first',
  group: 'Recover',
  positionals: [],
  flags: [{ name: 'force', gloss: 'upgrade even while another process has the state open', takesValue: false }],
  readOnly: false,
};

function backupPathFor(dbPath: string, found: number, at: string): string {
  const stamp = at.replace(/[^0-9]/g, '').slice(0, 17);
  return join(dirname(dbPath), `construct.pre-v${String(found)}-${stamp}-${randomBytes(3).toString('hex')}.sqlite`);
}

/** Copy the store to `backup`, owner-only. A copy that did not finish is removed. */
function backUp(dbPath: string, backup: string): void {
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    source.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    source.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  } catch (error) {
    rmSync(backup, { force: true });
    if (isBusyError(error)) throw new StateBusyError(dbPath);
    throw error;
  } finally {
    source.close();
  }
  chmodSync(backup, 0o600);
}

/** The format version the file carries now, or null when it cannot be read. */
function formatOnDisk(dbPath: string): number | null {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      const row = db.prepare(`SELECT value FROM meta WHERE key = 'format_version'`).get() as { value: string } | undefined;
      const version = Number(row?.value);
      return Number.isFinite(version) ? version : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export function migrate(args: ParsedArgs, ctx: CliContext = createContext()): number {
  const bound = bindProject(ctx);
  const dbPath = bound.layout.dbPath;
  if (!existsSync(dbPath)) {
    throw new OperationError(`this project has no state database at ${dbPath}`, 'Run `construct init` to create it.');
  }

  const report = (migrated: boolean, from: number | null, backup: string | null, lines: readonly string[]): number => {
    if (args.json) writeJson({ path: dbPath, format: STATE_FORMAT_VERSION, migrated, from, backup });
    else {
      say(lines[0]!);
      if (backup) say(`  backup: ${esc(backup)}`);
      for (const line of lines.slice(1)) say(`  ${line}`);
    }
    return 0;
  };

  try {
    openStateStore(dbPath, { readOnly: true }).close();
    return report(false, null, null, [`State at ${esc(dbPath)} is already format ${String(STATE_FORMAT_VERSION)}; nothing to do.`]);
  } catch (error) {
    if (error instanceof StateBusyError) throw new ProjectBusyError(error.message);
    if (!(error instanceof UnsupportedStateError) || error.kind !== 'older') throw error;
  }

  const holders = processesHolding(dbPath);
  if (holders.length > 0 && !boolFlag(args, 'force')) {
    throw new OperationError(
      `the state database is open in ${String(holders.length)} other process(es) (pid ${holders.join(', ')}), most likely an agent session’s MCP server; one running an older Construct would go on writing to the store after the upgrade, without format ${String(STATE_FORMAT_VERSION)}’s protections`,
      `${STOP_SESSIONS}, then run migrate again. --force upgrades anyway.`,
    );
  }

  const taken: { path: string | null; from: number | null } = { path: null, from: null };
  let store: StateStore;
  try {
    store = openStateStore(dbPath, {
      migrate: true,
      beforeUpgrade: (found) => {
        const path = backupPathFor(dbPath, found, ctx.now());
        backUp(dbPath, path);
        taken.path = path;
        taken.from = found;
      },
    });
  } catch (openError) {
    if (taken.path !== null && formatOnDisk(dbPath) === taken.from) {
      // The upgrade wrote nothing: the store is still what the copy holds.
      rmSync(taken.path, { force: true });
      taken.path = null;
    }
    if (openError instanceof StateBusyError) throw new ProjectBusyError(openError.message);
    if (taken.path !== null) {
      throw new OperationError(
        openError instanceof Error ? openError.message : String(openError),
        `The upgrade changed the store before it failed. The copy taken before it began is at ${taken.path}.`,
      );
    }
    throw openError;
  }
  const from = store.migratedFrom;
  store.close();
  if (from === null) {
    // Another process upgraded the store while this one waited for the lock,
    // and took its own backup first; the store is now this format, complete.
    return report(false, null, null, [`State at ${esc(dbPath)} was upgraded to format ${String(STATE_FORMAT_VERSION)} by another Construct process; nothing to do.`]);
  }
  return report(true, from, taken.path, [
    `Upgraded ${esc(dbPath)} from format ${String(from)} to ${String(STATE_FORMAT_VERSION)}.`,
    `Any session still running an older Construct must be stopped: it would go on writing to this store without format ${String(STATE_FORMAT_VERSION)}’s protections. Start it again on this version.`,
  ]);
}
