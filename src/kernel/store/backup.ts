/**
 * kernel/store/backup.ts — a second copy of the store, taken on purpose.
 *
 * The store's triggers make its evidence tables append-only. That stops a row
 * being rewritten; it does nothing about the file being removed. One unlink of
 * the store file takes the whole work log, every task and every raised
 * decision at once, and there is no second copy anywhere to rebuild them from.
 * This module is that second copy: a destination the operator names, outside
 * the store's own directory, carrying a checksum so a copy that has rotted
 * says so instead of passing.
 *
 * Four rules the shape here enforces rather than documents.
 *
 *   - A copy inside the store's own directory is not a copy. The event this
 *     exists to survive takes a directory as readily as it takes one file, so a
 *     destination resolving inside the store's directory is refused — through
 *     symlinks too, because a link is exactly how a destination looks outside
 *     and is not.
 *   - The copy is made by the database, not by the filesystem. Under WAL the
 *     newest commits live in a sidecar beside the store file, so a byte copy of
 *     the store file alone is missing whatever was written most recently and
 *     still looks like a perfectly valid database. `VACUUM INTO` writes one
 *     transactionally consistent file, whole.
 *   - Copying never depends on understanding what is inside. The database is
 *     opened directly rather than through `openStore`, which refuses a store
 *     written by a newer schema — correct for a build about to operate on it,
 *     wrong for a build merely holding it still long enough to copy. A store
 *     this build cannot read is the one an operator most needs a copy of.
 *   - Nothing is taken on a schedule and nothing is taken implicitly. A copy
 *     exists because somebody asked for one, which is why the absence of any
 *     copy has to be said out loud somewhere: `backupDisclosure` is that
 *     sentence.
 *
 * The token-signing secret sitting beside the store is deliberately not
 * copied. It is regenerated on demand and it is evidence of nothing; a copy of
 * it would only be one more place a signing key exists.
 *
 * The kernel's disciplines hold here as everywhere under this directory: no
 * clock (every timestamp is an argument) and no environment (every path is
 * injected).
 */

import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Paths } from '../paths.ts';

/** One copy that was taken: where it went, what it hashed to, and when. */
export interface BackupRecord {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly at: string;
}

/**
 * A destination that cannot serve as a backup, refused before anything is
 * written. Its own class so the CLI can turn exactly this into a sentence and
 * an exit code, and let every other failure keep its stack.
 */
export class BackupRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupRefusedError';
  }
}

/**
 * Where the record of copies taken lives.
 *
 * Not inside the store, and that is the whole point: a record of the backup
 * kept only inside the thing being backed up cannot be read at the one moment
 * it matters. It sits under the state directory instead, so the exact event
 * this module exists for — the store file gone — still leaves a readable
 * pointer at the copy that survived it.
 *
 * A pointer, never a promise: everything that reads this file re-checks that
 * the copy it names is still there.
 */
export function backupLedgerPath(paths: Paths): string {
  return join(paths.stateDir, 'backups.jsonl');
}

/** The checksum written beside a copy, in the format `shasum -c` also reads. */
export function checksumSidecar(backupFile: string): string {
  return `${backupFile}.sha256`;
}

/**
 * Why this directory cannot hold a copy of that store, or null if it can.
 *
 * `destDir` is expected absolute — the caller resolves what the user typed,
 * because resolving it here would mean the kernel reading the working
 * directory. The `resolve` below is a defensive fallback, not an invitation to
 * pass a relative path.
 */
export function destinationProblem(destDir: string, storeFile: string): string | null {
  const storeDir = dirname(storeFile);
  const dest = trueLocation(destDir);

  if (existsSync(dest) && !statSync(dest).isDirectory()) {
    return `${destDir} is not a directory`;
  }

  const trueStoreDir = trueLocation(storeDir);
  if (dest === trueStoreDir || isInside(dest, trueStoreDir)) {
    return (
      `${destDir} resolves inside the store's own directory (${storeDir}) — ` +
      'a copy kept there is taken by the same deletion that takes the store; name a directory outside it'
    );
  }

  return null;
}

