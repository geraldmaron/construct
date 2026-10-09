/**
 * kernel/source/service.ts — one service for every source question.
 *
 * Syncs the committed declarations into state, refreshes through whatever
 * reader the caller injects (a host tool or a connector), and answers status
 * and freshness for one source or the whole set. Reading is the caller's;
 * recording is this module's.
 */

import type { StateStore } from '../state/open.ts';
import {
  addSource,
  clearAuthority,
  freshnessOf,
  getSource,
  latestSnapshot,
  listSources,
  recordSnapshot,
  retireSource,
  setAuthority,
  setReachability,
  updateSource,
  authorityOf,
  type Freshness,
  type Source,
  type SourceSnapshot,
} from '../state/sources.ts';
import { recordObservation } from '../state/drift.ts';
import type { DeclaredSource, SourcesFile } from '../project/sources-file.ts';
import { addEntity, addClaim, findEntityByRef } from '../state/graph.ts';
import { markPremisesStale } from '../work/service.ts';
import { locatorProblem } from './locators.ts';
import { createHash } from 'node:crypto';
import type { ReadOutcome, SnapshotReport, SourceReader } from './connector.ts';
import { currentManifest, describeChanges, diffManifests, toManifest, type ItemChanges } from './manifest.ts';
import { projectResolver } from './resolver.ts';
import { flagStaleDeliverables } from '../drift/deliverables.ts';
import { redact } from '../render/redact.ts';
import { urlProblem } from '../project/urls.ts';

export interface SourceStatus {
  readonly source: Source;
  readonly freshness: Freshness;
  readonly lastSnapshot: SourceSnapshot | null;
  readonly authoritativeFor: readonly string[];
  readonly notAuthoritativeFor: readonly string[];
}

export interface SourceSummary {
  readonly total: number;
  readonly reachable: number;
  readonly unreachable: number;
  readonly unknown: number;
  readonly fresh: number;
  readonly stale: number;
  readonly neverRead: number;
}

export interface SyncResult {
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly retired: readonly string[];
}

export interface RefreshResult {
  readonly sourceId: string;
  readonly outcome: 'changed' | 'unchanged' | 'unreachable';
  readonly snapshot: SourceSnapshot | null;
  readonly reason?: string;
  /** Item by item, when the reader reports items. */
  readonly changes?: ItemChanges;
  /** Drift findings opened because finished work drew on what changed. */
  readonly staleDeliverables?: readonly string[];
  /** Reported items whose kept text was cut at the cap, so a quote or figure past the cut cannot be checked. */
  readonly truncated?: readonly string[];
}

/** Text kept per reported item, enough to check quotes and figures against. */
export const REPORTED_TEXT_CAP = 16 * 1024;

export interface HostReportItem {
  readonly ref: string;
  readonly title?: string;
  readonly kind?: string;
  /** The system's own last-modified time, when it gives one. */
  readonly updatedAt?: string;
  /** What the host read; kept (credentials removed, capped) so excerpts and figures can be checked against it. */
  readonly text?: string;
  /** The http(s) address a person would open for this item; a citation of it means this item. */
  readonly url?: string;
  /** The host tool whose response carried this item, when a hook recorded it rather than the host reporting it. */
  readonly via?: string;
  readonly fingerprint?: string;
  /**
   * Seen in passing (a search hit, a link) rather than read as a version: it adds the item when it is new and
   * never counts as a change to one already recorded, because a thinner view of the same ticket is not an edit.
   */
  readonly weak?: boolean;
}

export interface HostReport {
  readonly items: readonly HostReportItem[];
  readonly partial?: boolean;
}

export interface SourceService {
  /**
   * Reconcile committed declarations into state. A local source is untouched unless the committed file declares
   * the same id with the same kind: then it becomes declared, takes the committed declaration, and keeps what was
   * read from it.
   */
  syncDeclarations(file: SourcesFile, at: string): SyncResult;
  /** Add a source only this checkout knows about; its locator never reaches a committed file. */
  addLocal(input: Omit<DeclaredSource, 'read' | 'write'> & { readonly read?: boolean; readonly write?: boolean }, at: string): Source;
  setLocalLocator(id: string, locator: string, at: string): Source;
  refresh(id: string, at: string, nextId: () => string): Promise<RefreshResult>;
  /**
   * Record what the host read from a source Construct has no reader for (a live tracker, a wiki), so changes
   * there are tracked like any other. A partial read updates only the items it names.
   */
  reportRead(id: string, report: HostReport, at: string, nextId: () => string): RefreshResult;
  /** Whether Construct can read this source itself, or only record what the host reports. */
  canRead(id: string): boolean;
  /** Read without recording: has the source moved since its last recorded read? Null when it cannot be read here. */
  peek(id: string): Promise<boolean | null>;
  status(id: string, at: string): SourceStatus;
  list(): Source[];
  summary(at: string): SourceSummary;
}

