/**
 * kernel/store/ratifications.ts — the record of which project settings files a
 * person has ratified, and for which repository.
 *
 * A `.construct/settings.json` sitting in a checked-out repository is ground its
 * author wrote, not the person running Construct: cloning a repository hands you
 * whatever that file says, and it could point a workspace at another host or
 * bind it somewhere its author chose. So the file is inert until someone
 * ratifies its exact bytes, and this table is where that ratification lives.
 *
 * Trust is keyed on the pair (repository identity, content hash), never the hash
 * alone. A byte-identical trivial file must not carry a grant made in one
 * repository into another one, so a ratification says "these bytes, in this
 * repository" and nothing broader. The hash is over the raw file bytes; a
 * whitespace-only edit is a different hash and a different grant, which is the
 * point — a file whose meaning a reviewer signed off on is exactly its bytes,
 * and anything that re-wrote them is a file nobody signed off on yet.
 *
 * The row keeps the values those bytes parsed to and the absolute path trust was
 * granted for, so a later prompt can tell a person what a changed file changed
 * and whether a still-untrusted file is the one they edited or a different one.
 * This module stores described values and never reads the clock or the
 * environment: the timestamp and the repository identity are the caller's to
 * supply, the same discipline every other module under this directory keeps.
 */

import type { Store } from './open.ts';

/** One ratification: these bytes, in this repository, trusted at this moment. */
export interface Ratification {
  readonly repoIdentity: string;
  readonly contentHash: string;
  /** The absolute path the grant was made for, so a re-ask can name it. */
  readonly path: string;
  /** The validated values the ratified bytes parsed to, for a changed-key diff. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly ratifiedAt: string;
}

interface Row {
  readonly repo_identity: string;
  readonly content_hash: string;
  readonly path: string;
  readonly settings: string;
  readonly ratified_at: string;
}

function fromRow(row: Row): Ratification {
  return {
    repoIdentity: row.repo_identity,
    contentHash: row.content_hash,
    path: row.path,
    settings: JSON.parse(row.settings) as Record<string, unknown>,
    ratifiedAt: row.ratified_at,
  };
}

/**
 * Record that a person has ratified these bytes for this repository. An upsert
 * on the (repository, hash) pair: ratifying the same bytes for the same
 * repository again refreshes the record rather than filing a second one, and a
 * new hash for the same repository is a new grant beside the old, not a
 * replacement of it — trust in one set of bytes says nothing about another.
 */
export function ratifySettingsFile(store: Store, ratification: Ratification): void {
  store.db
    .prepare(
      `INSERT INTO settings_ratifications (repo_identity, content_hash, path, settings, ratified_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (repo_identity, content_hash)
       DO UPDATE SET path = excluded.path, settings = excluded.settings, ratified_at = excluded.ratified_at`,
    )
    .run(
      ratification.repoIdentity,
      ratification.contentHash,
      ratification.path,
      JSON.stringify(ratification.settings),
      ratification.ratifiedAt,
    );
}

/**
 * Whether this repository has ratified exactly these bytes. The whole gate rests
 * on this being the raw-bytes hash and the repository identity together: a match
 * on one without the other is not a match.
 */
export function settingsFileRatified(
  store: Store,
  repoIdentity: string,
  contentHash: string,
): boolean {
  const row = store.db
    .prepare(
      'SELECT 1 AS present FROM settings_ratifications WHERE repo_identity = ? AND content_hash = ?',
    )
    .get(repoIdentity, contentHash) as { present: number } | undefined;
  return row !== undefined;
}

/**
 * The most recent ratification this repository holds, or null if it holds none.
 * A re-ask compares its path against the file in hand to say whether an
 * untrusted file is a changed one (same path, new bytes) or a different one.
 */
export function latestRatificationForRepo(
  store: Store,
  repoIdentity: string,
): Ratification | null {
  const row = store.db
    .prepare(
      `SELECT repo_identity, content_hash, path, settings, ratified_at
       FROM settings_ratifications
       WHERE repo_identity = ?
       ORDER BY ratified_at DESC, content_hash DESC
       LIMIT 1`,
    )
    .get(repoIdentity) as Row | undefined;
  return row ? fromRow(row) : null;
}

/** Withdraw a specific grant. Returns whether a row was there to remove. */
export function revokeRatification(
  store: Store,
  repoIdentity: string,
  contentHash: string,
): boolean {
  const result = store.db
    .prepare('DELETE FROM settings_ratifications WHERE repo_identity = ? AND content_hash = ?')
    .run(repoIdentity, contentHash);
  return result.changes > 0;
}
