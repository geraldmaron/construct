/**
 * kernel/source/manifest.ts — what a source held at its last read, item by
 * item, so a refresh can name what was added, removed, or modified instead
 * of only saying "something changed".
 *
 * The manifest rides on the source.changed observation; the latest one is
 * the current manifest. Items carry a fingerprint and, for small work items,
 * their text, which is what evidence resolution checks wording against.
 */

import type { StateStore } from '../state/open.ts';
import { listObservations } from '../state/drift.ts';
import type { SnapshotItem } from './connector.ts';

export interface ManifestEntry {
  readonly ref: string;
  readonly kind: string;
  readonly fingerprint: string;
  readonly text?: string;
  /** Another item in the same source that declares it replaces this one. */
  readonly supersededBy?: string;
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
      fingerprint: typeof fp === 'string' ? fp : '',
      ...(typeof text === 'string' ? { text } : {}),
      ...(typeof by === 'string' ? { supersededBy: by } : {}),
    };
  });
}

/** The manifest recorded at the source's most recent change, or null when none was ever recorded. */
export function currentManifest(store: StateStore, sourceId: string): ManifestEntry[] | null {
  const changed = listObservations(store, { sourceId, limit: 2000 }).filter((o) => o.kind === 'source.changed');
  for (let i = changed.length - 1; i >= 0; i -= 1) {
    const ev = changed[i]!.evidence as { manifest?: unknown } | null;
    if (ev && Array.isArray(ev.manifest)) return ev.manifest as ManifestEntry[];
  }
  return null;
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