/**
 * Copy the store at `storeFile` into `destDir`, and record that it happened.
 *
 * The copy's name carries the moment it was taken, so a second copy never
 * writes over the first: a backup command whose repeated use leaves one file
 * is a command that destroys history while appearing to preserve it.
 */
export function takeBackup(input: {
  readonly storeFile: string;
  readonly destDir: string;
  readonly ledgerFile: string;
  readonly at: string;
}): BackupRecord {
  const { storeFile, destDir, ledgerFile, at } = input;

  if (!existsSync(storeFile)) {
    throw new BackupRefusedError(`there is no store at ${storeFile} yet — nothing to copy`);
  }
  const problem = destinationProblem(destDir, storeFile);
  if (problem !== null) throw new BackupRefusedError(problem);

  const dir = resolve(destDir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `construct-${fileStamp(at)}.db`);
  if (existsSync(file)) {
    throw new BackupRefusedError(`${file} is already there — refusing to write over an existing copy`);
  }

  // Created here, mode 0o600 from the moment it exists, rather than chmod'd
  // after VACUUM INTO has already written it: the copy holds everything the
  // store holds, and a chmod after the fact leaves a window where the file
  // sits at the process's default mode — world-readable under a permissive
  // umask — for however long VACUUM INTO takes to run. 'wx' also refuses if
  // something already claimed the name between the existsSync check above
  // and this call, closing that race too. An empty file VACUUM INTO can
  // write into (confirmed against this Node's node:sqlite): the command
  // fails only when the target already holds database content, not when it
  // exists but is zero bytes.
  closeSync(openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600));

  const db = new DatabaseSync(storeFile);
  try {
    db.exec(`VACUUM INTO ${sqlLiteral(file)}`);
  } finally {
    db.close();
  }

  const record: BackupRecord = {
    file,
    sha256: sha256OfFile(file),
    bytes: statSync(file).size,
    at,
  };
  writeFileSync(checksumSidecar(file), `${record.sha256}  ${basename(file)}\n`, 'utf8');
  mkdirSync(dirname(ledgerFile), { recursive: true });
  appendFileSync(ledgerFile, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/** What verifying one copy found. `matched` is the only thing that means intact. */
export interface BackupVerdict {
  readonly matched: boolean;
  readonly detail: string;
  readonly recorded: string | null;
  readonly actual: string | null;
}

/**
 * Recompute a copy's checksum and hold it against the one recorded when the
 * copy was taken.
 *
 * A copy with no recorded checksum comes back unverified rather than fine.
 * Those are different states and only one of them is safe to restore from; a
 * check that reported the missing sidecar as a pass would be worse than having
 * no check, because it would be believed.
 *
 * The comparison is over bytes, so any write to a copy breaks it — including
 * merely opening the copy as a database, since the journal mode is a fact
 * stored in the file's own header. That is not a rough edge to file down: a
 * check that forgave the differences it judged harmless would be a check
 * exercising judgment, and the whole value here is that it exercises none.
 * A copy is left alone and read from a restore, not worked in place.
 */
export function verifyBackup(file: string): BackupVerdict {
  if (!existsSync(file)) {
    return { matched: false, detail: `there is no file at ${file}`, recorded: null, actual: null };
  }
  const sidecar = checksumSidecar(file);
  const recorded = recordedChecksum(sidecar);
  const actual = sha256OfFile(file);

  if (recorded === null) {
    return {
      matched: false,
      detail: `no usable checksum beside this copy (looked in ${sidecar}) — it cannot be verified, which is not the same as being intact`,
      recorded: null,
      actual,
    };
  }
  return actual === recorded
    ? {
        matched: true,
        detail: 'matches the checksum recorded when the copy was taken',
        recorded,
        actual,
      }
    : {
        matched: false,
        detail: 'does not match the checksum recorded when the copy was taken',
        recorded,
        actual,
      };
}

/** The last recorded copy, and whether the file it names is still there. */
export interface BackupStanding {
  readonly record: BackupRecord;
  readonly present: boolean;
}

/**
 * Every copy the ledger records, oldest first.
 *
 * A line that does not parse is skipped rather than thrown on. This file is
 * plain text an operator may well open, and a stray edit in it must cost them
 * one entry, never the ability to run `doctor`.
 */
export function recordedBackups(ledgerFile: string): readonly BackupRecord[] {
  let raw: string;
  try {
    raw = readFileSync(ledgerFile, 'utf8');
  } catch {
    return [];
  }

  const records: BackupRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const row = parsed as Partial<BackupRecord> | null;
    if (typeof row?.file !== 'string' || typeof row.sha256 !== 'string' || typeof row.at !== 'string') {
      continue;
    }
    records.push({
      file: row.file,
      sha256: row.sha256,
      bytes: typeof row.bytes === 'number' ? row.bytes : 0,
      at: row.at,
    });
  }
  return records;
}

