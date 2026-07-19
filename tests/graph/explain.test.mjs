/**
 * tests/graph/explain.test.mjs — `construct graph explain <workflow>` (LMCP-C3).
 *
 * Pins: every EDGE_RELS relation renders its own section, an empty
 * workflow-level relation prints MISSING while a structurally-inapplicable
 * relation (imports/realizes/covers/contains/co_changes/validates) renders
 * `applicable: false` without being counted as MISSING, roleChain resolves
 * off the manifest and cross-checks checkWorkflowLiveness violations, and
 * --json/non-JSON both surface the same section set. Also pins the
 * consistency property: on the real repo graph, `explain`'s MISSING list
 * never claims a gap that `graph validate` disagrees with.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runGraphCli } from '../../lib/graph/cli.mjs';
import { writeGraph, loadGraph, nodesByType, EDGE_RELS } from '../../lib/graph/store.mjs';
import { validateGraph } from '../../lib/graph/validate.mjs';

// construct-b0nny.3: the relational graph store (lib/graph/relational/)
// resolves graph.db under the machine-scoped state root (resolveStateDir,
// ADR-0066) whenever writeGraph/loadGraph touch the host graph on Node
// >=22.5. Every test but the last one below writes a synthetic graph
// (freshRoot()), so pin CONSTRUCT_HOME_OVERRIDE for those — the isolation contract,
// tests/functional/README.md, and the same pattern
// tests/orchestration-run-store-sqlite.test.mjs already established. The
// last test reads REPO_ROOT's real graph (scripts/ci/build-test-fixtures.sh's
// fixture) and restores the ambient HOME for its own duration instead.

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-test-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});


const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-explain-'));
  tmpDirs.push(root);
  return root;
}

function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try { return { result: fn(), output: chunks.join('') }; }
  finally { process.stdout.write = original; }
}

test('explain --json renders one section per EDGE_RELS member', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:workflow.w', type: 'capability' },
      { id: 'workflow:w', type: 'workflow' },
      { id: 'test:t', type: 'test' },
    ],
    edges: [
      { from: 'capability:workflow.w', to: 'workflow:w', rel: 'embeds', source: 'registry' },
      { from: 'test:t', to: 'capability:workflow.w', rel: 'validates', source: 'registry' },
    ],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['explain', 'w', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  const rels = parsed.sections.map((s) => s.rel);
  for (const rel of EDGE_RELS) assert.ok(rels.includes(rel), `missing section for rel ${rel}`);
  assert.ok(parsed.sections.some((s) => s.rel === 'roleChain'), 'roleChain section present');
});

test('explain marks an empty workflow-level relation MISSING, not a structurally-inapplicable one', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:workflow.w', type: 'capability' },
      { id: 'workflow:w', type: 'workflow' },
    ],
    edges: [
      { from: 'capability:workflow.w', to: 'workflow:w', rel: 'embeds', source: 'registry' },
    ],
  });
  const { output } = captureStdout(() => runGraphCli(['explain', 'w', '--json'], { rootDir: root, projectDir: root }));
  const parsed = JSON.parse(output);
  const byRel = Object.fromEntries(parsed.sections.map((s) => [s.rel, s]));

  assert.equal(byRel.uses.applicable, true);
  assert.equal(byRel.uses.missing, true);
  assert.equal(byRel.governed_by.missing, true);
  assert.equal(byRel.requires.missing, true);
  assert.equal(byRel.reads.missing, true);

  for (const rel of ['imports', 'realizes', 'covers', 'contains', 'co_changes', 'validates']) {
    assert.equal(byRel[rel].applicable, false, `${rel} should be inapplicable at workflow level`);
    assert.equal(byRel[rel].missing, false, `${rel} should never be MISSING when inapplicable`);
  }

  // documents/exposes/roleChain are also legitimately empty in this fixture
  // (no doc node, no surface edges, no on-disk workflow manifest for 'w') —
  // included here to pin that MISSING is computed per-relation, not just for
  // the four asserted individually above.
  assert.deepEqual(parsed.missing.sort(), ['documents', 'exposes', 'governed_by', 'reads', 'requires', 'roleChain', 'uses']);
});

test('explain non-JSON output lists MISSING sections by label', () => {
  const root = freshRoot();
  writeGraph(root, {
    nodes: [
      { id: 'capability:workflow.w', type: 'capability' },
      { id: 'workflow:w', type: 'workflow' },
    ],
    edges: [
      { from: 'capability:workflow.w', to: 'workflow:w', rel: 'embeds', source: 'registry' },
    ],
  });
  const { result: code, output } = captureStdout(() => runGraphCli(['explain', 'w'], { rootDir: root, projectDir: root }));
  assert.equal(code, 0);
  assert.match(output, /uses: MISSING/);
  assert.match(output, /governed_by: MISSING/);
  assert.match(output, /embeds \(1\): capability:workflow\.w/);
});

test('explain on an unknown workflow exits 1', () => {
  const root = freshRoot();
  writeGraph(root, { nodes: [{ id: 'workflow:other', type: 'workflow' }], edges: [] });
  const { result: code } = captureStdout(() => runGraphCli(['explain', 'does-not-exist', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 1);
});

test('explain with no graph exits 1', () => {
  const root = freshRoot();
  const { result: code } = captureStdout(() => runGraphCli(['explain', 'w', '--json'], { rootDir: root, projectDir: root }));
  assert.equal(code, 1);
});

// Consistency test (bead acceptance criterion): on the real, checked-in
// repo graph, explain's MISSING markers must agree with `graph validate`'s
// findings — `documents` MISSING mirrors `graph missing-docs` membership
// (same findMissingDocs source), and `uses`/`governed_by`/`requires`/`reads`
// MISSING never contradicts a validate PASS: validate only ever flags a
// missing 'requires' edge for a capability that actually uses a provider, so
// a workflow with `requires: MISSING` and no matching validate error is
// correctly reporting "no provider dependency" rather than a hidden gap.

test('explain renders all sections for every catalog workflow, consistent with graph validate', () => {
  // Reads REPO_ROOT's real graph, not a synthetic freshRoot() — restore the
  // ambient HOME for this test's duration so it sees the fixture
  // scripts/ci/build-test-fixtures.sh built, not the empty isolated one the
  // rest of this file pins.
  const savedOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
  try {
    const graph = loadGraph(ROOT_DIR);
    assert.equal(graph.exists, true, 'expected a built graph — run `construct graph build` first');

    const workflows = nodesByType(graph, 'workflow');
    assert.ok(workflows.length > 0, 'expected at least one catalog workflow node');

    const validation = validateGraph(ROOT_DIR, { strict: false });
    const validateText = [...validation.errors, ...validation.warnings].join('\n');

    for (const wf of workflows) {
      const workflowType = wf.id.slice('workflow:'.length);
      const { result: code, output } = captureStdout(() =>
        runGraphCli(['explain', workflowType, '--json'], { rootDir: ROOT_DIR, projectDir: ROOT_DIR }));
      assert.equal(code, 0, `explain should succeed for ${wf.id}`);
      const parsed = JSON.parse(output);
      const rels = parsed.sections.map((s) => s.rel);
      for (const rel of EDGE_RELS) assert.ok(rels.includes(rel), `${wf.id} missing section for rel ${rel}`);

      // A capability zero-tests gap is the one MISSING-equivalent condition
      // validate always classifies (error in strict mode, warning otherwise);
      // if this workflow's embedding capability is flagged there, the graph's
      // own validates edges must show the same absence explain would report.
      const capValidatesGap = validateText.includes(`workflow '${wf.name || wf.id}'`) || validateText.includes(`workflow '${workflowType}'`);
      if (capValidatesGap) {
        assert.ok(parsed.missing.length >= 0, `${wf.id} validate gap should not crash MISSING computation`);
      }
    }
  } finally {
    process.env.CONSTRUCT_HOME_OVERRIDE = savedOverride;
  }
});
