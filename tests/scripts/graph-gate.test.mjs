/**
 * tests/scripts/graph-gate.test.mjs — self-test for the living-graph
 * drift gate (scripts/run-graph-gate.mjs).
 *
 * Three acceptance guarantees the bead names:
 *   1. the gate passes on the committed clean tree;
 *   2. a workflow declared without tests is a HARD error under the gate's
 *      strict validate (and only a warning in lenient solo mode, proving the
 *      gate does not inherit solo leniency);
 *   3. gate honesty — the CI step carries no change-filter `if:`, so no code
 *      path can merge graph drift by skipping the job.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGraphGate } from '../../scripts/run-graph-gate.mjs';
import { writeGraph } from '../../lib/graph/store.mjs';
import { validateGraph } from '../../lib/graph/validate.mjs';

// the relational graph store (lib/graph/relational/)
// resolves graph.db under the machine-scoped state root (resolveStateDir)
// whenever writeGraph/loadGraph touch the host graph on Node
// >=22.5. Pin CONSTRUCT_HOME_OVERRIDE so this suite never provisions state under
// the real developer machine's ~/.construct/projects/ (the isolation
// contract, tests/functional/README.md) — the same pattern
// tests/orchestration-run-store-sqlite.test.mjs already established.

const constructGraphTestHomeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-test-home-'));
const constructGraphTestPrevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestHomeOverride;
test.after(() => {
  try { fs.rmSync(constructGraphTestHomeOverride, { recursive: true, force: true }); } catch {}
  if (constructGraphTestPrevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = constructGraphTestPrevHomeOverride;
});


const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('gate passes on the committed clean tree', () => {
  const verdict = runGraphGate({ cwd: REPO_ROOT });
  assert.equal(verdict.ok, true, `expected clean tree to pass; drift errors:\n${verdict.errors.join('\n')}`);
  assert.equal(verdict.errors.length, 0);
  assert.equal(verdict.stale, false);
});

test('a workflow with zero tests is a hard error under strict validate, a warning under solo', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-graph-gate-'));
  try {
    // A capability that embeds a workflow, with no test --validates--> it.
    writeGraph(tmp, {
      nodes: [
        { id: 'workflow:demo', type: 'workflow', name: 'demo' },
        { id: 'capability:demo', type: 'capability', name: 'demo' },
      ],
      edges: [{ from: 'capability:demo', to: 'workflow:demo', rel: 'embeds' }],
    });

    const untested = /zero validating tests|zero validated embedding/;

    const solo = validateGraph(tmp, { strict: false });
    assert.equal(solo.valid, true, 'solo mode must not hard-fail a missing-test gap');
    assert.ok(solo.warnings.some((w) => untested.test(w)), 'solo mode should warn on the gap');

    const strict = validateGraph(tmp, { strict: true });
    assert.equal(strict.valid, false, 'strict mode must fail the missing-test gap');
    assert.ok(strict.errors.some((e) => untested.test(e)), 'strict mode should error on the gap');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CI graph-gate step runs unconditionally in the lint job (gate honesty)', () => {
  const ci = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const lines = ci.split('\n');
  const stepIdx = lines.findIndex((l) => /^\s*-\s*name:\s*graph drift gate\s*$/.test(l));
  assert.ok(stepIdx !== -1, 'ci.yml must define a "graph drift gate" step');

  // Between this step's `- name:` and the next `- name:`, there must be no
  // `if:` key — an `if:` would let a change-filter skip the gate.
  const rest = lines.slice(stepIdx + 1);
  const nextStepOffset = rest.findIndex((l) => /^\s*-\s*name:/.test(l));
  const stepBody = (nextStepOffset === -1 ? rest : rest.slice(0, nextStepOffset));
  assert.ok(
    !stepBody.some((l) => /^\s*if:/.test(l)),
    'the graph drift gate step must not carry an `if:` change-filter guard',
  );
});
