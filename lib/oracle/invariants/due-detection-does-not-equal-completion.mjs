/**
 * lib/oracle/invariants/due-detection-does-not-equal-completion.mjs — Layer 2
 * change-aware invariant: a job that detects a directive is due must not advance
 * the durable lastRunAt ledger unless it also executes or explicitly hands off to
 * an executor — otherwise downstream readers treat "not due" as "completed."
 *
 * Per the oracle-miss-report's row 8 (due-stamp-before-execution): the embed
 * daemon's directive-runner writes lastRunAt on due-detection alone while Oracle's
 * read-model reads the same due-tracker state — a cross-module ordering contract
 * that single-module review cannot see but a Layer 2 state-writer→state-reader
 * coupling can. This check statically analyzes the directive-runner scheduler
 * block in lib/embed/daemon.mjs without importing or running the daemon.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { splitIntoJobBlocks } from './analysis-success-requires-execution-evidence.mjs';

export const id = 'due-detection-does-not-equal-completion';
export const layer = 2;
export const description =
  'A directive due-detection job must not stamp lastRunAt unless it also executes the directive or explicitly hands off to an executor that will.';

const EXECUTION_MARKERS = [
  /\bexecuteDirective\s*\(/,
  /\bdrainApprovedWriteIntents\s*\(/,
  /\bwriteWithEnvelope\s*\(/,
];

/**
 * @param {string} block directive-runner scheduler job source text
 * @returns {{stampsLastRunAt: boolean, hasExecutionHandoff: boolean, detail: string}}
 */
export function analyzeDirectiveRunnerBlock(block) {
  const stampsLastRunAt = /\bwriteDirectiveState\s*\(/.test(block);
  const hasExecutionHandoff = EXECUTION_MARKERS.some((marker) => marker.test(block));
  let detail = 'directive-runner block carries no writeDirectiveState call';
  if (stampsLastRunAt && !hasExecutionHandoff) {
    detail = 'directive-runner stamps lastRunAt on due-detection without an execution or explicit handoff marker in the same job block';
  } else if (stampsLastRunAt && hasExecutionHandoff) {
    detail = 'directive-runner stamps lastRunAt alongside an execution or handoff marker';
  } else if (!stampsLastRunAt) {
    detail = 'directive-runner does not stamp lastRunAt in this block';
  }
  return { stampsLastRunAt, hasExecutionHandoff, detail };
}

/**
 * @param {{cwd?: string, daemonPath?: string}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  daemonPath = path.join(cwd, 'lib', 'embed', 'daemon.mjs'),
} = {}) {
  let source;
  try {
    source = readFileSync(daemonPath, 'utf8');
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to read ${daemonPath}: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const jobBlocks = splitIntoJobBlocks(source);
  const directiveBlock = jobBlocks.find((b) => b.jobId === 'directive-runner');
  if (!directiveBlock) {
    return {
      status: 'unknown',
      detail: 'directive-runner scheduler job not found in daemon source',
      evaluated: 0,
      violations: [],
      unresolved: [{ job: 'directive-runner', detail: 'job block missing' }],
      results: [],
    };
  }

  const analysis = analyzeDirectiveRunnerBlock(directiveBlock.block);
  if (!analysis.stampsLastRunAt) {
    return {
      status: 'passed',
      evaluated: 1,
      violations: [],
      unresolved: [],
      results: [{ job: 'directive-runner', status: 'passed', detail: analysis.detail }],
    };
  }

  if (analysis.hasExecutionHandoff) {
    return {
      status: 'passed',
      evaluated: 1,
      violations: [],
      unresolved: [],
      results: [{ job: 'directive-runner', status: 'passed', detail: analysis.detail }],
    };
  }

  const violation = {
    job: 'directive-runner',
    status: 'failed',
    violation: true,
    detail: analysis.detail,
    coupledReaders: ['lib/oracle/read-model.mjs'],
  };
  return {
    status: 'failed',
    evaluated: 1,
    violations: [violation],
    unresolved: [],
    results: [violation],
  };
}