export interface SourceServiceDeps {
  /** Reader per source kind; a kind with no reader is unreachable from Construct itself. */
  readonly readers: ReadonlyMap<string, SourceReader>;
  /** The project root; with it, a change is checked against the deliverables that cited it. */
  readonly root?: string;
}

function sameAuthority(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
}

export function createSourceService(store: StateStore, deps: SourceServiceDeps): SourceService {
  function declare(d: DeclaredSource, at: string, existing: Source | null): 'added' | 'updated' | 'unchanged' {
    const problem = locatorProblem(d.kind, d.locator);
    if (problem) throw new Error(`source ${d.id}: ${problem}`);
    if (!existing) {
      addSource(store, {
        id: d.id,
        kind: d.kind,
        origin: 'declared',
        purpose: d.purpose,
        locator: d.locator ?? undefined,
        authorityLevel: d.authorityLevel,
        freshnessHours: d.freshnessHours ?? undefined,
        sensitivity: d.sensitivity,
        canRead: d.read,
        canWrite: d.write,
        authoritativeFor: d.authoritativeFor,
        notAuthoritativeFor: d.notAuthoritativeFor,
        at,
      });
      return 'added';
    }
    const authority = authorityOf(store, d.id);
    const same =
      existing.purpose === d.purpose &&
      (d.locator === null || existing.locator === d.locator) &&
      existing.authorityLevel === d.authorityLevel &&
      existing.freshnessHours === d.freshnessHours &&
      existing.sensitivity === d.sensitivity &&
      existing.canRead === d.read &&
      existing.canWrite === d.write &&
      sameAuthority(authority.authoritativeFor, d.authoritativeFor) &&
      sameAuthority(authority.notAuthoritativeFor, d.notAuthoritativeFor);
    if (same) return 'unchanged';
    updateSource(
      store,
      d.id,
      {
        purpose: d.purpose,
        ...(d.locator !== null ? { locator: d.locator } : {}),
        authorityLevel: d.authorityLevel,
        freshnessHours: d.freshnessHours,
        sensitivity: d.sensitivity,
        canRead: d.read,
        canWrite: d.write,
      },
      at,
    );
    clearAuthority(store, d.id);
    for (const t of d.authoritativeFor) setAuthority(store, d.id, t, true);
    for (const t of d.notAuthoritativeFor) setAuthority(store, d.id, t, false);
    return 'updated';
  }

  function recordRead(id: string, report: SnapshotReport, partial: boolean, at: string, nextId: () => string, notChanged: ReadonlySet<string> = new Set()): RefreshResult {
    const { snapshot, changed } = recordSnapshot(store, {
      id: nextId(),
      sourceId: id,
      digest: report.digest,
      summary: report.summary,
      evidenceRef: report.evidenceRef,
      inventoryDigest: report.inventoryDigest,
      contentDigest: report.contentDigest ?? report.digest,
      itemCount: report.items?.length ?? 0,
      coverage: report.coverage,
      at,
    });
    // What Construct read itself becomes observed claims, each with the content it saw; a host's report is its word.
    const source = getSource(store, id);
    if (source && report.evidence !== 'reported' && report.items && report.items.length > 0) {
      store.transaction(() => {
        for (const item of report.items ?? []) {
          const entity =
            findEntityByRef(store, 'artifact', item.externalRef) ??
            addEntity(store, { id: nextId(), kind: 'artifact', name: item.name, externalRef: item.externalRef, attributes: item.attributes, at });
          const attributes = item.attributes as { contentDigest?: unknown; fingerprint?: unknown } | undefined;
          addClaim(store, {
            id: nextId(),
            subjectId: entity.id,
            claimType: item.kind,
            statement: `${item.name} observed in ${id}`,
            value: item.attributes ?? item,
            sourceId: id,
            provenance: 'source',
            authority: source.authorityLevel,
            sensitivity: source.sensitivity,
            confidence: 1,
            observedAt: at,
            locator: item.externalRef,
            excerpt: item.name,
            sourceRevision: report.contentDigest ?? report.digest,
            contentDigest: typeof attributes?.contentDigest === 'string' ? attributes.contentDigest : typeof attributes?.fingerprint === 'string' ? attributes.fingerprint : report.contentDigest,
            at,
          });
        }
      });
    }
    let changes: ItemChanges | undefined;
    let staleDeliverables: string[] | undefined;
    if (changed) {
      const manifest = report.items ? toManifest(report.items) : null;
      const before = currentManifest(store, id);
      changes = manifest ? diffManifests(before, manifest) : undefined;
      // In a partial read, an item not reported is unknown, not removed.
      if (changes && partial) changes = { ...changes, removed: [] };
      if (changes && notChanged.size > 0) changes = { ...changes, modified: changes.modified.filter((r) => !notChanged.has(r)) };
      const firstRead = before === null;
      recordObservation(store, {
        id: nextId(),
        sourceId: id,
        kind: 'source.changed',
        summary: `${id} changed: ${report.summary}${changes && !firstRead ? ` (${describeChanges(changes)})` : ''}`,
        evidence: { digest: report.digest, evidence: report.evidence, items: report.items?.length ?? 0, contentDigest: report.contentDigest, inventoryDigest: report.inventoryDigest, ...(partial ? { partial: true } : {}), ...(manifest ? { manifest } : {}), ...(changes && !firstRead ? { changes } : {}) },
        at,
      });
      markPremisesStale(store, id, at);
      if (changes && !firstRead && deps.root) {
        // Which finished work drew on this source is a question of what it cited, not of the citation policy, so
        // a citation admitted on the host's word still counts as drawing on it.
        const resolve = projectResolver(store, deps.root, { sourceId: id, manifest, provenance: report.evidence }, { hostReads: 'accept' });
        staleDeliverables = flagStaleDeliverables(store, { sourceId: id, changes, resolve, at, nextId, root: deps.root, previous: before }).map((f) => f.id);
      }
    }
    return { sourceId: id, outcome: changed ? 'changed' : 'unchanged', snapshot, ...(changes ? { changes } : {}), ...(staleDeliverables ? { staleDeliverables } : {}) };
  }

  return {
    syncDeclarations(file, at) {
      return store.transaction(() => {
        const added: string[] = [];
        const updated: string[] = [];
        const retired: string[] = [];
        const declaredIds = new Set(file.sources.map((s) => s.id));
        for (const d of file.sources) {
          let existing = getSource(store, d.id);
          let committedLocal = false;
          if (existing && existing.origin === 'local' && existing.status === 'active') {
            if (existing.kind !== d.kind) {
              throw new Error(`source ${d.id} exists on this machine as a ${existing.kind} source; declare the ${d.kind} one under a new id`);
            }
            existing = updateSource(store, d.id, { origin: 'declared' }, at);
            committedLocal = true;
          }
          if (existing && existing.status === 'retired') {
            throw new Error(`source ${d.id} was retired; declare it under a new id`);
          }
          const result = declare(d, at, existing);
          if (result === 'added') added.push(d.id);
          // A local source the file now declares has changed origin, so it counts as updated even when nothing else differs.
          if (result === 'updated' || committedLocal) updated.push(d.id);
        }
        for (const s of listSources(store, { status: 'active' })) {
          if (s.origin === 'declared' && !declaredIds.has(s.id)) {
            retireSource(store, s.id, at);
            retired.push(s.id);
          }
        }
        return { added, updated, retired };
      });
    },
    addLocal(input, at) {
      const problem = locatorProblem(input.kind, input.locator);
      if (problem) throw new Error(`source ${input.id}: ${problem}`);
      return addSource(store, {
        id: input.id,
        kind: input.kind,
        origin: 'local',
        purpose: input.purpose,
        locator: input.locator ?? undefined,
        authorityLevel: input.authorityLevel,
        freshnessHours: input.freshnessHours ?? undefined,
        sensitivity: input.sensitivity,
        canRead: input.read ?? true,
        canWrite: input.write ?? false,
        authoritativeFor: input.authoritativeFor,
        notAuthoritativeFor: input.notAuthoritativeFor,
        at,
      });
    },
    setLocalLocator(id, locator, at) {
      const source = getSource(store, id);
      if (!source) throw new Error(`no source ${id}`);
      const problem = locatorProblem(source.kind, locator);
      if (problem) throw new Error(`source ${id}: ${problem}`);
      return updateSource(store, id, { locator }, at);
    },
    async refresh(id, at, nextId) {
      const source = getSource(store, id);
      if (!source) throw new Error(`no source ${id}`);
      if (source.status !== 'active') throw new Error(`source ${id} is retired`);
      const reader = deps.readers.get(source.kind);
      let outcome: ReadOutcome;
      if (!reader) {
        outcome = { outcome: 'unreachable', reason: `nothing in this session can read a ${source.kind} source; connect one through your host` };
      } else {
        try {
          outcome = await reader({ sourceId: source.id, kind: source.kind, locator: source.locator, previous: currentManifest(store, id) ?? undefined });
        } catch (error) {
          outcome = { outcome: 'unreachable', reason: (error as Error).message };
        }
      }
      if (outcome.outcome === 'unreachable') {
        setReachability(store, id, 'unreachable', at);
        recordObservation(store, { id: nextId(), sourceId: id, kind: 'source.unreachable', summary: outcome.reason, at });
        return { sourceId: id, outcome: 'unreachable', snapshot: null, reason: outcome.reason };
      }
      setReachability(store, id, 'reachable', at);
      return recordRead(id, outcome.report, false, at, nextId);
    },
    reportRead(id, report, at, nextId) {
      const source = getSource(store, id);
      if (!source) throw new Error(`no source ${id}`);
      if (source.status !== 'active') throw new Error(`source ${id} is retired`);
      if (deps.readers.has(source.kind)) throw new Error(`source ${id} is read by Construct itself; refresh it instead of reporting it`);
      const prior = new Map((currentManifest(store, id) ?? []).map((e) => [e.ref, e]));
      const contentHash = (ref: string, text: string | undefined, title: string | undefined) => createHash('sha256').update(text ?? `${ref}\t${title ?? ''}`).digest('hex');
      // Items whose fingerprint moves only because the basis did (an unversioned or passing sighting now read with a
      // version), not because the item changed; the read records them without calling them modified.
      const rebased = new Set<string>();
      const cut: string[] = [];
      const reported = report.items.flatMap((i) => {
        // Versions are judged on what the host read, so a fingerprint means the same thing whatever is kept.
        const text = i.text;
        const was = prior.get(i.ref);
        if (i.weak && was) return [];
        // Provider revisions and timestamps are claims about identity, not proof
        // that the observed bytes are unchanged. Include both in the fingerprint.
        const bodyHash = contentHash(i.ref, text, i.title);
        const fingerprint = i.updatedAt || i.fingerprint
          ? createHash('sha256').update(JSON.stringify([i.ref, i.fingerprint ?? null, i.updatedAt ?? null, bodyHash])).digest('hex')
          : bodyHash;
        if (was && !was.updatedAt && i.updatedAt && (was.weak || was.fingerprint === contentHash(i.ref, text, i.title))) rebased.add(i.ref);
        // What is kept is what was read with credentials removed, then capped; truncated says the cut happened. The cut
        // text is cleaned once more, so text kept from one report to the next reads the same when it is cleaned again.
        const clean = typeof i.text === 'string' ? redact(i.text) : undefined;
        const stored = clean === undefined ? undefined : redact(clean.slice(0, REPORTED_TEXT_CAP));
        // An identical content identity keeps any fuller text recorded before, and where it came
        // from. Partial sightings must be marked weak; length alone cannot prove they are unchanged. Text carried forward is kept without credentials too, whenever it was recorded.
        const wasText = was?.text !== undefined ? redact(was.text) : undefined;
        const keepWas = was !== undefined && was.fingerprint === fingerprint && (wasText?.length ?? 0) > (stored?.length ?? 0);
        const keptText = keepWas ? wasText : stored;
        const truncated = keepWas ? was.truncated === true : clean !== undefined && clean.length > REPORTED_TEXT_CAP;
        const via = keepWas ? was.via : i.via;
        if (i.url !== undefined) {
          const problem = urlProblem(i.url);
          if (problem) throw new Error(`item ${i.ref}: url ${problem}`);
        }
        const url = i.url?.trim() ?? was?.url;
        if (truncated) cut.push(i.ref);
        return [{ externalRef: i.ref, kind: i.kind ?? 'item', name: i.title !== undefined ? redact(i.title) : i.ref, attributes: { fingerprint, ...(keptText !== undefined ? { text: keptText } : {}), ...(url ? { url } : {}), ...(truncated ? { truncated: true } : {}), ...(via ? { via } : {}), ...(i.updatedAt ? { updatedAt: i.updatedAt } : {}), ...(i.weak ? { weak: true } : {}) } }];
      });
      // A partial read updates what it saw and keeps the rest; a complete read replaces the manifest.
      const before = report.partial ? [...prior.values()] : [];
      const seen = new Set(reported.map((r) => r.externalRef));
      const kept = before.filter((e) => !seen.has(e.ref)).map((e) => ({ externalRef: e.ref, kind: e.kind, name: e.ref, attributes: { fingerprint: e.fingerprint, ...(e.text !== undefined ? { text: redact(e.text) } : {}), ...(e.url ? { url: e.url } : {}), ...(e.truncated ? { truncated: true } : {}), ...(e.via ? { via: e.via } : {}), ...(e.updatedAt ? { updatedAt: e.updatedAt } : {}), ...(e.weak ? { weak: true } : {}) } }));
      const items = [...kept, ...reported].sort((a, b) => a.externalRef.localeCompare(b.externalRef));
      // The digest covers what was kept, not only versions, so fuller text or an address for the same version is
      // recorded; item changes are still judged by fingerprint, so that recording opens no drift.
      const digest = `sha256:${createHash('sha256').update(items.map((i) => { const a = i.attributes as { fingerprint: string; text?: string; url?: string }; return `${i.externalRef}\t${a.fingerprint}\t${createHash('sha256').update(a.text ?? '').digest('hex')}${a.url ? `\t${a.url}` : ''}`; }).join('\n')).digest('hex')}`;
      setReachability(store, id, 'reachable', at);
      const result = recordRead(id, { digest, summary: `${String(reported.length)} item(s) reported by the host${report.partial ? ' (partial read)' : ''}`, evidenceRef: `host:${id}`, evidence: 'reported', items }, report.partial === true, at, nextId, rebased);
      return cut.length > 0 ? { ...result, truncated: cut } : result;
    },
    canRead(id) {
      const source = getSource(store, id);
      return source !== null && deps.readers.has(source.kind);
    },
    async peek(id) {
      const source = getSource(store, id);
      const reader = source ? deps.readers.get(source.kind) : undefined;
      if (!source || !reader) return null;
      const last = latestSnapshot(store, id);
      if (!last) return null;
      try {
        const outcome = await reader({ sourceId: source.id, kind: source.kind, locator: source.locator, previous: currentManifest(store, id) ?? undefined });
        return outcome.outcome === 'read' ? outcome.report.digest !== last.digest : null;
      } catch {
        return null;
      }
    },
    status(id, at) {
      const source = getSource(store, id);
      if (!source) throw new Error(`no source ${id}`);
      const authority = authorityOf(store, id);
      return {
        source,
        freshness: freshnessOf(store, id, at),
        lastSnapshot: latestSnapshot(store, id),
        authoritativeFor: authority.authoritativeFor,
        notAuthoritativeFor: authority.notAuthoritativeFor,
      };
    },
    list() {
      return listSources(store, { status: 'active' });
    },
    summary(at) {
      const active = listSources(store, { status: 'active' });
      const summary = { total: active.length, reachable: 0, unreachable: 0, unknown: 0, fresh: 0, stale: 0, neverRead: 0 };
      for (const s of active) {
        summary[s.reachability] += 1;
        const f = freshnessOf(store, s.id, at);
        if (f === 'fresh' || f === 'no_expectation') summary.fresh += 1;
        else if (f === 'stale') summary.stale += 1;
        else summary.neverRead += 1;
      }
      return summary;
    },
  };
}
