/**
 * tests/audit/f14-tools/description-overlap.red.mjs — F14 [S2][S15] overlap & description quality.
 *
 * RED fixture (must FAIL against current code). Anthropic "writing tools for
 * agents": more tools do not improve outcomes; overlapping or underspecified
 * tools degrade tool choice and raise unsafe-selection probability. The Construct
 * catalog ships a dense retrieval cluster — web_search, knowledge_search,
 * knowledge_graph_ask, provider_fetch, rovo_search, search_skills, memory_search —
 * seven surfaces that all "search a corpus and return excerpts/results". The
 * descriptions even self-document the hazard ("kept distinct from knowledge_search
 * / provider_fetch / repo search so it is never conflated"), which is prose
 * patching that an agent must read and reason over at selection time rather than a
 * structured discriminator the host can route on.
 *
 * Two assertions, both grounded in the live catalog:
 *   1. Quality floor: every tool description is substantive (length floor) and no
 *      two are exact duplicates. (Catches the trivial failure mode.)
 *   2. Overlap discriminator: tools that share the retrieval intent must each
 *      carry a structured, machine-readable discriminator (a `category`/`group`
 *      tag or equivalent) so selection does not depend on parsing long prose. No
 *      catalog tool declares any such field today, so a cluster of >=3 overlapping
 *      retrieval tools with no discriminator is the red.
 *
 * Contract (CX-AUDIT-TOOLS-003/-004): build a realistic tool-use eval corpus +
 * confusion matrix and remove/hide overlapping long-tail tools behind find_tool,
 * giving the survivors structured disambiguation. Passes once overlapping
 * retrieval tools carry a machine-readable discriminator (or the cluster is
 * collapsed below the threshold).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, '..', '..', '..', 'lib', 'mcp', 'server.mjs');

function readCatalog() {
  const src = readFileSync(SERVER_PATH, 'utf8');
  const arrStart = src.indexOf('ALL_TOOL_DEFS = [');
  let i = src.indexOf('[', arrStart);
  let depth = 0;
  let end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
  }
  // The tools array is pure data (no function calls), safe to evaluate.
  return eval(`(${src.slice(i, end + 1)})`); // eslint-disable-line no-eval
}

// The retrieval intent the agent must disambiguate: each of these takes a query
// and returns ranked excerpts/results from some corpus. Membership is by name so
// the cluster is auditable and stable; the point is that nothing in the schema
// tells an agent which corpus is which without reading the full prose.

const RETRIEVAL_CLUSTER = [
  'web_search', 'knowledge_search', 'knowledge_graph_ask',
  'provider_fetch', 'rovo_search', 'search_skills', 'memory_search',
];

function hasMachineReadableDiscriminator(tool) {
  return Boolean(tool.category || tool.group || tool.namespace || tool.annotations?.category);
}

test('[S2][S15] every tool description is substantive and unique', () => {
  const catalog = readCatalog();
  const tooShort = catalog.filter((t) => (t.description || '').trim().length < 40).map((t) => t.name);
  assert.deepEqual(tooShort, [], `tool descriptions below the 40-char substance floor: ${tooShort.join(', ')}`);

  const byDesc = new Map();
  for (const t of catalog) {
    const d = (t.description || '').trim();
    byDesc.set(d, (byDesc.get(d) || []).concat(t.name));
  }
  const dups = [...byDesc.values()].filter((names) => names.length > 1);
  assert.deepEqual(dups, [], `exact-duplicate descriptions across tools: ${JSON.stringify(dups)}`);
});

test('[S2][S15] overlapping retrieval tools carry a machine-readable discriminator', () => {
  const catalog = readCatalog();
  const present = catalog.filter((t) => RETRIEVAL_CLUSTER.includes(t.name));

  // The cluster must actually exist in the catalog for this to be a real test of
  // the shipped surface, not a strawman.
  assert.ok(
    present.length >= 3,
    `retrieval cluster not found in catalog (found ${present.map((t) => t.name).join(', ')})`,
  );

  const undisambiguated = present.filter((t) => !hasMachineReadableDiscriminator(t)).map((t) => t.name);
  assert.deepEqual(
    undisambiguated,
    [],
    `${undisambiguated.length} overlapping retrieval tools have NO structured discriminator (category/group/namespace); `
    + `an agent must parse prose to choose among: ${undisambiguated.join(', ')}`,
  );
});
