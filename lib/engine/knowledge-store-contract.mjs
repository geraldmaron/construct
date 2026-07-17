/**
 * lib/engine/knowledge-store-contract.mjs — KnowledgeStore provider contract
 * (construct-tsyfe.7.1).
 *
 * Sibling to lib/engine/contracts.mjs's six-layer plugin contract (Embedder,
 * Chunker, Indexer, Fuser, Reranker, Compressor): where that module checks
 * runtime plugin instances against a method/meta shape, this module checks a
 * deployment's declared knowledge-storage capability against a mode taxonomy.
 * Both are hand-rolled, dependency-free validators per ADR-0001 (zero npm
 * dependencies in core) — ADR-0001's own declared exceptions
 * (@lancedb/lancedb, apache-arrow) are providers this contract describes, not
 * validation tooling this contract depends on.
 *
 * Six capability axes, independently swappable (a flat backend enum was
 * rejected — team mode still needs a keyword engine; capable-local-semantic
 * doesn't need Postgres):
 *   metadataStore, keywordSearch, vectorSearch, embedding, reranking,
 *   sharedStorage.
 *
 * Four named modes, mapped onto CURRENT modules (no migration in this bead):
 *   minimal-local           — lib/knowledge/search.mjs only. The floor every
 *                              deployment has.
 *   capable-local-semantic  — adds lib/storage/vector-client.mjs (LanceDB,
 *                              ADR-0066) + lib/storage/embeddings-engine.mjs.
 *   team                    — adds lib/storage/backend.mjs (Postgres shared
 *                              run-store) on top of the same keyword floor.
 *   remote-where-justified  — contract shape only; no remote backend exists
 *                              in the repo today (non-goal: picking one). Any
 *                              axis marked remote:true, in this mode or any
 *                              other, must carry a non-empty `justification`
 *                              on the declaration — this is how an operator
 *                              audits which backend (e.g. a hosted embedding
 *                              API) sees document content leave the machine.
 *
 * Every mode declares the keywordSearch + metadataStore floor present=true,
 * with lib/knowledge/search.mjs as the sole floor provider across all four
 * modes. Reference shape: schemas/knowledge-store.schema.json.
 *
 * Scope: contract + capability-query only (construct-tsyfe.7.1). Wiring
 * lib/knowledge/rag.mjs, lib/storage/hybrid-query.mjs, or the embeddings
 * dispatchers to query this contract is construct-tsyfe.7.3, not this file.
 */

export const KNOWLEDGE_STORE_SCHEMA_VERSION = 1;

export const KNOWLEDGE_STORE_AXES = Object.freeze([
  'metadataStore',
  'keywordSearch',
  'vectorSearch',
  'embedding',
  'reranking',
  'sharedStorage',
]);

export const KNOWLEDGE_STORE_MODES = Object.freeze([
  'minimal-local',
  'capable-local-semantic',
  'team',
  'remote-where-justified',
]);

function axis(present, { providerId, remote } = {}) {
  const decl = { present };
  if (providerId !== undefined) decl.providerId = providerId;
  if (remote !== undefined) decl.remote = remote;
  return Object.freeze(decl);
}

// The keyword-search + metadata-store floor every mode declares. Both map to
// lib/knowledge/search.mjs, whose own header (:1-10) already describes the
// docs-tree keyword engine and its structured per-hit origin tagging
// (targetId/provider/projectKey/relPath/kind) — the "metadata" this axis
// names. No mode defined here migrates that floor to a different module.

function floorAxes() {
  return {
    metadataStore: axis(true, { providerId: 'lib/knowledge/search.mjs' }),
    keywordSearch: axis(true, { providerId: 'lib/knowledge/search.mjs' }),
  };
}

/**
 * Mode -> current-module mapping table (Completion evidence for
 * construct-tsyfe.7.1, verified against the cited files at execution time —
 * see the bead's Execution prompt step 3). No new module is introduced; this
 * bead only names the contract these existing modules could later implement.
 */
export const KNOWLEDGE_STORE_MODE_DECLARATIONS = Object.freeze({
  'minimal-local': Object.freeze({
    schemaVersion: KNOWLEDGE_STORE_SCHEMA_VERSION,
    mode: 'minimal-local',
    axes: Object.freeze({
      ...floorAxes(),
      vectorSearch: axis(false),
      embedding: axis(false),
      reranking: axis(false),
      sharedStorage: axis(false),
    }),
    justification: null,
  }),
  'capable-local-semantic': Object.freeze({
    schemaVersion: KNOWLEDGE_STORE_SCHEMA_VERSION,
    mode: 'capable-local-semantic',
    axes: Object.freeze({
      ...floorAxes(),
      vectorSearch: axis(true, { providerId: 'lib/storage/vector-client.mjs' }),
      embedding: axis(true, { providerId: 'lib/storage/embeddings-engine.mjs' }),
      reranking: axis(false),
      sharedStorage: axis(false),
    }),
    justification: null,
  }),
  team: Object.freeze({
    schemaVersion: KNOWLEDGE_STORE_SCHEMA_VERSION,
    mode: 'team',
    axes: Object.freeze({
      ...floorAxes(),
      vectorSearch: axis(false),
      embedding: axis(false),
      reranking: axis(false),
      sharedStorage: axis(true, { providerId: 'lib/storage/backend.mjs' }),
    }),
    justification: null,
  }),
  'remote-where-justified': Object.freeze({
    schemaVersion: KNOWLEDGE_STORE_SCHEMA_VERSION,
    mode: 'remote-where-justified',
    axes: Object.freeze({
      ...floorAxes(),
      vectorSearch: axis(false),
      embedding: axis(false),
      reranking: axis(false),
      sharedStorage: axis(false),
    }),
    justification:
      'Contract shape only — no remote backend is implemented or selected in the repo today. ' +
      'A future remote provider fills in an axis with remote:true and replaces this placeholder ' +
      'with its own documented justification (construct-tsyfe.7.1 non-goal).',
  }),
});

