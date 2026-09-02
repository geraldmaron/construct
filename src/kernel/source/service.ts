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
import { locatorProblem } from './locators.ts';
import type { ReadOutcome, SourceReader } from './connector.ts';

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
}

export interface SourceService {
  /** Reconcile committed declarations into state. Local sources are untouched. */
  syncDeclarations(file: SourcesFile, at: string): SyncResult;
  /** Add a source only this checkout knows about; its locator never reaches a committed file. */
  addLocal(input: Omit<DeclaredSource, 'read' | 'write'> & { readonly read?: boolean; readonly write?: boolean }, at: string): Source;
  setLocalLocator(id: string, locator: string, at: string): Source;
  refresh(id: string, at: string, nextId: () => string): Promise<RefreshResult>;
  status(id: string, at: string): SourceStatus;
  list(): Source[];
  summary(at: string): SourceSummary;
}

export interface SourceServiceDeps {
  /** Reader per source kind; a kind with no reader is unreachable from Construct itself. */
  readonly readers: ReadonlyMap<string, SourceReader>;
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

  return {
    syncDeclarations(file, at) {
      return store.transaction(() => {
        const added: string[] = [];
        const updated: string[] = [];
        const retired: string[] = [];
        const declaredIds = new Set(file.sources.map((s) => s.id));
        for (const d of file.sources) {
          const existing = getSource(store, d.id);
          if (existing && existing.origin === 'local') {
            throw new Error(`source ${d.id} exists locally; remove the local one before declaring it in the committed file`);
          }
          if (existing && existing.status === 'retired') {
            throw new Error(`source ${d.id} was retired; declare it under a new id`);
          }
          const result = declare(d, at, existing);
          if (result === 'added') added.push(d.id);
          if (result === 'updated') updated.push(d.id);
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
          outcome = await reader({ sourceId: source.id, kind: source.kind, locator: source.locator });
        } catch (error) {
          outcome = { outcome: 'unreachable', reason: (error as Error).message };
        }
      }
      if (outcome.outcome === 'unreachable') {
        setReachability(store, id, 'unreachable', at);
        recordObservation(store, { id: nextId(), sourceId: id, kind: 'source.unreachable', summary: outcome.reason, at });
        return { sourceId: id, outcome: 'unreachable', snapshot: null, reason: outcome.reason };
      }
      const { snapshot, changed } = recordSnapshot(store, {
        id: nextId(),
        sourceId: id,
        digest: outcome.report.digest,
        summary: outcome.report.summary,
        evidenceRef: outcome.report.evidenceRef,
        at,
      });
      if (changed) {
        recordObservation(store, {
          id: nextId(),
          sourceId: id,
          kind: 'source.changed',
          summary: `${id} changed: ${outcome.report.summary}`,
          evidence: { digest: outcome.report.digest, evidence: outcome.report.evidence, items: outcome.report.items?.length ?? 0 },
          at,
        });
      }
      return { sourceId: id, outcome: changed ? 'changed' : 'unchanged', snapshot };
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
