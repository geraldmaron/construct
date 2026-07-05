/**
 * lib/doctor/embedding-health.mjs — doctor visibility for the active embedding model.
 *
 * `local` (lib/storage/embeddings-local.mjs, @huggingface/transformers) is the
 * embedding engine's DEFAULT_MODEL (lib/storage/embeddings-engine.mjs),
 * backing knowledge-search and evidence-ingest by default rather than a
 * rarely-used opt-in path. The adapter's runtime already degrades silently to
 * the 256d hashing adapter when the model fails to load (embeddings-local.mjs
 * catch block); doctor visibility surfaces that degradation before a
 * retrieval-quality drop goes unexplained (LMCP-K4), implementing the
 * healthCheck declared for @huggingface/transformers in deps/intent.json:
 * "require this package — absent means local embedding unavailable; hashing
 * fallback activates automatically." A module-resolution import is the probe
 * rather than invoking the ONNX pipeline, since presence/absence — not model
 * inference — is the doctor-relevant signal.
 */
import { getEmbeddingModelInfo } from '../storage/embeddings-engine.mjs';

/**
 * checkEmbeddingModelForDoctor(opts) — the active embedding model's doctor-shaped finding.
 *
 * Non-`local` models (openai, ollama, hashing) report their configuration as-is;
 * only `local` depends on the optional @huggingface/transformers package, so
 * only that path probes for it.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] injectable env (CONSTRUCT_EMBEDDING_MODEL) for tests
 * @param {Function} [opts.importTransformers] injectable seam over the dynamic import, for tests
 * @returns {Promise<{ ok: boolean, degraded: boolean, label: string, optional: boolean }>}
 */
export async function checkEmbeddingModelForDoctor(opts = {}) {
  const { env = process.env, importTransformers = () => import('@huggingface/transformers') } = opts;
  const info = await getEmbeddingModelInfo({ env });

  if (info.id !== 'local') {
    return { ok: true, degraded: false, label: `Embedding model: ${info.id} (${info.model}, ${info.dimensions}d)`, optional: true };
  }

  try {
    await importTransformers();
    return { ok: true, degraded: false, label: `Embedding model: local (${info.model}, ${info.dimensions}d) — @huggingface/transformers resolves`, optional: true };
  } catch (err) {
    return {
      ok: true,
      degraded: true,
      label: `Embedding model: local requested but @huggingface/transformers is not installed (${err.message}) — degrades to hashing-bow-v1 (256d, no semantic understanding). Install with \`npm install @huggingface/transformers\`, or set CONSTRUCT_EMBEDDING_MODEL=hashing to opt into the degraded model explicitly.`,
      optional: true,
    };
  }
}