/**
 * The capability-query mechanism the Decision section requires: mechanical,
 * not left to each caller re-deriving whether e.g. LanceDB is reachable.
 * Existing modules can implement against this shape once construct-tsyfe.7.3
 * wires them up; this bead only defines what they would return.
 *
 * @param {string} mode — one of KNOWLEDGE_STORE_MODES
 * @returns {object|null} the frozen canonical declaration, or null if unknown
 */
export function getKnowledgeStoreCapability(mode) {
  return KNOWLEDGE_STORE_MODE_DECLARATIONS[mode] || null;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Collects every violation of the KnowledgeStore contract in `declaration`.
 * Returns an array of human-readable error strings (empty on success).
 */
function collectKnowledgeStoreErrors(declaration) {
  const errors = [];
  if (!declaration || typeof declaration !== 'object') {
    return ['declaration must be a non-null object'];
  }

  if (declaration.schemaVersion !== KNOWLEDGE_STORE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${KNOWLEDGE_STORE_SCHEMA_VERSION}`);
  }

  if (!KNOWLEDGE_STORE_MODES.includes(declaration.mode)) {
    errors.push(`mode must be one of: ${KNOWLEDGE_STORE_MODES.join(', ')}`);
  }

  const axes = declaration.axes;
  if (!axes || typeof axes !== 'object') {
    errors.push('axes is required and must be an object');
    return errors;
  }

  const extraAxisKeys = Object.keys(axes).filter((k) => !KNOWLEDGE_STORE_AXES.includes(k));
  for (const key of extraAxisKeys) errors.push(`axes.${key} is not a recognized capability axis`);

  let anyRemote = false;
  for (const name of KNOWLEDGE_STORE_AXES) {
    const decl = axes[name];
    if (decl === undefined) {
      errors.push(`axes.${name} is required`);
      continue;
    }
    if (typeof decl.present !== 'boolean') {
      errors.push(`axes.${name}.present must be a boolean`);
      continue;
    }
    if (decl.present && !isNonEmptyString(decl.providerId)) {
      errors.push(`axes.${name}.providerId is required (non-empty string) when axes.${name}.present is true`);
    }
    if (decl.remote === true) anyRemote = true;
  }

  // Universal floor: keyword search and metadata store are non-optional on
  // every mode, independent of which axes a given mode adds on top.

  if (axes.keywordSearch && axes.keywordSearch.present !== true) {
    errors.push('axes.keywordSearch.present must be true — every KnowledgeStore mode declares the keyword-search floor');
  }
  if (axes.metadataStore && axes.metadataStore.present !== true) {
    errors.push('axes.metadataStore.present must be true — every KnowledgeStore mode declares the metadata-store floor');
  }

  if (declaration.mode === 'team' && axes.sharedStorage && axes.sharedStorage.present !== true) {
    errors.push('team mode requires axes.sharedStorage.present to be true');
  }
  if (declaration.mode === 'capable-local-semantic') {
    if (axes.vectorSearch && axes.vectorSearch.present !== true) {
      errors.push('capable-local-semantic mode requires axes.vectorSearch.present to be true');
    }
    if (axes.embedding && axes.embedding.present !== true) {
      errors.push('capable-local-semantic mode requires axes.embedding.present to be true');
    }
  }
  if (declaration.mode === 'remote-where-justified' && !isNonEmptyString(declaration.justification)) {
    errors.push('remote-where-justified mode requires a non-empty justification');
  }

  if (anyRemote && !isNonEmptyString(declaration.justification)) {
    errors.push('declaration.justification is required (non-empty string) when any axis declares remote:true');
  }

  return errors;
}

/**
 * Non-throwing check, mirroring lib/engine/contracts.mjs's checkContract —
 * returns { ok, errors } instead of throwing so a caller (or `construct
 * doctor`) can report on every declaration in one pass.
 */
export function checkKnowledgeStoreCapability(declaration) {
  const errors = collectKnowledgeStoreErrors(declaration);
  return { ok: errors.length === 0, errors };
}

/**
 * Throwing assertion, mirroring lib/engine/contracts.mjs's assertContract —
 * throws with every collected violation joined, rather than only the first.
 */
export function assertKnowledgeStoreCapability(declaration) {
  const { ok, errors } = checkKnowledgeStoreCapability(declaration);
  if (!ok) {
    throw new Error(`KnowledgeStore capability declaration invalid: ${errors.join('; ')}`);
  }
}
