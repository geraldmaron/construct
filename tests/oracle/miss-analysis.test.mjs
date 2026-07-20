/**
 * tests/oracle/miss-analysis.test.mjs — Oracle miss root-cause classifier
 * (lib/oracle/miss-analysis.mjs): taxonomy match, new-class flag, recurrence.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { analyzeMiss, classifyMissForAnalysis, listMissClasses } from '../../lib/oracle/miss-analysis.mjs';
import { recordMiss } from '../../lib/oracle/learning-loop.mjs';

function tempProject(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-miss-analysis-'));
  fs.mkdirSync(path.join(rootDir, '.construct', 'oracle'), { recursive: true });
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

test('listMissClasses exposes M1-M4 from oracle-miss-report', () => {
  const classes = listMissClasses();
  assert.equal(classes.length, 4);
  assert.deepEqual(classes.map((c) => c.id), ['M1', 'M2', 'M3', 'M4']);
});

test('classifyMissForAnalysis matches M3 liveness language with report citation', () => {
  const result = classifyMissForAnalysis({
    description: 'Oracle daemon self-shut after maxIdleTicks with frozen heartbeat',
  });
  assert.equal(result.ok, true);
  assert.equal(result.classification.classId, 'M3');
  assert.ok(result.reportCitation.includes('M3'));
  assert.equal(result.earliestDetectionStage, 'producer-level');
});

test('classifyMissForAnalysis flags candidate new class when no taxonomy match', () => {
  const result = classifyMissForAnalysis({
    description: 'Typography kerning off in the settings panel header',
  });
  assert.equal(result.classification.candidateNewClass, true);
  assert.equal(result.classification.classId, null);
});

test('classifyMissForAnalysis detects recurrence from prior learning-loop records', (t) => {
  const rootDir = tempProject(t);
  recordMiss({
    rootDir,
    description: 'Closed bead SHA not reachable from origin/main',
  });
  const result = analyzeMiss({
    rootDir,
    description: 'Another tracker/git integration gap: merge-base check failed on closed bead',
  });
  assert.equal(result.classification.classId, 'M4');
  assert.equal(result.recurrence.isRecurrence, true);
  assert.equal(result.recurrence.first, false);
  assert.ok(result.recurrence.priorMissIds.length >= 1);
});

test('analyzeMiss output shape is consumable by learning-loop processMiss', () => {
  const result = analyzeMiss({
    description: 'Oracle verdict vocabulary cannot express scaffold rows',
  });
  assert.equal(result.classification.classId, 'M1');
  assert.ok(result.earliestDetectionStage);
  assert.ok(result.taxonomyVersion);
});
