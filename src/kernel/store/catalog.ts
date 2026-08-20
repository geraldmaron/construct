/**
 * kernel/store/catalog.ts — the richest catalog this store has been opened
 * with, kept so an older Construct can hear that it is behind.
 *
 * One store is shared by every Construct on the machine: the released binary a
 * host launches and the newer build a working tree runs. Each answers catalog
 * questions from its own compiled-in domain list, so the same store can be
 * read through two catalogs of different sizes — and a host trial found
 * exactly that, an installed build answering with fifteen domains while the
 * tree carried seventeen, with silence on both sides. The store is the only
 * place both builds visit, so the store is where the newer one can leave word.
 *
 * The mark is advance-only, the same discipline as the schema version above
 * it: an older Construct opening the store must never lower it, because the
 * mark's entire value is that it survives being read by the build it warns.
 * Nothing here blocks anything — a build behind the mark still works; it is
 * merely able to say so.
 *
 * Ordering is semantic-version order including prerelease rules (alpha.5
 * before alpha.10), because the versions compared are this package's own.
 * Two versions that do not parse are incomparable and order as equal; the
 * domain count then breaks the tie, since a bigger catalog is the very
 * richness the mark records.
 */

import type { Store } from './open.ts';

export interface CatalogSighting {
  /** The Construct version that brought this catalog. */
  readonly version: string;
  /** How many domains that build's catalog carried. */
  readonly domains: number;
  readonly at: string;
}

const VERSION_KEY = 'catalog_seen_version';
const DOMAINS_KEY = 'catalog_seen_domains';
const AT_KEY = 'catalog_seen_at';

interface Parsed {
  readonly release: readonly number[];
  readonly pre: readonly (string | number)[] | null;
}

function parseVersion(version: string): Parsed | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?/.exec(version.trim());
  if (!match) return null;
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre:
      match[4] === undefined
        ? null
        : match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
  };
}

/**
 * Semantic-version order: negative when `a` is older, positive when newer,
 * zero when equal or when either side does not parse — an unparsable version
 * asserts nothing, and guessing an order for it would let a dev build named
 * anything outrank a real release.
 */
export function compareCatalogVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa.release[i] !== pb.release[i]) return pa.release[i] - pb.release[i];
  }
  // A release outranks any of its prereleases.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const length = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < length; i += 1) {
    const ia = pa.pre[i];
    const ib = pb.pre[i];
    if (ia === ib) continue;
    // Numeric identifiers order numerically and below every alphanumeric one.
    if (typeof ia === 'number' && typeof ib === 'number') return ia - ib;
    if (typeof ia === 'number') return -1;
    if (typeof ib === 'number') return 1;
    return ia < ib ? -1 : 1;
  }
  return pa.pre.length - pb.pre.length;
}

/** The richest catalog recorded on this store, or null when none has been. */
export function catalogHighWater(store: Store): CatalogSighting | null {
  const rows = store.db
    .prepare('SELECT key, value FROM meta WHERE key IN (?, ?, ?)')
    .all(VERSION_KEY, DOMAINS_KEY, AT_KEY) as unknown as Array<{ key: string; value: string }>;
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const version = byKey.get(VERSION_KEY);
  const domains = byKey.get(DOMAINS_KEY);
  if (version === undefined || domains === undefined) return null;
  return { version, domains: Number(domains), at: byKey.get(AT_KEY) ?? '' };
}

/** Whether the recorded mark is strictly richer than the catalog answering. */
export function sightingAhead(
  seen: CatalogSighting,
  answering: { readonly version: string; readonly domains: number },
): boolean {
  const order = compareCatalogVersions(seen.version, answering.version);
  if (order !== 0) return order > 0;
  return seen.domains > answering.domains;
}

/**
 * Record that a Construct carrying this catalog opened the store. Advance-only:
 * a sighting that is not strictly richer than the mark writes nothing, so an
 * older build cannot erase the word a newer one left.
 */
export function recordCatalogSighting(store: Store, sighting: CatalogSighting): void {
  const seen = catalogHighWater(store);
  if (seen && !sightingAhead(sighting, seen)) return;
  const upsert = store.db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  upsert.run(VERSION_KEY, sighting.version);
  upsert.run(DOMAINS_KEY, String(sighting.domains));
  upsert.run(AT_KEY, sighting.at);
}
