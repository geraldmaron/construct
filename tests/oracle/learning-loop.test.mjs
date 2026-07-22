/**
 * tests/oracle/learning-loop.test.mjs — Oracle learning loop
 * (lib/oracle/learning-loop.mjs): record, classify, recurrence, full process pass.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyMissDescription } from '../../lib/oracle/miss-classes.mjs';
import {
  learningLoopPath,
  processMiss,
  readMissRecords,
  recordMiss,
  summarizeLearningLoop,
  trackRecurrence,
} from '../../lib/oracle/learning-loop.mjs';

function tempProject(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-learning-loop-'));
  fs.mkdirSync(path.join(rootDir, '.construct', 'oracle'), { recursive: true });
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

test('classifyMissDescription maps M4 integration gap language', () => {
  const result = classifyMissDescription(
    'Closed bead SHA not reachable from origin/main — tracker and git unreconciled',
  );
  assert.ok(result);
  assert.equal(result.classId, 'M4');
  assert.equal(result.confidence, 'high');
});

test('classifyMissDescription returns null for unmatched descriptions', () => {
  const result = classifyMissDescription('widget color mismatch in sidebar CSS');
  assert.equal(result, null);
});

test('recordMiss persists to learning-loop.jsonl', (t) => {
  const rootDir = tempProject(t);
  const record = recordMiss({
    rootDir,
    description: 'Oracle daemon stalled with frozen heartbeat',
    beadId: 'construct-test-1',
  });
  assert.ok(record.missId);
  assert.equal(readMissRecords(rootDir).length, 1);
  assert.ok(fs.existsSync(learningLoopPath(rootDir)));
});

test('processMiss runs full loop and marks first occurrence', (t) => {
  const rootDir = tempProject(t);
  const output = processMiss({
    rootDir,
    description: 'Oracle verdict vocabulary cannot express scaffold rows — M1 vocabulary gap',
    beadId: 'construct-test-m1',
  });
  assert.equal(output.classification.classId, 'M1');
  assert.equal(output.earliestDetectionStage, 'producer-level');
  assert.ok(output.proposedInvariant.invariantId);
  assert.ok(output.proposedNegativeTest.testPath);
  assert.equal(output.recurrence.first, true);
  assert.equal(output.recurrence.count, 1);
  assert.equal(output.beadId, 'construct-test-m1');
});

test('processMiss detects recurrence for same miss class', (t) => {
  const rootDir = tempProject(t);
  processMiss({
    rootDir,
    description: 'Closed bead cited SHA not reachable from origin/main',
  });
  const second = processMiss({
    rootDir,
    description: 'Another closed bead SHA merge-base check failed against main',
  });
  assert.equal(second.classification.classId, 'M4');
  assert.equal(second.recurrence.first, false);
  assert.equal(second.recurrence.count, 2);
  assert.ok(second.recurrence.priorMissIds.length >= 1);

  const stats = trackRecurrence(rootDir, 'M4');
  assert.equal(stats.total, 2);
  assert.equal(stats.isRecurrence, true);
});

test('processMiss flags candidate new class when no taxonomy match', (t) => {
  const rootDir = tempProject(t);
  const output = processMiss({
    rootDir,
    description: 'Sidebar icon alignment off by two pixels in dark mode',
  });
  assert.equal(output.classification.candidateNewClass, true);
  assert.equal(output.classification.classId, null);
  assert.equal(output.earliestDetectionStage, 'bounded-semantic-review');
});

test('summarizeLearningLoop aggregates by class', (t) => {
  const rootDir = tempProject(t);
  processMiss({ rootDir, description: 'Oracle stalled — maxIdleTicks self shut down' });
  processMiss({ rootDir, description: 'Closed bead SHA not reachable from main' });
  const summary = summarizeLearningLoop(rootDir);
  assert.equal(summary.totalMisses, 2);
  assert.ok(summary.byClass.M3 >= 1 || summary.byClass.M4 >= 1);
});
