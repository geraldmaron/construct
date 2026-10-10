/**
 * kernel/source/manifest.ts — what a source held at its last read, item by
 * item, so a refresh can name what was added, removed, or modified instead
 * of only saying "something changed".
 *
 * The manifest rides on the source.changed observation; the latest one is
 * the current manifest. Items carry a fingerprint and, for work items and
 * pages a host read, their text (what evidence resolution checks wording
 * against) and the address a person would open.
 */

import type { StateStore } from '../state/open.ts';
import { latestObservationWith } from '../state/drift.ts';
import type { SnapshotItem } from './connector.ts';

export interface ManifestEntry {
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly ref: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly text?: string;
  /** Another item in the same source that declares it replaces this one. */
  readonly supersededBy?: string;
  /** The system's own last-updated time for a reported item, when it gave one. */
  readonly updatedAt?: string;
  /** Recorded from a passing sighting with no version; its fingerprint says nothing about content. */
  readonly weak?: boolean;
  /** The address a person would open for this item; a citation of it means this item. */
  readonly url?: string;
  /** The kept text stops short of what was read: it was cut at the cap. */
  readonly truncated?: boolean;
  /** The host tool whose response carried this item, when a hook recorded it rather than the host reporting it. */
  readonly via?: string;
  /** Reader-specific facts kept so the next read can skip unchanged items (size, mtime, what it supersedes). */
  readonly attributes?: Readonly<Record<string, unknown>>;
}

export interface ItemChanges {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
}

export function toManifest(items: readonly SnapshotItem[]): ManifestEntry[] {
  return items.map((i) => {
    const fp = i.attributes?.fingerprint;
    const text = i.attributes?.text;
    const by = i.attributes?.supersededBy;
    return {
      ref: i.externalRef,
      kind: i.kind,
      ...(i.attributes?.schema && typeof i.attributes.schema === 'object' ? { schema: i.attributes.schema as Record<string, unknown> } : {}),
      fingerprint: typeof fp === 'string' ? fp : '',
      ...(typeof text === 'string' ? { text } : {}),
      ...(typeof by === 'string' ? { supersededBy: by } : {}),
      ...(i.attributes && ('size' in i.attributes || 'supersedes' in i.attributes) ? { attributes: { size: i.attributes.size, mtimeMs: i.attributes.mtimeMs, supersedes: i.attributes.supersedes, declaredSupersededBy: i.attributes.declaredSupersededBy } } : {}),
      ...(typeof i.attributes?.updatedAt === 'string' ? { updatedAt: i.attributes.updatedAt } : {}),
      ...(i.attributes?.weak === true ? { weak: true } : {}),
      ...(typeof i.attributes?.url === 'string' ? { url: i.attributes.url } : {}),
      ...(i.attributes?.truncated === true ? { truncated: true } : {}),
      ...(typeof i.attributes?.via === 'string' ? { via: i.attributes.via } : {}),
    };
  });
}

export interface CurrentManifest {
  readonly entries: ManifestEntry[];
  /** "witnessed" when Construct read the source itself; "reported" when a host or fixture said what it held. */
  readonly provenance: 'witnessed' | 'reported';
}

/** The manifest recorded at the source's most recent change, with how it was obtained, or null when none was recorded. */
export function currentManifestRecord(store: StateStore, sourceId: string): CurrentManifest | null {
  // Newest first, straight from the store: a source with a long history must still resolve to its latest read.
  const o = latestObservationWith(store, sourceId, 'source.changed', 'manifest');
  const ev = o?.evidence as { manifest?: unknown; evidence?: unknown } | null | undefined;
  if (!ev || !Array.isArray(ev.manifest)) return null;
  return { entries: ev.manifest as ManifestEntry[], provenance: ev.evidence === 'reported' ? 'reported' : 'witnessed' };
}

/** The manifest entries recorded at the source's most recent change, or null when none was ever recorded. */
export function currentManifest(store: StateStore, sourceId: string): ManifestEntry[] | null {
  return currentManifestRecord(store, sourceId)?.entries ?? null;
}

export function diffManifests(before: readonly ManifestEntry[] | null, after: readonly ManifestEntry[]): ItemChanges {
  const prev = new Map((before ?? []).map((e) => [e.ref, e.fingerprint]));
  const next = new Map(after.map((e) => [e.ref, e.fingerprint]));
  const added: string[] = [];
  const modified: string[] = [];
  for (const [ref, fp] of next) {
    if (!prev.has(ref)) added.push(ref);
    else if (prev.get(ref) !== fp) modified.push(ref);
  }
  const removed = [...prev.keys()].filter((ref) => !next.has(ref));
  return { added: added.sort(), removed: removed.sort(), modified: modified.sort() };
}

export function describeChanges(c: ItemChanges, cap = 8): string {
  const part = (label: string, refs: readonly string[]) =>
    refs.length === 0 ? null : `${label} ${refs.slice(0, cap).join(', ')}${refs.length > cap ? ` (+${String(refs.length - cap)} more)` : ''}`;
  return [part('added', c.added), part('modified', c.modified), part('removed', c.removed)].filter(Boolean).join('; ') || 'no item-level change';
}