/** The most recent recorded copy, re-checked against the filesystem, or null. */
export function lastBackup(ledgerFile: string): BackupStanding | null {
  const records = recordedBackups(ledgerFile);
  const last = records[records.length - 1];
  if (last === undefined) return null;
  return { record: last, present: existsSync(last.file) };
}

/**
 * One line naming where this store stands for copies — the sentence `doctor`
 * prints.
 *
 * Reading only: it creates no directory and opens no database, because a
 * question about a store must never be what brings one into existence.
 *
 * Having no copy is not a failure and is never reported as one. It is a fact
 * the operator has not been told, and being untold is what turns a deleted
 * file into a discovery rather than an inconvenience.
 */
export function backupDisclosure(ledgerFile: string, at: string): string {
  const standing = lastBackup(ledgerFile);
  if (standing === null) {
    return (
      'no copy of the store has ever been taken — deleting the store file would end the work log, ' +
      'the task history and every raised decision; take one with: construct backup <dir>'
    );
  }
  const age = describeAge(standing.record.at, at);
  if (!standing.present) {
    return (
      `the last copy, taken ${age}, is no longer at ${standing.record.file} — ` +
      'take a fresh one with: construct backup <dir>'
    );
  }
  return `last copy taken ${age}: ${standing.record.file}`;
}

/** Roughly how long ago, for a line meant to be read rather than computed on. */
function describeAge(then: string, at: string): string {
  const from = Date.parse(then);
  const to = Date.parse(at);
  // Unparseable either side, or a copy stamped in the future: say the stamp
  // itself rather than invent an interval nobody can check.
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return `at ${then}`;

  const hours = Math.floor((to - from) / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) return `${String(hours)} hour${hours === 1 ? '' : 's'} ago`;
  return `${String(Math.floor(hours / 24))} days ago`;
}

/** The hex digest recorded in a sidecar, or null when there is nothing usable in it. */
function recordedChecksum(sidecar: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(sidecar, 'utf8');
  } catch {
    return null;
  }
  const first = raw.trim().split(/\s+/)[0] ?? '';
  return /^[0-9a-f]{64}$/.test(first) ? first : null;
}

/** Hashed in chunks: a store large enough to matter is too large to hold in memory to weigh. */
function sha256OfFile(file: string): string {
  const hash = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * A path with every symlink along it followed, including when the path does
 * not exist yet: the walk falls back to the nearest ancestor that does and
 * re-attaches the rest. A destination is judged by where it lands, not by how
 * it is spelled.
 */
function trueLocation(target: string): string {
  const absolute = resolve(target);
  let current = absolute;
  const trailing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...trailing);
    } catch {
      const parent = dirname(current);
      if (parent === current) return absolute;
      trailing.unshift(basename(current));
      current = parent;
    }
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * A timestamp a filesystem accepts and a person can still read and sort.
 *
 * The caller's own string, with only the characters a path cannot hold
 * replaced. Not re-rendered from a parsed date: the name on disk and the
 * moment recorded in the ledger should be the same string, and a
 * normalization step is one more place they could quietly stop being.
 */
function fileStamp(at: string): string {
  const safe = at.replace(/[^0-9A-Za-z.-]/g, '-');
  return safe === '' ? 'unstamped' : safe;
}

/** A SQL string literal. VACUUM INTO takes a path as one, and paths contain quotes. */
function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
