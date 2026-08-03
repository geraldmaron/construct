/**
 * kernel/store/reconcile.ts — the store-aware half of reconciliation: read the
 * persisted projections, fold them against a live tracker snapshot, and write
 * back only what the field-authority rule permits.
 *
 * This is where field authority earns its keep. The pure logic in
 * kernel/tracker/reconcile.ts can say a domain-owned field is in conflict, but
 * only a persisted round trip proves nothing overwrote it — which is why the
 * predecessor's reconcile could not be ported until this substrate existed.
 *
 * The whole sync is one transaction. A crash partway through must not leave half
 * the mirror adopting tracker values and half not; that state is
 * indistinguishable from real drift and would be reported as such on the next
 * run.
 */

import { listProjections, putProjection } from './projections.ts';
import { transact } from './open.ts';
import type { Store } from './open.ts';
import { applyReconciliation, reconcileAll, reconcileProjection } from '../tracker/reconcile.ts';
import type { DriftReport } from '../tracker/reconcile.ts';

export interface SyncOptions {
  readonly tracker?: string;
  readonly domainRecords?: Record<string, Record<string, unknown>>;
}

/**
 * Reconcile every persisted projection against `liveIssues` and persist the
 * result. Returns the drift report.
 *
 * Absorbed tracker-owned changes are adopted into the stored snapshot.
 * Domain-owned conflicts mark the projection `drifted` and are reported; the
 * stored domain value is left exactly as it was. A projection whose issue is
 * absent from the snapshot is reported missing and is NOT deleted — a tracker
 * deletion does not delete domain work.
 */
export function syncProjections(
  store: Store,
  liveIssues: readonly Record<string, unknown>[],
  reconciledAt: string,
  options: SyncOptions = {},
): DriftReport {
  return transact(store, () => {
    const projections = listProjections(store, options.tracker);
    const report = reconcileAll(projections, liveIssues, reconciledAt, {
      domainRecords: options.domainRecords,
    });

    const liveById = new Map<string, Record<string, unknown>>();
    for (const issue of liveIssues ?? []) {
      if (issue && typeof issue.id === 'string') liveById.set(issue.id, issue);
    }
    const missingIds = new Set(report.missing.map((entry) => entry.external_id));

    for (const projection of projections) {
      if (missingIds.has(projection.external_id)) {
        putProjection(store, { ...projection, state: 'drifted', reconciledAt });
        continue;
      }
      const liveIssue = liveById.get(projection.external_id) ?? null;
      const result = reconcileProjection(projection, liveIssue, {
        domainRecord: options.domainRecords?.[projection.external_id] ?? null,
      });
      putProjection(store, applyReconciliation(projection, liveIssue, result, reconciledAt));
    }

    return report;
  });
}
