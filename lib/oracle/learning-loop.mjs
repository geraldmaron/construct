/**
 * lib/oracle/learning-loop.mjs — Oracle learning loop (Layer 3 closure).
 *
 * Durable miss lifecycle: record miss -> classify -> earliest-detection-stage ->
 * add/update invariant proposal -> negative-test proposal -> link bead -> track
 * recurrence. State lives under .construct/oracle/learning-loop.jsonl so
 * the miss-analysis job can consume the same classification
 * shape without re-deriving it.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  classifyMissDescription,
  earliestDetectionStageForClass,
  missClassById,
  remedyClassForClass,
} from './miss-classes.mjs';

export const LEARNING_LOOP_STATE_REL = '.construct/oracle/learning-loop.jsonl';

const INVARIANT_PROPOSALS = Object.freeze({
  M1: 'evidence-status-vocabulary-rollout',
  M2: 'pr-diff-deterministic-gate',
  M3: 'independent-liveness-prober',
  M4: 'closed-bead-sha-reachable-from-main-or-annotated',
});

const NEGATIVE_TEST_PROPOSALS = Object.freeze({
  M1: 'tests/oracle/evidence-status-vocabulary.test.mjs',
  M2: 'tests/oracle/pr-scope-collectors.test.mjs',
  M3: 'tests/doctor/oracle-liveness-independent.test.mjs',
  M4: 'tests/oracle-invariants-closed-bead-sha.test.mjs',
});

export function learningLoopPath(rootDir) {
  return path.join(rootDir, LEARNING_LOOP_STATE_REL);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readMissRecords(rootDir) {
  const file = learningLoopPath(rootDir);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      /* skip corrupt line */
    }
  }
  return records;
}

function appendRecord(rootDir, record) {
  const file = learningLoopPath(rootDir);
  ensureDir(file);
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function updateRecord(rootDir, missId, patch) {
  const file = learningLoopPath(rootDir);
  const records = readMissRecords(rootDir);
  let found = false;
  const updated = records.map((r) => {
    if (r.missId !== missId) return r;
    found = true;
    return { ...r, ...patch, updatedAt: new Date().toISOString() };
  });
  if (!found) return null;
  ensureDir(file);
  fs.writeFileSync(file, `${updated.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  return updated.find((r) => r.missId === missId);
}

/**
 * @param {object} input
 * @param {string} input.description
 * @param {string} [input.beadId]
 * @param {string} [input.source]
 * @param {string} [input.rootDir]
 */
export function recordMiss(input) {
  const rootDir = input.rootDir || process.cwd();
  const missId = input.missId || randomUUID();
  const record = {
    missId,
    description: String(input.description || '').trim(),
    beadId: input.beadId || null,
    source: input.source || 'manual',
    recordedAt: new Date().toISOString(),
    classification: null,
    earliestDetectionStage: null,
    proposedInvariant: null,
    proposedNegativeTest: null,
    recurrence: null,
  };
  appendRecord(rootDir, record);
  return record;
}

/**
 * @param {string} description
 * @param {readonly object[]} [priorRecords]
 */
export function classifyMiss(description, priorRecords = []) {
  const match = classifyMissDescription(description);
  if (!match) {
    return {
      classId: null,
      className: null,
      confidence: 'low',
      citation: null,
      candidateNewClass: true,
    };
  }
  const priorSameClass = priorRecords.filter(
    (r) => r.classification?.classId === match.classId,
  );
  return {
    ...match,
    candidateNewClass: false,
    recurrence: {
      first: priorSameClass.length === 0,
      count: priorSameClass.length + 1,
      priorMissIds: priorSameClass.map((r) => r.missId),
    },
  };
}

export function suggestEarliestDetectionStage(classification) {
  if (!classification?.classId) return 'bounded-semantic-review';
  return earliestDetectionStageForClass(classification.classId);
}

export function proposeInvariantUpdate(classification) {
  if (!classification?.classId) return null;
  const existing = INVARIANT_PROPOSALS[classification.classId];
  const meta = missClassById(classification.classId);
  return {
    invariantId: existing || `${classification.className}-invariant`,
    action: existing ? 'update-existing' : 'add-new',
    remedyClass: remedyClassForClass(classification.classId),
    citation: meta?.citation || null,
  };
}

export function proposeNegativeTest(classification) {
  if (!classification?.classId) {
    return { testPath: 'tests/oracle/learning-loop-negative.test.mjs', action: 'add-new' };
  }
  return {
    testPath: NEGATIVE_TEST_PROPOSALS[classification.classId] || `tests/oracle/miss-${classification.className}.test.mjs`,
    action: 'add-or-extend',
  };
}

export function linkBead(rootDir, missId, beadId) {
  return updateRecord(rootDir, missId, { beadId });
}

export function trackRecurrence(rootDir, classId) {
  const records = readMissRecords(rootDir);
  const matched = records.filter((r) => r.classification?.classId === classId);
  return {
    classId,
    total: matched.length,
    firstMissId: matched[0]?.missId || null,
    latestMissId: matched[matched.length - 1]?.missId || null,
    isRecurrence: matched.length > 1,
  };
}

/**
 * Full learning-loop pass for one miss: classify, stage, propose, link, persist.
 *
 * @param {object} input
 * @param {string} input.description
 * @param {string} [input.missId]
 * @param {string} [input.beadId]
 * @param {string} [input.source]
 * @param {string} [input.rootDir]
 */
export function processMiss(input) {
  const rootDir = input.rootDir || process.cwd();
  const prior = readMissRecords(rootDir);
  let record = input.missId
    ? prior.find((r) => r.missId === input.missId)
    : null;

  if (!record) {
    record = recordMiss({
      rootDir,
      description: input.description,
      beadId: input.beadId,
      source: input.source,
      missId: input.missId,
    });
  }

  const classification = classifyMiss(record.description, prior);
  const earliestDetectionStage = suggestEarliestDetectionStage(classification);
  const proposedInvariant = proposeInvariantUpdate(classification);
  const proposedNegativeTest = proposeNegativeTest(classification);

  const output = {
    missId: record.missId,
    description: record.description,
    beadId: input.beadId || record.beadId || null,
    classification,
    earliestDetectionStage,
    proposedInvariant,
    proposedNegativeTest,
    recurrence: classification.recurrence || { first: true, count: 1, priorMissIds: [] },
    processedAt: new Date().toISOString(),
  };

  updateRecord(rootDir, record.missId, {
    classification,
    earliestDetectionStage,
    proposedInvariant,
    proposedNegativeTest,
    recurrence: output.recurrence,
    beadId: output.beadId,
  });

  return output;
}

export function summarizeLearningLoop(rootDir) {
  const records = readMissRecords(rootDir);
  const byClass = {};
  for (const r of records) {
    const key = r.classification?.classId || 'unclassified';
    byClass[key] = (byClass[key] || 0) + 1;
  }
  return {
    totalMisses: records.length,
    byClass,
    records,
  };
}
