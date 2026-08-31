/**
 * kernel/state/format.ts — Construct project-state format identity.
 *
 * There is no migration from prior alpha schemas. An old store is refused
 * and the operator must `construct reset` (or init into a clean location).
 */

/** Current on-disk format. Starts at 1; never inherits schema-23 numbering. */
export const STATE_FORMAT_ID = 'construct-state';
export const STATE_FORMAT_VERSION = 1;

export const UNSUPPORTED_ALPHA_MESSAGE =
  'Construct state is from an unsupported alpha format.\n' +
  'Run `construct reset` to initialize the current format.';

export class UnsupportedAlphaStoreError extends Error {
  readonly foundFormat: string | null;
  readonly foundVersion: number | null;

  constructor(foundFormat: string | null, foundVersion: number | null) {
    super(UNSUPPORTED_ALPHA_MESSAGE);
    this.name = 'UnsupportedAlphaStoreError';
    this.foundFormat = foundFormat;
    this.foundVersion = foundVersion;
  }
}
