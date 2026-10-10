/**
 * kernel/state/format.ts — Construct state format identity.
 *
 * A state file carries its format id and version in the `meta` table. A file
 * in a foreign or ancient format, or missing one of its format's tables, is
 * refused unread and the operator resets. A file in format 2, 3 or 4 is upgraded
 * only by `construct migrate`, once every Construct session on the project is
 * stopped; it backs the file up first. A file in a newer format was written
 * by a newer Construct and is never reset on this build's say-so: the
 * operator upgrades Construct.
 */

export const STATE_FORMAT_ID = 'construct-state';
export const STATE_FORMAT_VERSION = 5;

export const UNSUPPORTED_STATE_MESSAGE =
  'This Construct state was written by a format this version does not read.\n' +
  'Run `construct reset` to start fresh project state. Your project files are not touched.';

export const OLDER_STATE_MESSAGE =
  'This Construct state is in an older format than this version reads.\n' +
  'Stop every Construct session on this project, then run `construct migrate` to upgrade it; the command backs the file up first.';

export const NEWER_STATE_MESSAGE =
  'This Construct state was written by a newer version of Construct.\n' +
  'Upgrade Construct to read it. Do not reset: that would discard state the newer version wrote.';

/** Why a state file was refused: unreadable, one format behind, or ahead of this build. */
export type UnsupportedStateKind = 'foreign' | 'older' | 'newer';

export class UnsupportedStateError extends Error {
  readonly foundFormat: string | null;
  readonly foundVersion: number | null;
  readonly kind: UnsupportedStateKind;

  constructor(foundFormat: string | null, foundVersion: number | null, kind: UnsupportedStateKind = 'foreign') {
    super(kind === 'older' ? OLDER_STATE_MESSAGE : kind === 'newer' ? NEWER_STATE_MESSAGE : UNSUPPORTED_STATE_MESSAGE);
    this.name = 'UnsupportedStateError';
    this.foundFormat = foundFormat;
    this.foundVersion = foundVersion;
    this.kind = kind;
  }
}

/** Another process held the database's write lock past every wait. Nothing is wrong with the file. */
export class StateBusyError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`the state database at ${path} is busy: another Construct process is writing to it`);
    this.name = 'StateBusyError';
    this.path = path;
  }
}
