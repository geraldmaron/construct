/**
 * tests/verify-cutover-graph-sweep.test.mjs — pins E1 cycle/orphan sweep
 * verdicts for empty-state, clean sweeps, and the Node <22.5 sqlite guard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretGraphSweep } from '../scripts/verify-cutover.mjs';

test('empty-state No graph found is a pass for cycles and orphans', () => {
  const result = {
    code: 1,
    stdout: '',
    stderr: 'No graph found. Run `construct graph build` first.\n',
  };
  assert.match(interpretGraphSweep(result, 'cycles').detail, /empty-state/);
  assert.equal(interpretGraphSweep(result, 'cycles').ok, true);
  assert.equal(interpretGraphSweep(result, 'orphans').ok, true);
});

test('Node <22.5 relational-store guard is a runtime-contract pass', () => {
  const result = {
    code: 1,
    stdout: '',
    stderr: 'This command requires the relational graph store (node:sqlite, Node >=22.5).\n',
  };
  const cycles = interpretGraphSweep(result, 'cycles');
  const orphans = interpretGraphSweep(result, 'orphans');
  assert.equal(cycles.ok, true);
  assert.equal(orphans.ok, true);
  assert.match(cycles.detail, /runtime contract/);
  assert.match(orphans.detail, /Node <22\.5/);
});

test('non-zero cycle members fail', () => {
  const result = {
    code: 0,
    stdout: 'cycle members (2):\n  a: a->b->a\n  b: a->b->a\n',
    stderr: '',
  };
  const verdict = interpretGraphSweep(result, 'cycles');
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /2 cycle member/);
});

test('zero cycle members and orphans exit 0 pass', () => {
  assert.equal(
    interpretGraphSweep({ code: 0, stdout: 'cycle members (0):\n', stderr: '' }, 'cycles').ok,
    true,
  );
  assert.equal(
    interpretGraphSweep({ code: 0, stdout: 'orphans (0):\n', stderr: '' }, 'orphans').ok,
    true,
  );
});
