/**
 * lib/providers/filter-audit.mjs — per-poll provider filter audit log.
 *
 * ADR-0060 requires every poll to record, per source, the filter that was
 * enforced and how many items it dropped. Appends one JSONL line per source
 * per poll to `<rootDir>/.cx/providers/filter-audit.jsonl` with the
 * acceptance-criteria field names `{provider, instance, filterHash, matched,
 * dropped}`, plus the ADR's own `fetched`/`admitted` and `pushdown` fields
 * for the fuller audit shape. Rotation uses `appendWithRotationSync`
 * directly (not the shared `appendBounded` channel registry) to keep this
 * change scoped to `lib/providers/*`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appendWithRotationSync } from '../logging/rotate.mjs';

const AUDIT_SUBDIR = ['.cx', 'providers'];
const AUDIT_FILE = 'filter-audit.jsonl';

// 10 MB per shard, 5 shards kept — a filter-audit line is written once per
// source per poll, so this comfortably covers years of daemon uptime.

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENTS = 5;

export function filterAuditPath(rootDir) {
  return join(rootDir, ...AUDIT_SUBDIR, AUDIT_FILE);
}

/**
 * Append one filter-audit record. `matched`/`dropped` are the
 * acceptance-criteria field names; `fetched`/`admitted` mirror the ADR-0060
 * audit shape (`admitted` === `matched`) so both vocabularies are queryable
 * from the same line without a reader needing to know which one shipped.
 */
export function recordFilterAudit(rootDir, {
  provider,
  instance = null,
  filterHash: hash = null,
  scope = null,
  predicates = null,
  nativeQuery = null,
  pushdown = false,
  fetched,
  matched,
}) {
  const record = {
    ts: new Date().toISOString(),
    provider,
    instance,
    filterHash: hash,
    filterApplied: { scope, predicates, nativeQuery, pushdown, fetched, admitted: matched },
    matched,
    dropped: fetched - matched,
  };
  appendWithRotationSync(filterAuditPath(rootDir), JSON.stringify(record) + '\n', {
    maxBytes: MAX_BYTES,
    maxSegments: MAX_SEGMENTS,
  });
  return record;
}

export function readFilterAudit(rootDir) {
  const path = filterAuditPath(rootDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
