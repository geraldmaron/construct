/**
 * hosts/ollama/embedder.ts — the host-layer implementation of kernel's
 * Embedder seam (construct-2jb.12), backed by a local ollama server.
 *
 * kernel/implication/similarity.ts defines `Embedder` as text-in, vector-out
 * and does no I/O of its own, on purpose: the kernel stays host-ignorant, the
 * same discipline escalate.ts holds for `DomainNamer`. This module is the
 * adapter that fulfills the seam — it is the only place in the codebase that
 * knows ollama's HTTP shape, mirroring the pattern already measured and
 * pinned in scripts/measure-decisions.mjs's --embeddings path.
 *
 * Configuration is injected (baseUrl, model, fetch), never read from env or
 * home — only kernel/paths.ts may do that. A caller wiring this into the CLI
 * decides where those values come from.
 */

import type { Domain } from '../../kernel/implication/domains.ts';
import { domainText } from '../../kernel/implication/similarity.ts';
import type { Embedder } from '../../kernel/implication/similarity.ts';

export interface OllamaEmbedderConfig {
  /** Default: http://127.0.0.1:11434, ollama's own default. */
  readonly baseUrl?: string;
  /** Default: nomic-embed-text — the model RESEARCH-DECISIONS.md §5.5 measures. */
  readonly model?: string;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'nomic-embed-text';

/**
 * Build an Embedder that calls ollama's /api/embeddings endpoint. Throws on
 * any non-OK response or malformed body — callers (escalate.ts's
 * candidateCatalog) treat a thrown embedder as "no shortlist this time",
 * never as a reason to fabricate one.
 */
export function createOllamaEmbedder(config: OllamaEmbedderConfig = {}): Embedder {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const model = config.model ?? DEFAULT_MODEL;
  const doFetch = config.fetchImpl ?? fetch;

  return async (text: string): Promise<readonly number[]> => {
    const res = await doFetch(`${baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`ollama ${res.status} — is ollama running with ${model} pulled?`);
    }
    const body = (await res.json()) as { embedding?: unknown };
    if (!Array.isArray(body.embedding)) {
      throw new Error('ollama /api/embeddings response had no "embedding" array');
    }
    return body.embedding as readonly number[];
  };
}

/**
 * Wrap an embedder so a catalog's domain vectors are computed once and
 * reused, instead of once per outcome. Domains change on catalog edits, not
 * per outcome (construct-2jb.12) — the cache key is domain TEXT
 * (kernel/implication/similarity.ts's domainText, the same representation
 * the measurement pins), so a caller that swaps catalogs invalidates itself
 * for free rather than needing an explicit bust.
 *
 * Outcome text is deliberately never cached here: outcomes are not expected
 * to repeat, and caching them would grow this map without bound over a long
 * process lifetime for no measured benefit.
 */
export function withDomainCache(embedder: Embedder, catalog: readonly Domain[]): Embedder {
  const domainTexts = new Set(catalog.map(domainText));
  const cache = new Map<string, readonly number[]>();
  return async (text: string): Promise<readonly number[]> => {
    if (!domainTexts.has(text)) return embedder(text);
    const cached = cache.get(text);
    if (cached) return cached;
    const vec = await embedder(text);
    cache.set(text, vec);
    return vec;
  };
}
