import { getWork } from '../work/service.ts';
/**
 * kernel/source/resolver.ts — the evidence resolver for a project as it
 * stands: its root, its active sources and their manifests, its deliverables,
 * and the records Construct keeps. One place, so the broker and the source
 * service resolve a reference the same way.
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
import { createEvidenceResolver, type RecordKind, type RefResolver } from '../project/evidence.ts';
import { currentManifestRecord, snapshotManifestRecord, type ManifestEntry } from './manifest.ts';

/** The statement that says a document is no longer current, as the reader sees it: its kind and its words, cut to 160 characters. */
function sayingSo(store: StateStore, statementId: string): string | null {
  const s = getStatement(store, statementId);
  if (!s) return null;
  const text = s.text.replace(/\s+/g, ' ').trim();
  return `${s.kind} "${text.length > 160 ? `${text.slice(0, 159)}…` : text}"`;
}

export function projectResolver(store: StateStore, root: string, override?: { readonly sourceId: string; readonly manifest: readonly ManifestEntry[] | null; readonly provenance?: 'witnessed' | 'reported' } | null, options?: { readonly hostReads?: 'require' | 'accept' }): RefResolver {
  const knows = (kind: RecordKind, id: string): boolean => {
    switch (kind) {
      case 'statement': return getStatement(store, id) !== null;
      case 'claim': return getClaim(store, id) !== null;
      case 'entity': return getEntity(store, id) !== null;
      case 'decision': return getDecision(store, id) !== null;
      case 'run': return getRun(store, id) !== null;
      case 'work': return getWork(store, id) !== null;
      case 'drift': return getDriftFinding(store, id) !== null;
    }
  };
  const current = createEvidenceResolver({
    root,
    sources: listSources(store, { status: 'active' }).map((s) => {
      const rec = currentManifestRecord(store, s.id);
      const overridden = override && override.sourceId === s.id;
      return {
        id: s.id,
        kind: s.kind,
        canRead: s.canRead,
        locator: s.locator,
        manifest: overridden ? override.manifest : rec?.entries ?? null,
        provenance: overridden ? override.provenance ?? rec?.provenance : rec?.provenance,
        neverRead: !overridden && !s.lastSnapshotId,
      };
    }),
    // Only what the person confirmed on their own channel marks a document outdated.
    supersessions: outdatedTerms(listStatements(store, { kind: 'constraint', status: 'confirmed' }), (id) => sayingSo(store, id)),
    hostReads: options?.hostReads ?? 'require',
    deliverableIds: new Set(listLiveDeliverables(store).map((d) => d.id)),
    knows,
  });
  return (ref) => {
    const raw=ref.trim();
    const match = /^snapshot:([^:]+):(.+)$/.exec(raw);
    if (!match) {
      const hit = current(ref);
      if (hit?.kind !== 'record') return hit;
      const colon=raw.indexOf(':'); const id=raw.slice(colon+1);
      if (raw.startsWith('statement:')) {
        const s=getStatement(store,id);
        if (s) return {...hit,text:s.text,recordStatus:s.status,recordOrigin:s.provenance,...(s.supersededBy ? {supersededBy:`statement:${s.supersededBy}`} : {})};
      }
      if (raw.startsWith('decision:')) {
        const d=getDecision(store,id);
        if (d) return {...hit,text:`${d.question}\n${JSON.stringify(d.resolution)}`,recordStatus:d.state,recordOrigin:d.channel ?? 'unrecorded'};
      }
      return hit;
    }
    let snapshotId: string, itemRef: string;
    try { snapshotId = decodeURIComponent(match[1]!); itemRef = decodeURIComponent(match[2]!); } catch { return null; }
    const captured = snapshotManifestRecord(store, snapshotId);
    const source = captured ? getSource(store, captured.sourceId) : null;
    // Historical citations do not resurrect withdrawn access.
    if (!captured || !source?.canRead || source.status !== 'active') return null;
    const entry = captured.entries.find(e => e.ref === itemRef);
    if (!entry || typeof entry.text !== 'string') return null;
    return { ref, kind: 'item', sourceId: source.id, itemRef, snapshotId, contentDigest: entry.fingerprint,
      historical: source.lastSnapshotId !== snapshotId, provenance: captured.provenance, text: entry.text,
      ...(entry.url ? { url: entry.url } : {}), ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      ...(entry.truncated ? { truncated: true } : {}), ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}) };
  };
}
