import { urlCarriesCredentials } from '../project/urls.ts';
import { getWork } from '../work/service.ts';
/**
 * kernel/source/resolver.ts — the evidence resolver for a project as it
 * stands: its root, its active sources and their manifests, its deliverables,
 * and the records Construct keeps. One place, so the broker and the source
 * service resolve a reference the same way.
 *
 * A session's resolver is bound to the checkout it works in (checkoutResolver):
 * submission, verification, review and delivery settlement all build it the
 * same way. A pinned reference is answered by the bytes it was observed as,
 * looked for in this checkout and then in the checkout the pin names, when
 * that is one of the project's own.
 */

import type { StateStore } from '../state/open.ts';
import { getSource, listSources } from '../state/sources.ts';
import { listLiveDeliverables } from '../state/deliverables.ts';
import { getStatement, listStatements } from '../state/profile.ts';
import { outdatedTerms } from '../project/governance.ts';
import { getClaim, getEntity } from '../state/graph.ts';
import { getDecision } from '../state/decisions.ts';
import { getRun } from '../state/runs.ts';
import { getDriftFinding } from '../state/drift.ts';
import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { createEvidenceResolver, textDigest, type RecordKind, type RefResolver, type ResolverInput } from '../project/evidence.ts';
import { currentManifestRecord, snapshotManifestRecord, type ManifestEntry } from './manifest.ts';

/** The statement that says a document is no longer current, as the reader sees it: its kind and its words, cut to 160 characters. */
function sayingSo(store: StateStore, statementId: string): string | null {
  const s = getStatement(store, statementId);
  if (!s) return null;
  const text = s.text.replace(/\s+/g, ' ').trim();
  return `${s.kind} "${text.length > 160 ? `${text.slice(0, 159)}…` : text}"`;
}

/** One git checkout of the project: its project directory there, and the commit it has checked out. */
export interface Checkout {
  readonly root: string;
  readonly head: string | null;
}

/** Where a session works: the project's main directory, its own worktree when it is in one, and the project's checkouts as the adapter reads them. */
export interface CheckoutBinding {
  readonly root: string;
  readonly lane: Checkout | null;
  readonly worktrees?: () => readonly Checkout[];
}

/** A path as the file system resolves it, so two spellings of one checkout compare equal. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolvePath(path);
  }
}

/** The resolver for a session's own checkout, which every surface that checks evidence uses. */
export function checkoutResolver(
  store: StateStore,
  where: CheckoutBinding,
  options?: { readonly hostReads?: 'require' | 'accept' },
): RefResolver {
  let listed: readonly Checkout[] | undefined;
  const checkouts = (): readonly Checkout[] => (listed ??= where.worktrees?.() ?? []);
  const own = where.lane?.root ?? where.root;
  const fallback = where.lane ? where.lane.head : null;
  return projectResolver(store, where.root, null, {
    hostReads: options?.hostReads,
    checkout: { root: own, head: () => checkouts().find((c) => canonical(c.root) === canonical(own))?.head ?? fallback },
    checkouts,
  });
}

