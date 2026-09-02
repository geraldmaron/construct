/**
 * kernel/state/format.ts — Construct state format identity.
 *
 * A state file carries its format id and version in the `meta` table. Any
 * file that does not carry exactly this format is refused unread: no prior
 * schema is parsed, interpreted, or migrated. The operator resets.
 */

export const STATE_FORMAT_ID = 'construct-state';
export const STATE_FORMAT_VERSION = 2;

export const UNSUPPORTED_STATE_MESSAGE =
  'This Construct state was written by a format this version does not read.\n' +
  'Run `construct reset` to start fresh project state. Your project files are not touched.';

export class UnsupportedStateError extends Error {
  readonly foundFormat: string | null;
  readonly foundVersion: number | null;

  constructor(foundFormat: string | null, foundVersion: number | null) {
    super(UNSUPPORTED_STATE_MESSAGE);
    this.name = 'UnsupportedStateError';
    this.foundFormat = foundFormat;
    this.foundVersion = foundVersion;
  }
}
