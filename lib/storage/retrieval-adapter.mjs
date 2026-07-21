/**
 * lib/storage/retrieval-adapter.mjs — Retrieval-adapter contract + selector.
 *
 * Directive §13 requires core to run with no required vector database
 * (disposition-matrix.md D6s, "replace"). This module is the seam: it defines
 * the interface every memory/knowledge storage backend implements and selects
 * the active implementation at runtime — the LanceDB adapter
 * (lib/storage/vector-client.mjs, semantic/vector search via @lancedb/lancedb
 * + apache-arrow, both optionalDependencies as of this module) when reachable,
 * or the dependency-free keyword/BM25 adapter
 * (lib/storage/adapters/keyword-adapter.mjs) otherwise. LanceDB is one
 * adapter among possible others, never a hard core dependency.
 *
 * RetrievalAdapter contract (duck-typed, both adapters implement all of it):
 *   isHealthy(): Promise<boolean>
 *   hasObservationsTable(): Promise<boolean>
 *   storeObservation(record): Promise<{ mode: string, id: string }>
 *   getObservationFingerprints(ids: string[]): Promise<Map<string, {contentHash, model}>>
 *   pruneObservations({maxAgeDays?, maxRows?}): Promise<{evictedCount, remainingCount, oldestRetainedAt}>
 *   searchObservations({project?, query?, queryEmbedding?, limit?, minSimilarity?, role?, category?}): Promise<Array>
 *   storeDocument(record): Promise<{ mode: string, id: string }>
 *   searchDocuments({project?, query?, queryEmbedding?, limit?, minSimilarity?}): Promise<Array>
 *   close(): Promise<void>
 *
 * `query` (raw text) and `queryEmbedding` (pre-computed vector) are both
 * accepted by every search method so callers never branch on which backend is
 * active: the LanceDB adapter uses `queryEmbedding` and ignores `query`; the
 * keyword adapter uses `query` and ignores `queryEmbedding`.
 *
 * Selection order (resolveAdapterMode):
 *   1. CONSTRUCT_RETRIEVAL_ADAPTER=keyword forces the no-vector fallback.
 *   2. CONSTRUCT_RETRIEVAL_ADAPTER=lancedb forces LanceDB — a load or health
 *      failure surfaces as a thrown error rather than a silent downgrade,
 *      because an operator who pinned the adapter wants a loud failure.
 *   3. Unset / 'auto' (default): try LanceDB; any load or health failure
 *      (package absent, native binding mismatch, corrupted store) falls back
 *      to keyword, with one stderr notice per process so the degradation is
 *      never silent.
 */

let autoFallbackWarned = false;

const KNOWN_MODES = new Set(['lancedb', 'keyword', 'auto']);

/**
 * Resolve which adapter mode the environment requests. Pure — no I/O, no
 * module loading — so callers that only need to branch on the requested mode
 * (not construct an adapter) never trigger a LanceDB load attempt.
 */
export function resolveAdapterMode(env = process.env) {
  const raw = String(env?.CONSTRUCT_RETRIEVAL_ADAPTER || 'auto').toLowerCase().trim();
  if (!KNOWN_MODES.has(raw)) {
    throw new Error(
      `CONSTRUCT_RETRIEVAL_ADAPTER='${raw}' is not a known retrieval adapter (lancedb|keyword|auto).`
    );
  }
  return raw;
}

/**
 * Construct the active retrieval adapter for `rootDir`. Async because 'auto'
 * mode may need to attempt a real LanceDB connection (module load + open) to
 * decide whether it is reachable.
 *
 * @param {{ env?: object, rootDir?: string }} [opts]
 * @returns {Promise<import('./vector-client.mjs').VectorClient | import('./adapters/keyword-adapter.mjs').KeywordRetrievalAdapter>}
 */
export async function createRetrievalAdapter({ env = process.env, rootDir = process.cwd() } = {}) {
  const mode = resolveAdapterMode(env);

  if (mode === 'keyword') {
    const { KeywordRetrievalAdapter } = await import('./adapters/keyword-adapter.mjs');
    return new KeywordRetrievalAdapter({ env, rootDir });
  }

  const { VectorClient } = await import('./vector-client.mjs');
  const lancedb = new VectorClient({ env });

  if (mode === 'lancedb') return lancedb;

  // auto: LanceDB is preferred when reachable; any failure falls back.

  const healthy = await lancedb.isHealthy().catch(() => false);
  if (healthy) return lancedb;

  if (!autoFallbackWarned) {
    autoFallbackWarned = true;
    process.stderr.write(
      '[construct] LanceDB retrieval adapter unavailable; falling back to the ' +
      'dependency-free keyword/BM25 adapter. Set CONSTRUCT_RETRIEVAL_ADAPTER=lancedb ' +
      'to require LanceDB explicitly instead of degrading.\n'
    );
  }
  const { KeywordRetrievalAdapter } = await import('./adapters/keyword-adapter.mjs');
  return new KeywordRetrievalAdapter({ env, rootDir });
}

/**
 * Test-only escape hatch: reset the one-per-process fallback-notice latch so
 * a test asserting on the stderr notice doesn't depend on suite run order.
 */
export function _resetAutoFallbackWarningForTests() {
  autoFallbackWarned = false;
}
