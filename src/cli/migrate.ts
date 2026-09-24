/**
 * cli/migrate.ts — upgrade a project's state database from the previous
 * format, backing it up first. This is the only path that changes a store's
 * format: commands that read never do, and a server that finds an older store
 * reports it instead of upgrading it under another session's feet.
 */

import { chmodSync, existsSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUSY_TIMEOUT_MS, isBusyError, openStateStore } from '../kernel/state/open.ts';
import { STATE_FORMAT_VERSION, StateBusyError, UnsupportedStateError } from '../kernel/state/format.ts';
import { type CommandSpec, type ParsedArgs } from './commands.ts';
import { bindProject, createContext, ProjectBusyError, type CliContext } from './context.ts';
import { esc, OperationError, say, writeJson } from './output.ts';

export const MIGRATE_SPEC: CommandSpec = {
  path: ['migrate'],
  gloss: 'upgrade this project’s state from the previous format, after writing a backup beside it',
  group: 'Recover',
  positionals: [],
  flags: [],
  readOnly: false,
};

function backupPathFor(dbPath: string, found: number | null, at: string): string {
  const stamp = at.replace(/[^0-9]/g, '').slice(0, 17);
  return join(dirname(dbPath), `construct.pre-v${String(found ?? 'unknown')}-${stamp}-${randomBytes(3).toString('hex')}.sqlite`);
}

/** Copy the store to `backup` while holding off writers, owner-only. */
function backUp(dbPath: string, backup: string): void {
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    source.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    source.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  } catch (error) {
    if (isBusyError(error)) throw new ProjectBusyError(`the state database at ${dbPath} is busy: another Construct process is writing to it`);
    throw error;
  } finally {
    source.close();
  }
  chmodSync(backup, 0o600);
}

export function migrate(args: ParsedArgs, ctx: CliContext = createContext()): number {
  const bound = bindProject(ctx);
  const dbPath = bound.layout.dbPath;
  if (!existsSync(dbPath)) {
    throw new OperationError(`this project has no state database at ${dbPath}`, 'Run `construct init` to create it.');
  }

  const report = (migrated: boolean, from: number | null, backup: string | null, note: string): number => {
    if (args.json) writeJson({ path: dbPath, format: STATE_FORMAT_VERSION, migrated, from, backup });
    else {
      say(note);
      if (backup) say(`  backup: ${esc(backup)}`);
    }
    return 0;
  };

  try {
    openStateStore(dbPath, { readOnly: true }).close();
    return report(false, null, null, `State at ${esc(dbPath)} is already format ${String(STATE_FORMAT_VERSION)}; nothing to do.`);
  } catch (error) {
    if (error instanceof StateBusyError) throw new ProjectBusyError(error.message);
    if (!(error instanceof UnsupportedStateError) || error.kind !== 'older') throw error;
    const backup = backupPathFor(dbPath, error.foundVersion, ctx.now());
    backUp(dbPath, backup);
    let store;
    try {
      store = openStateStore(dbPath, { migrate: true });
    } catch (openError) {
      if (openError instanceof StateBusyError) throw new ProjectBusyError(openError.message);
      throw openError;
    }
    const from = store.migratedFrom;
    store.close();
    if (from === null) {
      // Another process upgraded the store between this one's check and its
      // lock, and kept its own backup, taken before it upgraded. This copy is
      // redundant (or already upgraded), so it is not kept.
      rmSync(backup, { force: true });
      return report(false, null, null, `State at ${esc(dbPath)} was upgraded to format ${String(STATE_FORMAT_VERSION)} by another Construct process; nothing to do.`);
    }
    return report(true, from, backup, `Upgraded ${esc(dbPath)} from format ${String(from)} to ${String(STATE_FORMAT_VERSION)}.`);
  }
}