export function projectResolver(
  store: StateStore,
  root: string,
  override?: {
    readonly sourceId: string;
    readonly manifest: readonly ManifestEntry[] | null;
    readonly provenance?: 'witnessed' | 'reported';
  } | null,
  options?: {
    readonly hostReads?: 'require' | 'accept';
    /** The checkout paths resolve in, when it is not the main one or should be recorded on what resolves. */
    readonly checkout?: { readonly root: string; readonly head: () => string | null };
    /** The project's checkouts a pin may name. */
    readonly checkouts?: () => readonly Checkout[];
  },
): RefResolver {
  const knows = (kind: RecordKind, id: string): boolean => {
    switch (kind) {
      case 'statement':
        return getStatement(store, id) !== null;
      case 'claim':
        return getClaim(store, id) !== null;
      case 'entity':
        return getEntity(store, id) !== null;
      case 'decision':
        return getDecision(store, id) !== null;
      case 'run':
        return getRun(store, id) !== null;
      case 'work':
        return getWork(store, id) !== null;
      case 'drift':
        return getDriftFinding(store, id) !== null;
    }
  };
  const base: Omit<ResolverInput, 'root' | 'checkout'> = {
    sources: listSources(store, { status: 'active' }).map((s) => {
      const rec = currentManifestRecord(store, s.id);
      const overridden = override && override.sourceId === s.id;
      return {
        id: s.id,
        kind: s.kind,
        canRead: s.canRead,
        locator: s.locator,
        manifest: overridden ? override.manifest : (rec?.entries ?? null),
        provenance: overridden ? (override.provenance ?? rec?.provenance) : rec?.provenance,
        neverRead: !overridden && !s.lastSnapshotId,
      };
    }),
    // Only what the person confirmed on their own channel marks a document outdated.
    supersessions: outdatedTerms(listStatements(store, { kind: 'constraint', status: 'confirmed' }), (id) => sayingSo(store, id)),
    hostReads: options?.hostReads ?? 'require',
    deliverableIds: new Set(listLiveDeliverables(store).map((d) => d.id)),
    knows,
  };
  const at = (dir: string, head: () => string | null): RefResolver => {
    let commit: string | null | undefined;
    return createEvidenceResolver({
      ...base,
      root: dir,
      ...(options?.checkout ? { checkout: { commit: () => (commit === undefined ? (commit = head()) : commit) } } : {}),
    });
  };
  const here = options?.checkout?.root ?? root;
  const current = at(here, options?.checkout?.head ?? (() => null));
  const elsewhere = new Map<string, RefResolver | null>();
  // Only a checkout of this project is consulted for a pin; a path a receipt names that is not one resolves nothing.
  const checkoutAt = (named: string): RefResolver | null => {
    const key = canonical(named);
    if (key === canonical(here)) return null;
    if (!elsewhere.has(key)) {
      const listed = options?.checkouts?.().find((c) => canonical(c.root) === key);
      const known = listed ?? (canonical(root) === key ? { root, head: null } : undefined);
      elsewhere.set(key, known ? at(known.root, () => known.head) : null);
    }
    return elsewhere.get(key)!;
  };
  return (ref, use, pin) => {
    const hit = resolveHere(ref, use);
    if (!pin || textDigest(hit?.text) === pin.digest || !pin.checkout) return hit;
    const there = checkoutAt(pin.checkout)?.(ref, use);
    return there?.kind === 'file' && textDigest(there.text) === pin.digest ? there : hit;
  };
  function resolveHere(ref: string, use?: 'artifact'): ReturnType<RefResolver> {
    if (use === 'artifact') return current(ref, use);
    const raw = ref.trim();
    const match = /^snapshot:([^:]+):(.+)$/.exec(raw);
    if (!match) {
      const hit = current(ref);
      if (hit?.kind !== 'record') return hit;
      const colon = raw.indexOf(':');
      const id = raw.slice(colon + 1);
      if (raw.startsWith('statement:')) {
        const s = getStatement(store, id);
        if (s)
          return {
            ...hit,
            text: s.text,
            recordStatus: s.status,
            recordOrigin: s.provenance,
            ...(s.supersededBy ? { supersededBy: `statement:${s.supersededBy}` } : {}),
          };
      }
      if (raw.startsWith('decision:')) {
        const d = getDecision(store, id);
        if (d)
          return {
            ...hit,
            text: `${d.question}\n${JSON.stringify(d.resolution)}`,
            recordStatus: d.state,
            recordOrigin: d.channel ?? 'unrecorded',
          };
      }
      return hit;
    }
    let snapshotId: string, itemRef: string;
    try {
      snapshotId = decodeURIComponent(match[1]!);
      itemRef = decodeURIComponent(match[2]!);
    } catch {
      return null;
    }
    const captured = snapshotManifestRecord(store, snapshotId);
    const source = captured ? getSource(store, captured.sourceId) : null;
    // Historical citations do not resurrect withdrawn access.
    if (!captured || !source?.canRead || source.status !== 'active') return null;
    const entry = captured.entries.find((e) => e.ref === itemRef);
    if (
      !entry ||
      typeof entry.text !== 'string' ||
      urlCarriesCredentials(entry.ref) ||
      (entry.url !== undefined && urlCarriesCredentials(entry.url))
    )
      return null;
    return {
      ref,
      kind: 'item',
      sourceId: source.id,
      itemRef,
      snapshotId,
      contentDigest: entry.fingerprint,
      historical: source.lastSnapshotId !== snapshotId,
      provenance: captured.provenance,
      text: entry.text,
      ...(entry.url ? { url: entry.url } : {}),
      ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      ...(entry.truncated ? { truncated: true } : {}),
      ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}),
    };
  }
}
