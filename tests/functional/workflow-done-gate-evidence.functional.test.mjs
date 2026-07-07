/**
 * tests/functional/workflow-done-gate-evidence.functional.test.mjs — the
 * workflow done-gate validates evidence CONTENT, not just presence
 * (construct-fbxv.8).
 *
 * Before this fix, updateTask's done-gate threw only when
 * mergedVerification.length === 0 -- any non-empty string ("did stuff")
 * satisfied it, and only task.phase === "implement" was covered. This pins:
 *   - "did stuff" (no command/path/URL/test/attestation) is rejected for
 *     implement, validate, and operate phase tasks;
 *   - evidence containing a runnable command, a file path, a URL, or a test
 *     reference passes;
 *   - the existing cx-reviewer/cx-qa attestation shape
 *     (tests/concierge-routing.test.mjs) still passes;
 *   - alignmentFindings demotes the same non-reverifiable-evidence condition
 *     to a HIGH finding for state loaded from disk (bypassing the live gate).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initWorkflow, addTask, updateTask, loadWorkflow, alignmentFindings } from '../../lib/workflow-state.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-done-gate-'));
}

function addImplementTask(root, phase = 'implement') {
  initWorkflow(root, 'Done-gate evidence');
  const workflow = addTask(root, {
    title: 'Ship the thing',
    phase,
    owner: 'cx-engineer',
    readFirst: ['src/index.ts'],
    doNotChange: ['package-lock.json'],
    acceptanceCriteria: ['it works'],
  });
  return workflow.tasks[0].key;
}

test('rejects a bare non-empty string with no command/path/URL/test/attestation shape', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  const key = addImplementTask(root);
  assert.throws(
    () => updateTask(root, key, { status: 'done', verification: ['did stuff'] }),
    /not re-verifiable/,
  );
});

test('accepts evidence containing a runnable command', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  const key = addImplementTask(root);
  assert.doesNotThrow(() =>
    updateTask(root, key, { status: 'done', verification: ['ran `node --test tests/foo.test.mjs` -> 5 passed'] }),
  );
});

test('accepts evidence containing a file path', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  const key = addImplementTask(root);
  assert.doesNotThrow(() =>
    updateTask(root, key, { status: 'done', verification: ['reviewed lib/workflow-state.mjs line 462 fix'] }),
  );
});

test('accepts evidence containing a URL', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  const key = addImplementTask(root);
  assert.doesNotThrow(() =>
    updateTask(root, key, { status: 'done', verification: ['see https://ci.example.com/runs/42'] }),
  );
});

test('accepts the existing cx-reviewer/cx-qa attestation shape', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  const key = addImplementTask(root);
  assert.doesNotThrow(() =>
    updateTask(root, key, {
      status: 'done',
      verification: ['cx-reviewer: APPROVED — no CRITICAL or HIGH findings', 'cx-qa: 42 tests passing'],
    }),
  );
});

test('validate-phase and operate-phase tasks get the same content gate', (t) => {
  for (const phase of ['validate', 'operate']) {
    const root = tmpProject();
    const key = addImplementTask(root, phase);
    assert.throws(
      () => updateTask(root, key, { status: 'done', verification: ['did stuff'] }),
      /not re-verifiable/,
      `${phase}-phase task should reject non-reverifiable evidence`,
    );
    assert.doesNotThrow(
      () => updateTask(root, key, { status: 'done', verification: ['node --test tests/foo.test.mjs'] }),
      `${phase}-phase task should accept a runnable command`,
    );
    rmTmpDir(root);
  }
});

test('research and plan phase tasks are not gated on evidence content', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  initWorkflow(root, 'Ungated phases');
  const workflow = addTask(root, {
    title: 'Explore the problem',
    phase: 'research',
    owner: 'cx-explorer',
    acceptanceCriteria: ['evidence gathered'],
  });
  const key = workflow.tasks[0].key;
  assert.doesNotThrow(() => updateTask(root, key, { status: 'done' }));
});

test('alignmentFindings flags non-reverifiable evidence on a done task loaded from disk as HIGH', (t) => {
  const root = tmpProject();
  t.after(() => rmTmpDir(root));
  const key = addImplementTask(root);
  // Bypass the live gate the way an older workflow.json (pre-fix) would: write
  // task.verification directly rather than through updateTask.
  const workflow = loadWorkflow(root);
  workflow.tasks[0].status = 'done';
  workflow.tasks[0].verification = ['did stuff'];

  const findings = alignmentFindings(workflow);
  const finding = findings.find((f) => f.task === key && f.issue.includes('not re-verifiable'));
  assert.ok(finding, 'expected a HIGH finding for non-reverifiable done-task evidence');
  assert.equal(finding.severity, 'HIGH');
});
