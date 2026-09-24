/**
 * cli/migrate.ts — upgrade a project's state database from the previous
 * format, backing it up first. This is the only path that changes a store's
 * format: commands that read never do, and a server that finds an older store
 * reports it instead of upgrading it under another session's feet.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStateStore } from '../kernel/state/open.ts';
import { STATE_FORMAT_VERSION, UnsupportedStateError } from '../kernel/state/format.ts';
import { type CommandSpec, type ParsedArgs } from './commands.ts';
import { bindProject, createContext, type CliContext } from './context.ts';
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
  const stamp = at.replace(/[^0-9]/g, '').slice(0, 14);
  return join(dirname(dbPath), `construct.pre-v${String(found ?? 'unknown')}-${stamp}.sqlite`);
}

export function migrate(args: ParsedArgs, ctx: CliContext = createContext()): number {
  const bound = bindProject(ctx);
  const dbPath = bound.layout.dbPath;
  if (!existsSync(dbPath)) {
    throw new OperationError(`this project has no state database at ${dbPath}`, 'Run `construct init` to create it.');
  }

  try {
    openStateStore(dbPath, { readOnly: true }).close();
    if (args.json) writeJson({ path: dbPath, format: STATE_FORMAT_VERSION, migrated: false, backup: null });
    else say(`State at ${esc(dbPath)} is already format ${String(STATE_FORMAT_VERSION)}; nothing to do.`);
    return 0;
  } catch (error) {
    if (!(error instanceof UnsupportedStateError) || error.kind !== 'older') throw error;
    const backup = backupPathFor(dbPath, error.foundVersion, ctx.now());
    const source = new DatabaseSync(dbPath, { readOnly: true });
    try {
      source.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    } finally {
      source.close();
    }
    openStateStore(dbPath, { migrate: true }).close();
    if (args.json) writeJson({ path: dbPath, format: STATE_FORMAT_VERSION, migrated: true, from: error.foundVersion, backup });
    else {
      say(`Upgraded ${esc(dbPath)} from format ${String(error.foundVersion)} to ${String(STATE_FORMAT_VERSION)}.`);
      say(`  backup: ${esc(backup)}`);
    }
    return 0;
  }
}
