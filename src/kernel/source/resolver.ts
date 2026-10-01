/**
 * kernel/source/resolver.ts — the evidence resolver for a project as it
 * stands: its root, its active sources and their manifests, its deliverables,
 * and the records Construct keeps. One place, so the broker and the source
 * service resolve a reference the same way.
 */

import type { StateStore } from '../state/open.ts';
import { listSources } from '../state/sources.ts';
import { listLiveDeliverables } from '../state/deliverables.ts';
import { getStatement } from '../state/profile.ts';
import { getClaim, getEntity } from '../state/graph.ts';
import { getDecision } from '../state/decisions.ts';
import { getRun } from '../state/runs.ts';
import { getDriftFinding } from '../state/drift.ts';
import { createEvidenceResolver, type RecordKind, type RefResolver } from '../project/evidence.ts';
import { currentManifest, type ManifestEntry } from './manifest.ts';

export function projectResolver(store: StateStore, root: string, override?: { readonly sourceId: string; readonly manifest: readonly ManifestEntry[] | null }): RefResolver {
  const knows = (kind: RecordKind, id: string): boolean => {
    switch (kind) {
      case 'statement': return getStatement(store, id) !== null;
      case 'claim': return getClaim(store, id) !== null;
      case 'entity': return getEntity(store, id) !== null;
      case 'decision': return getDecision(store, id) !== null;
      case 'run': return getRun(store, id) !== null;
      case 'drift': return getDriftFinding(store, id) !== null;
    }
  };
  return createEvidenceResolver({
    root,
    sources: listSources(store, { status: 'active' }).map((s) => ({
      id: s.id,
      kind: s.kind,
      locator: s.locator,
      manifest: override && override.sourceId === s.id ? override.manifest : currentManifest(store, s.id),
    })),
    deliverableIds: new Set(listLiveDeliverables(store).map((d) => d.id)),
    knows,
  });
}
