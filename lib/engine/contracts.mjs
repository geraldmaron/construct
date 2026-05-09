/**
 * lib/engine/contracts.mjs — Six stable plugin contracts for the Construct retrieval engine.
 *
 * Each layer of the recall stack is defined here as a runtime-checkable contract:
 *   Embedder, Chunker, Indexer, Fuser, Reranker, Compressor.
 *
 * External git projects can satisfy any contract by exporting a factory that returns
 * an object with the listed methods and a `meta` object. The resolver
 * (lib/engine/registry.mjs) validates against `assertContract(layer, plugin)` before
 * accepting a plugin; failures fall back to the default impl and are logged via
 * lib/hooks/_lib/log.mjs.
 *
 * Contracts are intentionally narrow. They describe what the engine needs, nothing
 * about how a plugin implements it. Capabilities are declared on `plugin.meta` so
 * callers can reason about batch support, async cost, dimensions, max tokens, etc.
 *
 * Layer dependencies:
 *   Embedder is required by Indexer (for query embedding) and Reranker.
 *   Indexer is required at retrieve time.
 *   Fuser combines Indexer outputs.
 *   Reranker reorders Fuser output.
 *   Compressor is applied independently to text blocks (chunks, prompts, injections).
 *   Chunker is upstream of Embedder at index-build time only.
 */

export const LAYERS = Object.freeze([
  'embedder',
  'chunker',
  'indexer',
  'fuser',
  'reranker',
  'compressor',
]);

// Contract definitions. Each entry lists the required `meta` fields and method
// signatures the plugin must expose. Method bodies may be sync OR async — the
// engine awaits all results, so plugins are free to be either.

const CONTRACTS = {
  embedder: {
    meta: ['id', 'modelId', 'dimensions'],
    methods: ['embed', 'embedBatch'],
  },
  chunker: {
    meta: ['id'],
    methods: ['chunk'],
  },
  indexer: {
    meta: ['id'],
    methods: ['store', 'query', 'health'],
  },
  fuser: {
    meta: ['id'],
    methods: ['fuse'],
  },
  reranker: {
    meta: ['id'],
    methods: ['rerank'],
  },
  compressor: {
    meta: ['id'],
    methods: ['compress'],
  },
};

/**
 * Throws if `plugin` does not satisfy the contract for `layer`.
 *
 * @param {string} layer — one of LAYERS
 * @param {object} plugin — plugin instance returned from a factory
 */
export function assertContract(layer, plugin) {
  if (!LAYERS.includes(layer)) {
    throw new Error(`Unknown plugin layer: ${layer}`);
  }
  if (!plugin || typeof plugin !== 'object') {
    throw new Error(`${layer} plugin: must be a non-null object`);
  }

  const spec = CONTRACTS[layer];
  const meta = plugin.meta;
  if (!meta || typeof meta !== 'object') {
    throw new Error(`${layer} plugin: missing required 'meta' object`);
  }

  for (const key of spec.meta) {
    if (meta[key] === undefined || meta[key] === null || meta[key] === '') {
      throw new Error(`${layer} plugin: meta.${key} is required`);
    }
  }

  for (const fn of spec.methods) {
    if (typeof plugin[fn] !== 'function') {
      throw new Error(`${layer} plugin (${meta.id}): missing method '${fn}'`);
    }
  }

  // Embedder must declare positive integer dimensions so downstream Indexer can
  // assert schema compatibility before the first store call.
  if (layer === 'embedder') {
    const dim = meta.dimensions;
    if (!Number.isInteger(dim) || dim <= 0) {
      throw new Error(`embedder plugin (${meta.id}): meta.dimensions must be a positive integer`);
    }
  }
}

/**
 * Lightweight, dependency-free contract test for use in `construct doctor` and
 * plugin author CI. Returns `{ ok, errors }` instead of throwing so a single run
 * can report on every plugin.
 *
 * @param {string} layer
 * @param {object} plugin
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkContract(layer, plugin) {
  try {
    assertContract(layer, plugin);
    return { ok: true, errors: [] };
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
}

export const CONTRACT_DEFINITIONS = CONTRACTS;
