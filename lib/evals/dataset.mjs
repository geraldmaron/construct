/**
 * lib/evals/dataset.mjs — provenance-backed evaluation dataset: validation,
 * leakage-safe splitting, expiry, and held-out selection.
 *
 * A dataset item carries the provenance the governed improvement loop needs to
 * evaluate a candidate on data it did not generate: source trace ids, human-label
 * provenance, redaction state, a capability snapshot, the allowed tools, the
 * expected evidence and contract behavior, a split assignment, and an expiry.
 * Split assignment is deterministic and keyed on task family plus source trace, so
 * every item from one trace lands in the same split — a candidate's generating
 * trace can never leak across the train/dev/test boundary. selectEvalSet then
 * strips the generating trace, near-duplicates, and the same user correction from
 * the evaluation set so a candidate is never scored on its own origin. Reference
 * shape: schemas/eval-dataset.schema.json.
 */
import crypto from 'node:crypto';

export const EVAL_DATASET_SCHEMA_VERSION = 1;

export const DATASET_SPLITS = Object.freeze(['train', 'dev', 'test']);
export const REDACTION_STATES = Object.freeze(['raw', 'redacted', 'synthetic']);
export const EVIDENCE_REQUIREMENTS = Object.freeze(['none', 'preferred', 'required']);
export const LABEL_PROVENANCE = Object.freeze(['human', 'model-assisted', 'unlabeled']);
export const CONTRACT_OUTCOMES = Object.freeze(['pass', 'fail', 'blocker', 'handoff']);
export const CAPABILITY_CLASSES = Object.freeze(['hosted-direct', 'hosted-routed', 'local-capable', 'local-constrained', 'unknown']);

function hashBucket(text) {
  const digest = crypto.createHash('sha256').update(String(text)).digest();
  return digest.readUInt32BE(0) % 100;
}

function normalizePrompt(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function promptOf(item) {
  return item?.taskInput?.prompt ?? item?.prompt ?? '';
}

export function nearDuplicateKey(item) {
  const normalized = normalizePrompt(promptOf(item));
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function primarySourceTrace(item) {
  return Array.isArray(item?.sourceTraceIds) && item.sourceTraceIds.length ? item.sourceTraceIds[0] : null;
}

/**
 * Deterministically assign a split. The bucket is keyed on task family plus the
 * item's primary source trace, so all items sharing a trace co-locate in one
 * split. devRatio/testRatio are fractions of the bucket space; the remainder is
 * train.
 */
export function assignSplit(item, { devRatio = 0.15, testRatio = 0.15 } = {}) {
  const trace = primarySourceTrace(item) || item?.id || '';
  const bucket = hashBucket(`${item?.taskFamily || ''}:${trace}`);
  const testCut = Math.round(testRatio * 100);
  const devCut = testCut + Math.round(devRatio * 100);
  if (bucket < testCut) return 'test';
  if (bucket < devCut) return 'dev';
  return 'train';
}

export function isExpired(item, nowIso) {
  if (!item?.expiry || !nowIso) return false;
  return String(item.expiry) <= String(nowIso);
}

/**
 * Strip every item that would leak into a candidate's evaluation: the candidate's
 * own generating / source traces, a near-duplicate task input, and the same user
 * correction. This is the held-out guarantee.
 */
export function excludeLeakage(items, candidate = {}) {
  const list = Array.isArray(items) ? items : [];
  const generatingTraces = new Set([
    ...(Array.isArray(candidate.generatingTraceIds) ? candidate.generatingTraceIds : []),
    ...(Array.isArray(candidate.sourceTraceIds) ? candidate.sourceTraceIds : []),
  ]);
  const candidateDupKey = nearDuplicateKey(candidate);
  const candidateCorrection = candidate.correctionId ?? candidate.humanLabel?.correctionId ?? null;

  return list.filter((item) => {
    const traces = Array.isArray(item?.sourceTraceIds) ? item.sourceTraceIds : [];
    if (traces.some((t) => generatingTraces.has(t))) return false;
    if (candidateDupKey && nearDuplicateKey(item) === candidateDupKey) return false;
    const correction = item?.humanLabel?.correctionId ?? null;
    if (candidateCorrection && correction && correction === candidateCorrection) return false;
    return true;
  });
}

/**
 * Build the evaluation set for a candidate: the items in the requested split,
 * minus expired items, minus anything that would leak (excludeLeakage).
 */
export function selectEvalSet(items, candidate = {}, { split = 'test', nowIso = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const inSplit = list.filter((item) => item?.split === split && !isExpired(item, nowIso));
  return excludeLeakage(inSplit, candidate);
}

/**
 * Hand-rolled validator (no ajv — Construct stays dependency-free at startup).
 * Returns { valid, errors } against schemas/eval-dataset.schema.json.
 */
export function validateDatasetItem(item) {
  const errors = [];
  if (!item || typeof item !== 'object') return { valid: false, errors: ['item is not an object'] };
  if (item.schemaVersion !== EVAL_DATASET_SCHEMA_VERSION) errors.push(`schemaVersion must be ${EVAL_DATASET_SCHEMA_VERSION}`);
  if (typeof item.id !== 'string' || !item.id) errors.push('id required');
  if (typeof item.taskFamily !== 'string' || !item.taskFamily) errors.push('taskFamily required');
  if (!item.taskInput || typeof item.taskInput.prompt !== 'string') errors.push('taskInput.prompt required');

  if (!item.capabilitySnapshot || !CAPABILITY_CLASSES.includes(item.capabilitySnapshot.capabilityClass)) {
    errors.push('capabilitySnapshot.capabilityClass invalid');
  }
  if (!Array.isArray(item.allowedTools)) errors.push('allowedTools must be an array');

  const ev = item.expectedEvidenceBehavior;
  if (!ev || !EVIDENCE_REQUIREMENTS.includes(ev.requirement) || typeof ev.citationsRequired !== 'boolean') {
    errors.push('expectedEvidenceBehavior invalid');
  }
  if (!item.expectedContractResult || !CONTRACT_OUTCOMES.includes(item.expectedContractResult.outcome)) {
    errors.push('expectedContractResult.outcome invalid');
  }
  if (!item.redaction || !REDACTION_STATES.includes(item.redaction.state)) errors.push('redaction.state invalid');

  if (!Array.isArray(item.sourceTraceIds) || item.sourceTraceIds.length < 1) errors.push('sourceTraceIds must be non-empty');
  if (!item.humanLabel || !LABEL_PROVENANCE.includes(item.humanLabel.provenance)) errors.push('humanLabel.provenance invalid');
  if (!DATASET_SPLITS.includes(item.split)) errors.push(`split invalid: ${item.split}`);
  if (item.expiry !== null && typeof item.expiry !== 'string') errors.push('expiry must be an ISO string or null');

  return { valid: errors.length === 0, errors };
}
