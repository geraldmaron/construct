/**
 * kernel/store/escalations.ts — the store-backed EscalationCache
 * (construct-2fu).
 *
 * escalate.ts declares `EscalationCache` as an interface rather than reaching
 * for a Map for exactly this reason: escalation costs a model call, and a
 * per-process Map would re-pay that cost on every invocation of a CLI that
 * exits between outcomes. Backing it with the store makes "the same outcome
 * does not pay twice" true across processes, which is the only place it was
 * ever going to matter.
 *
 * Two properties this module holds, both inherited from the rest of the store:
 *
 *   - Write-once. `escalation_cache` has an update trigger, and writes go
 *     through INSERT OR IGNORE. This is not append-only history — there is one
 *     row per outcome — but it is not editable either, and for the same reason
 *     the work log is not: an escalated implication cites the model's stated
 *     reason as its evidence, and evidence that can be quietly rewritten after
 *     the fact is not evidence.
 *   - The kernel never reads the clock. `recordedAt` is supplied by the caller,
 *     like every other timestamp under kernel/store.
 *
 * A cached MISS is cached too — an outcome the namer could name nothing for
 * stores an empty implication list. Skipping that would make the expensive
 * failure the one case that re-pays on every run.
 */

import type { Implication } from '../implication/map.ts';
import type { EscalationCache } from '../implication/escalate.ts';
import type { Store } from './open.ts';

export interface EscalationRecord {
  readonly outcome: string;
  readonly implications: readonly Implication[];
  /** Which host was consulted, so a cached answer names its source. */
  readonly host: string;
  readonly recordedAt: string;
}

interface Row {
  readonly outcome: string;
  readonly implications: string;
  readonly host: string;
  readonly recorded_at: string;
}

/**
 * A row whose JSON will not parse, or does not hold an array, is treated as a
 * cache miss rather than an error. A corrupt cache entry should cost one
 * re-escalation, never fail the run that read it.
 */
function parseImplications(json: string): readonly Implication[] | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as readonly Implication[]) : undefined;
  } catch {
    return undefined;
  }
}

/** What was cached for this exact outcome, with its provenance. */
export function readEscalation(store: Store, outcome: string): EscalationRecord | undefined {
  const row = store.db
    .prepare('SELECT * FROM escalation_cache WHERE outcome = ?')
    .get(outcome) as unknown as Row | undefined;
  if (!row) return undefined;
  const implications = parseImplications(row.implications);
  if (!implications) return undefined;
  return {
    outcome: row.outcome,
    implications,
    host: row.host,
    recordedAt: row.recorded_at,
  };
}

/**
 * Record what a host said for an outcome. Returns false when a row was already
 * present — the first answer stands, and a second escalation of the same
 * outcome does not overwrite the reason the first one cited.
 */
export function writeEscalation(store: Store, record: EscalationRecord): boolean {
  const result = store.db
    .prepare(
      `INSERT OR IGNORE INTO escalation_cache (outcome, implications, host, recorded_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      record.outcome,
      JSON.stringify(record.implications),
      record.host,
      record.recordedAt,
    );
  return Number(result.changes) > 0;
}

/**
 * Adapt the store to escalate.ts's `EscalationCache`. The host name and clock
 * are bound here because the interface's `set` carries neither — the kernel's
 * escalation path knows what it inferred, not who it asked or when.
 */
export function storeEscalationCache(
  store: Store,
  options: { readonly host: string; readonly at: string },
): EscalationCache {
  return {
    get: (outcome) => readEscalation(store, outcome)?.implications,
    set: (outcome, implications) => {
      writeEscalation(store, {
        outcome,
        implications,
        host: options.host,
        recordedAt: options.at,
      });
    },
  };
}
