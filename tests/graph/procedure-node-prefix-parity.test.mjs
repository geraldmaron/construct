/**
 * tests/graph/procedure-node-prefix-parity.test.mjs — the node prefix the
 * graph builder emits for Procedures must equal the prefix every graph
 * consumer looks the same nodes up under.
 *
 * When the v2 surface cutover renamed buildFromRegistry's emission from
 * `workflow:` to `procedure:`, six consumers (status health, oracle
 * read-model, graph validate/gaps/gap-queries, runtime evidence) kept
 * querying `workflow:` — every one of them silently degraded to a no-op
 * over an empty node set, and `construct status` reported all 11 Procedures
 * "missing" against a graph that contained all 11. Nothing failed, because
 * a lookup that matches zero nodes is indistinguishable from a clean graph.
 *
 * These assertions fail loudly on a one-sided rename.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFromRegistry } from '../../lib/graph/build-from-registry.mjs';
import { listProcedureDefinitions } from '../../lib/embedded-contract/procedure-definitions.mjs';

const ROOT_DIR = new URL('../../', import.meta.url).pathname;

const CONSUMERS = Object.freeze([
  'lib/status.mjs',
  'lib/oracle/read-model.mjs',
  'lib/graph/validate.mjs',
  'lib/graph/gaps.mjs',
  'lib/graph/gap-queries.mjs',
  'lib/graph/runtime-evidence.mjs',
  'lib/graph/impact.mjs',
]);

test('buildFromRegistry emits one procedure-typed node per catalog Procedure', () => {
  const built = buildFromRegistry({ rootDir: ROOT_DIR });
  const procedureNodes = built.nodes.filter((n) => n.type === 'procedure');
  const definitions = listProcedureDefinitions();

  assert.equal(procedureNodes.length, definitions.length);
  for (const definition of definitions) {
    assert.ok(
      procedureNodes.some((n) => n.id === `procedure:${definition.id}`),
      `no procedure:${definition.id} node in buildFromRegistry output`,
    );
  }
});

test('the builder emits no workflow-typed nodes for consumers to miss', () => {
  const built = buildFromRegistry({ rootDir: ROOT_DIR });
  assert.deepEqual(built.nodes.filter((n) => n.type === 'workflow'), []);
});

test('no graph consumer looks Procedures up under the workflow node type', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const rel of CONSUMERS) {
    const source = await readFile(new URL(rel, new URL('../../', import.meta.url)), 'utf8');
    assert.doesNotMatch(
      source,
      /nodesByType\(graph, 'workflow'\)|nodeId\('workflow',/,
      `${rel} queries the graph for workflow-typed nodes, which the builder never emits`,
    );

    // A hardcoded 'workflow:' slice length silently mangles a procedure: id
    // into a truncated string rather than failing — same silent class.

    assert.doesNotMatch(
      source,
      /'workflow:'/,
      `${rel} slices node ids against the workflow: prefix, which no node carries`,
    );
  }
});
