/**
 * lib/assignments/meaningful-change-gate.mjs — deterministic pipeline that
 * gates reasoning-token spend for Standing Assignments (construct-4uxq0.11.4).
 *
 * Six ordered stages run before an assignment invokes a reasoning executor:
 * cursor comparison (upstream revision unchanged), dedup (at-least-once replay),
 * filter evaluation (structural noise removal), content hashing (stable
 * fingerprint of load-bearing inputs), relevance threshold (minimum signal
 * count), and prior-run comparison (same hash as last accepted run). Each
 * stage is pure and returns an explicit skip reason when it blocks proceed.
 *
 * Generalizes spike D's meaningful-change filtering and the workplace loop's
 * fingerprint short-circuit into a reusable surface any trigger kind can call
 * before spending model tokens.
 */

import crypto from 'node:crypto';

import { fingerprintSignalInputs } from '../workplace-loop/fingerprint.mjs';
import { classifyNoiseIssues } from '../workplace-loop/signals.mjs';

export const GATE_STAGE_ORDER = Object.freeze([
  'cursor',
  'dedup',
  'filter',
  'content-hash',
  'relevance',
  'prior-run',
]);

/**
 * @typedef {object} MeaningfulChangeGateInput
 * @property {{ current?: string|null, consumed?: string|null }|null} [cursor]
 * @property {string|null} [dedupKey]
 * @property {Iterable<string>|null} [recentDedupKeys]
 * @property {Array<object>|null} [records]
 * @property {{ applyNoiseFilter?: boolean, bodyMinChars?: number }|null} [filters]
 * @property {number} [relevanceThreshold]
 * @property {{ contentHash?: string|null }|null} [priorRun]
 * @property {object|null} [payload]  arbitrary object hashed when records absent
 */

/**
 * @typedef {object} MeaningfulChangeGateResult
 * @property {boolean} proceed
 * @property {string|null} skippedAtStage
 * @property {string|null} reason
 * @property {string|null} contentHash
 * @property {number} meaningfulCount
 * @property {Array<{ stage: string, passed: boolean, detail?: string }>} stages
 */

function hashPayload(payload) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(payload, Object.keys(payload ?? {}).sort()));
  return hash.digest('hex');
}

function stageCursor(cursor) {
  if (!cursor || cursor.current == null) {
    return { passed: true, detail: 'no-cursor-configured' };
  }
  if (cursor.consumed != null && cursor.current === cursor.consumed) {
    return { passed: false, detail: 'cursor-unchanged' };
  }
  return { passed: true, detail: 'cursor-advanced' };
}

function stageDedup(dedupKey, recentDedupKeys) {
  if (!dedupKey) {
    return { passed: true, detail: 'no-dedup-key' };
  }
  const seen = recentDedupKeys ? new Set(recentDedupKeys) : new Set();
  if (seen.has(dedupKey)) {
    return { passed: false, detail: 'duplicate-delivery' };
  }
  return { passed: true, detail: 'dedup-clear' };
}

function stageFilter(records, filters) {
  if (!Array.isArray(records) || records.length === 0) {
    return { passed: true, meaningfulCount: 0, detail: 'no-records-to-filter' };
  }
  if (filters?.applyNoiseFilter === false) {
    return { passed: true, meaningfulCount: records.length, detail: 'filter-disabled' };
  }
  const noise = classifyNoiseIssues(records, {
    bodyMinChars: filters?.bodyMinChars,
  });
  const noiseRefs = new Set(noise.map((n) => n.ref));
  const meaningfulCount = records.filter((r) => !noiseRefs.has(r.id)).length;
  if (meaningfulCount === 0) {
    return { passed: false, meaningfulCount: 0, detail: 'all-records-filtered-as-noise' };
  }
  return { passed: true, meaningfulCount, detail: `meaningful=${meaningfulCount}` };
}

function stageContentHash(records, payload) {
  if (Array.isArray(records) && records.length > 0) {
    return { passed: true, contentHash: fingerprintSignalInputs(records) };
  }
  if (payload != null) {
    return { passed: true, contentHash: hashPayload(payload) };
  }
  return { passed: true, contentHash: null, detail: 'empty-payload' };
}

function stageRelevance(meaningfulCount, threshold) {
  const min = Number.isFinite(threshold) ? threshold : 0;
  if (meaningfulCount < min) {
    return { passed: false, detail: `below-relevance-threshold (${meaningfulCount}<${min})` };
  }
  return { passed: true, detail: 'relevance-met' };
}

function stagePriorRun(contentHash, priorRun) {
  const prior = priorRun?.contentHash ?? null;
  if (!contentHash || !prior) {
    return { passed: true, detail: 'no-prior-hash' };
  }
  if (contentHash === prior) {
    return { passed: false, detail: 'no-change-since-last-run' };
  }
  return { passed: true, detail: 'content-changed' };
}

