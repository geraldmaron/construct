/**
 * lib/oracle/miss-analysis.mjs — Recurring Oracle miss root-cause classifier.
 *
 * On-demand job that classifies a newly reported miss against the M1–M4 taxonomy
 * from oracle-miss-report.md, detects recurrence against prior learning-loop
 * records, and returns a shape lib/oracle/learning-loop.mjs consumes for its
 * classify and earliest-detection-stage steps. Does not own the full learning
 * loop (record, invariant creation, negative-test generation, bead linking).
 */

import {
  MISS_CLASSES,
  classifyMissDescription,
  earliestDetectionStageForClass,
  missClassById,
} from './miss-classes.mjs';
import { readMissRecords } from './learning-loop.mjs';

/**
 * @param {object} input
 * @param {string} input.description
 * @param {string} [input.rootDir]
 * @param {readonly object[]} [input.priorRecords]
 */
export function classifyMissForAnalysis(input) {
  const description = String(input.description || '').trim();
  if (!description) {
    return {
      ok: false,
      error: 'description required',
    };
  }

  const priorRecords = input.priorRecords ?? readMissRecords(input.rootDir || process.cwd());
  const match = classifyMissDescription(description);

  const classifiedPrior = priorRecords.map((r) => ({
    ...r,
    effectiveClassId: r.classification?.classId || classifyMissDescription(r.description)?.classId || null,
  }));

  if (!match) {
    return {
      ok: true,
      description,
      classification: {
        classId: null,
        className: null,
        confidence: 'low',
        citation: null,
        candidateNewClass: true,
      },
      earliestDetectionStage: 'bounded-semantic-review',
      recurrence: { first: true, count: 0, priorMissIds: [], isRecurrence: false },
      taxonomyVersion: 'oracle-miss-report-2026-07',
    };
  }

  const priorSameClass = classifiedPrior.filter(
    (r) => r.effectiveClassId === match.classId,
  );

  return {
    ok: true,
    description,
    classification: {
      ...match,
      candidateNewClass: false,
    },
    earliestDetectionStage: earliestDetectionStageForClass(match.classId),
    recurrence: {
      first: priorSameClass.length === 0,
      count: priorSameClass.length,
      priorMissIds: priorSameClass.map((r) => r.missId),
      isRecurrence: priorSameClass.length > 0,
    },
    taxonomyVersion: 'oracle-miss-report-2026-07',
    reportCitation: missClassById(match.classId)?.citation || null,
  };
}

export function listMissClasses() {
  return MISS_CLASSES;
}

/**
 * Full analysis pass: classify only (no learning-loop persistence).
 *
 * @param {object} input
 * @param {string} input.description
 * @param {string} [input.rootDir]
 */
export function analyzeMiss(input) {
  return classifyMissForAnalysis(input);
}
