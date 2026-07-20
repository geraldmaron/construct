/**
 * lib/oracle/invariants/external-write-has-idempotency-and-reconciliation.mjs — Layer 1
 * deterministic invariant: each known external-write producer must retain the
 * idempotent-persistence and (where applicable) claim-reconciliation pattern its own
 * fault-injection tests were built to protect, or a regression in a durable-state file
 * silently reopens a data-corruption/duplicate-write race under concurrent writers.
 *
 * Per the oracle-miss-report's rows 18-22 (broker error-type swallow, sent-log silent
 * swallow, approval-queue non-atomic + dedup gap, no execution leases): "no producer
 * instruments concurrent-write races... external-write-has-idempotency-and-
 * reconciliation invariant" (deterministic, Layer 1, "once built"). This repo's own git
 * history shows the underlying producers were already fixed, each with a fault-injection
 * test: `lib/writes/sent-log.mjs`'s `#persist()` writes via temp-file-then-rename and
 * surfaces I/O errors instead of swallowing them; `lib/embed/approval-queue.mjs`'s
 * `#persist()` uses the same temp-file-then-rename pattern, `enqueue()` reloads from disk
 * before its dedup check (closing the cross-process duplicate-enqueue race), and
 * `acquireLease`/`heartbeatLease`/`releaseLease`/`reclaimExpiredLeases` give the queue
 * lease-based reconciliation for the execution-lease gap. What did not exist before this
 * invariant is a standing, mechanical guarantee that those patterns stay in the source —
 * a future refactor of either file could drop `renameSync` or a lease method with
 * nothing catching it until a real concurrent-write incident. `lib/writes/**` and
 * `lib/embed/**` are this repo's owned-by-another-lane boundary this wave, so the check
 * is read-only source inspection, matching how `analysis-success-requires-execution-
 * evidence.mjs` treats the same boundary.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const id = 'external-write-has-idempotency-and-reconciliation';
export const layer = 1;
export const description =
  'Each known external-write producer must retain its idempotent-persistence (temp-file-then-rename) and, where applicable, claim-reconciliation (lease) pattern.';

const CAPABILITY_CHECKS = {
  'idempotent-persist': {
    label: 'idempotent temp-file-then-rename persistence',
    test: (source) => /renameSync/.test(source) && /\.tmp/.test(source),
  },
  'dedup-reload': {
    label: 'reload-from-disk before dedup check',
    test: (source) => /reload/i.test(source) && /dedup/i.test(source),
  },
  'lease-reconciliation': {
    label: 'lease acquire/heartbeat/release/reclaim reconciliation',
    test: (source) =>
      ['acquireLease', 'heartbeatLease', 'releaseLease', 'reclaimExpiredLeases'].every((name) => source.includes(name)),
  },
};

export const EXTERNAL_WRITE_PRODUCERS = [
  { id: 'sent-log', file: 'lib/writes/sent-log.mjs', requires: ['idempotent-persist'] },
  {
    id: 'approval-queue',
    file: 'lib/embed/approval-queue.mjs',
    requires: ['idempotent-persist', 'dedup-reload', 'lease-reconciliation'],
  },
];

/**
 * @param {{cwd?: string, producers?: typeof EXTERNAL_WRITE_PRODUCERS}} [opts]
 */
export async function check({ cwd = process.cwd(), producers = EXTERNAL_WRITE_PRODUCERS } = {}) {
  const results = [];

  for (const producer of producers) {
    const filePath = path.join(cwd, producer.file);
    let source;
    try {
      source = readFileSync(filePath, 'utf8');
    } catch (err) {
      results.push({
        producer: producer.id,
        file: producer.file,
        status: 'collection-error',
        detail: `failed to read ${producer.file}: ${err.message || err}`,
      });
      continue;
    }

    for (const capability of producer.requires) {
      const capabilityCheck = CAPABILITY_CHECKS[capability];
      const present = capabilityCheck.test(source);
      results.push({
        producer: producer.id,
        file: producer.file,
        capability,
        status: present ? 'passed' : 'failed',
        violation: !present,
        detail: present
          ? `${producer.file} retains ${capabilityCheck.label}`
          : `${producer.file} is missing ${capabilityCheck.label} — the fault-injection/concurrency test that protects this producer no longer has a matching implementation to guard`,
      });
    }
  }

  const violations = results.filter((r) => r.status === 'failed');
  const collectionErrors = results.filter((r) => r.status === 'collection-error');
  let status = 'passed';
  if (violations.length > 0) status = 'failed';
  else if (collectionErrors.length > 0) status = 'collection-error';

  return { status, evaluated: results.length, violations, unresolved: [], results };
}