/**
 * Run the meaningful-change gate pipeline. Stops at the first failing stage
 * and returns `proceed: false` with `skippedAtStage` set.
 *
 * @param {MeaningfulChangeGateInput} input
 * @returns {MeaningfulChangeGateResult}
 */
export function evaluateMeaningfulChangeGate(input = {}) {
  const stages = [];
  let meaningfulCount = 0;
  let contentHash = null;

  const cursorResult = stageCursor(input.cursor ?? null);
  stages.push({ stage: 'cursor', passed: cursorResult.passed, detail: cursorResult.detail });
  if (!cursorResult.passed) {
    return {
      proceed: false,
      skippedAtStage: 'cursor',
      reason: cursorResult.detail ?? 'cursor-blocked',
      contentHash: null,
      meaningfulCount: 0,
      stages,
    };
  }

  const dedupResult = stageDedup(input.dedupKey ?? null, input.recentDedupKeys ?? null);
  stages.push({ stage: 'dedup', passed: dedupResult.passed, detail: dedupResult.detail });
  if (!dedupResult.passed) {
    return {
      proceed: false,
      skippedAtStage: 'dedup',
      reason: dedupResult.detail ?? 'dedup-blocked',
      contentHash: null,
      meaningfulCount: 0,
      stages,
    };
  }

  const filterResult = stageFilter(input.records ?? null, input.filters ?? null);
  meaningfulCount = filterResult.meaningfulCount ?? 0;
  stages.push({ stage: 'filter', passed: filterResult.passed, detail: filterResult.detail });
  if (!filterResult.passed) {
    return {
      proceed: false,
      skippedAtStage: 'filter',
      reason: filterResult.detail ?? 'filter-blocked',
      contentHash: null,
      meaningfulCount,
      stages,
    };
  }

  const hashResult = stageContentHash(input.records ?? null, input.payload ?? null);
  contentHash = hashResult.contentHash ?? null;
  stages.push({ stage: 'content-hash', passed: hashResult.passed, detail: hashResult.detail });
  if (!hashResult.passed) {
    return {
      proceed: false,
      skippedAtStage: 'content-hash',
      reason: hashResult.detail ?? 'hash-blocked',
      contentHash,
      meaningfulCount,
      stages,
    };
  }

  const relevanceResult = stageRelevance(meaningfulCount, input.relevanceThreshold ?? 0);
  stages.push({ stage: 'relevance', passed: relevanceResult.passed, detail: relevanceResult.detail });
  if (!relevanceResult.passed) {
    return {
      proceed: false,
      skippedAtStage: 'relevance',
      reason: relevanceResult.detail ?? 'relevance-blocked',
      contentHash,
      meaningfulCount,
      stages,
    };
  }

  const priorResult = stagePriorRun(contentHash, input.priorRun ?? null);
  stages.push({ stage: 'prior-run', passed: priorResult.passed, detail: priorResult.detail });
  if (!priorResult.passed) {
    return {
      proceed: false,
      skippedAtStage: 'prior-run',
      reason: priorResult.detail ?? 'prior-run-blocked',
      contentHash,
      meaningfulCount,
      stages,
    };
  }

  return {
    proceed: true,
    skippedAtStage: null,
    reason: null,
    contentHash,
    meaningfulCount,
    stages,
  };
}

/** Reserved skip reason prefix recorded on capability ticks. */
export const MEANINGFUL_CHANGE_SKIP_PREFIX = 'meaningful-change-gate';

/**
 * Build gate input from a capability tick's bound snapshot sections and the
 * assignment's prior attempt state.
 *
 * @param {object} [opts]
 * @param {Array<{ provider: string, items: Array<object> }>} [opts.sections]
 * @param {object|null} [opts.assignmentState]
 * @param {string|null} [opts.dedupKey]
 */
export function buildCapabilityTickGateInput({
  sections = [],
  assignmentState = null,
  dedupKey = null,
} = {}) {
  const flatItems = [];
  for (const section of sections) {
    for (const item of section.items ?? []) {
      flatItems.push({
        ...item,
        id: item.id ?? `${section.provider}:${flatItems.length}`,
        body: item.body ?? item.summary ?? item.description ?? item.title ?? '',
      });
    }
  }

  return {
    dedupKey,
    records: flatItems.length > 0 ? flatItems : null,
    payload: flatItems.length === 0 ? { sections } : null,
    filters: { applyNoiseFilter: false },
    relevanceThreshold: 0,
    priorRun: assignmentState?.lastContentHash ? { contentHash: assignmentState.lastContentHash } : null,
  };
}
