/**
 * kernel/drift/deliverables.ts — a source changed; which finished work drew
 * on what changed, and who has to say what happens next.
 *
 * A deliverable cites what its steps read. When a later refresh shows one of
 * those items modified or removed, the deliverable may no longer hold, and
 * that is a finding. When a source the deliverable drew on gains new items,
 * the deliverable may be missing material, which is a weaker finding. Nothing
 * is rewritten; the person decides whether to revise, re-run, or dismiss,
 * and the question waits in their inbox so a finding is never only a row
 * someone has to go looking for.
 */

export const STALE_OPTIONS = ['revise', 're-run', 'dismiss'] as const;

import type { StateStore } from '../state/open.ts';
import { listLiveDeliverables, type Deliverable } from '../state/deliverables.ts';
import { listSteps } from '../state/steps.ts';
import { addDriftFinding, listDriftFindings, type DriftFinding } from '../state/drift.ts';
import { raiseDecision } from '../state/decisions.ts';
import { stripLocator, type RefResolver } from '../project/evidence.ts';
import { getSource } from '../state/sources.ts';
import { join as joinPath, resolve as resolvePath } from 'node:path';
import type { ItemChanges } from '../source/manifest.ts';

function refsOf(store: StateStore, d: Deliverable): string[] {
  const refs = new Set<string>();
  const take = (v: unknown) => {
    const ev = (v as { evidence?: unknown } | null)?.evidence;
    if (Array.isArray(ev)) for (const e of ev) if (e && typeof (e as { ref?: unknown }).ref === 'string') refs.add((e as { ref: string }).ref);
  };
  take(d.body);
  for (const step of listSteps(store, d.runId)) if (step.state === 'succeeded') take(step.output);
  return [...refs];
}

export function flagStaleDeliverables(
  store: StateStore,
  input: { readonly sourceId: string; readonly changes: ItemChanges; readonly resolve: RefResolver; readonly at: string; readonly nextId: () => string; readonly root?: string },
): DriftFinding[] {
  const { sourceId, changes, resolve, at } = input;
  const touched = new Set([...changes.modified, ...changes.removed]);
  if (touched.size === 0 && changes.added.length === 0) return [];
  const open = listDriftFindings(store, { status: 'open' });
  const source = getSource(store, sourceId);
  const dirAbs = source?.kind === 'directory' && source.locator ? resolvePath(input.root ?? '', source.locator) : null;
  const out: DriftFinding[] = [];
  const addedOnly: DriftFinding[] = [];
  // One run can leave a challenged draft and then its final deliverable; only the latest speaks for the run.
  const latest = new Map<string, Deliverable>();
  for (const d of listLiveDeliverables(store)) latest.set(d.runId, d);
  for (const d of latest.values()) {
    const inSource: string[] = [];
    const hit: string[] = [];
    for (const ref of refsOf(store, d)) {
      const r = resolve(ref);
      if (r?.kind === 'source' && r.sourceId === sourceId) inSource.push(ref);
      if (r?.sourceId !== sourceId || !r.itemRef) continue;
      inSource.push(ref);
      if (touched.has(r.itemRef)) hit.push(r.itemRef);
    }
    // A removed item no longer resolves, so match it to this source explicitly: by "<source>:<item>", by a path
    // that lands on the item inside this directory source, or by a bare key from a non-directory source.
    for (const ref of refsOf(store, d)) {
      const bare = stripLocator(ref);
      for (const gone of changes.removed) {
        const viaSource = bare === `${sourceId}:${gone}` || bare === `source:${sourceId}:${gone}`;
        const viaPath = source?.kind === 'directory' && dirAbs !== null && resolvePath(input.root ?? '', bare.replace(/^file:/, '')) === joinPath(dirAbs, gone);
        const viaKey = source !== null && source.kind !== 'directory' && bare === gone;
        if (viaSource || viaPath || viaKey) hit.push(gone);
      }
    }
    const uniqueHit = [...new Set(hit)];
    let summary: string | null = null;
    let confidence = 0;
    if (uniqueHit.length > 0) {
      summary = `${d.id} cites ${uniqueHit.join(', ')} in ${sourceId}, which changed after it was produced`;
      confidence = 0.9;
    } else if (changes.added.length > 0 && inSource.length > 0) {
      summary = `${sourceId}, which ${d.id} drew on, gained ${changes.added.join(', ')} after it was produced`;
      confidence = 0.6;
    }
    if (!summary) continue;
    if (open.some((f) => f.summary === summary)) continue;
    const finding = addDriftFinding(store, {
        id: `drift-${input.nextId()}`,
        runId: d.runId,
        kind: 'stale_dependent_claims',
        summary,
        evidence: [{ ref: `source:${sourceId}`, note: `changed at ${at}` }, ...[...uniqueHit, ...changes.added].slice(0, 10).map((ref) => ({ ref: `${sourceId}:${ref}`, note: changes.added.includes(ref) ? 'added' : changes.removed.includes(ref) ? 'removed' : 'modified' }))],
        affected: [d.id],
        confidence,
        repairPath: 'review the changed material against the deliverable; revise or re-run it, or dismiss the finding if it does not bear',
        at,
      });
    if (uniqueHit.length > 0) {
      // Something it cited changed: that is worth asking about, deliverable by deliverable.
      raiseDecision(store, {
        id: `q-${input.nextId()}`,
        kind: 'decision',
        question: `${summary}. Revise it, re-run it, or dismiss this?`,
        options: [...STALE_OPTIONS],
        subject: { driftFindingIds: [finding.id], deliverableIds: [d.id] },
        at,
      });
    } else {
      addedOnly.push(finding);
    }
    out.push(finding);
  }
  if (addedOnly.length > 0) {
    // New material only: one question for the whole refresh, so a busy folder does not flood the inbox.
    raiseDecision(store, {
      id: `q-${input.nextId()}`,
      kind: 'decision',
      question: `${sourceId} gained ${changes.added.slice(0, 5).join(', ')}${changes.added.length > 5 ? ` (+${String(changes.added.length - 5)} more)` : ''}; ${String(addedOnly.length)} finished deliverable(s) drew on ${sourceId} before that (${addedOnly.map((f) => f.affected[0]).join(', ')}). Revise or re-run them, or dismiss?`,
      options: [...STALE_OPTIONS],
      subject: { driftFindingIds: addedOnly.map((f) => f.id), deliverableIds: addedOnly.map((f) => f.affected[0]) },
      at,
    });
  }
  return out;
}
