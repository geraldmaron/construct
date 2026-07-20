/**
 * lib/graph/verify.mjs — blocking graph guardrail for local hooks and CI.
 *
 * Composes strict structural validation (`validateGraph`), schema membership and
 * provenance checks (`validateSchema`), partial-graph detection, and an optional
 * change-intent impact diff when changed files are supplied.
 */

import { loadGraph } from './store.mjs';
import { validateGraph } from './validate.mjs';
import { validateSchema } from './schema.mjs';
import { computeImpacted } from './impacted.mjs';
import { listChangeIntents, loadChangeIntent } from './change-intent.mjs';

function normalizeChangedFiles(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(/\s+/);
  return list.map((f) => String(f).trim().replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean);
}

function pickIntent({ rootDir, intentId }) {
  if (intentId) return loadChangeIntent({ rootDir, intentId });
  const intents = listChangeIntents({ rootDir }).filter((i) => i.status === 'declared');
  return intents[0] || null;
}

function packetFields(packet) {
  return {
    impactedWorkflows: [...(packet?.impactedWorkflows || [])].sort(),
    impactedTests: [...(packet?.impactedTests || [])].sort(),
    impactedDocs: [...(packet?.impactedDocs || [])].sort(),
    impactedCapabilities: [...(packet?.impactedCapabilities || [])].sort(),
  };
}

function verifyChangeIntentImpact({ rootDir, changedFiles, intentId }) {
  const intent = pickIntent({ rootDir, intentId });
  if (!intent) return { ok: true, violations: [] };

  const actual = computeImpacted({ rootDir, changedFiles });
  const expected = intent.packet || {};
  const violations = [];
  const fields = ['impactedWorkflows', 'impactedTests', 'impactedDocs', 'impactedCapabilities'];

  for (const field of fields) {
    const left = packetFields(actual)[field];
    const right = packetFields(expected)[field];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      violations.push({
        kind: 'change-intent',
        message: `change-intent '${intent.id}' impact mismatch on ${field}: declared ${JSON.stringify(right)} vs actual ${JSON.stringify(left)}`,
      });
    }
  }

  return { ok: violations.length === 0, violations, intentId: intent.id };
}

/**
 * @param {string} rootDir
 * @param {object} [opts]
 * @param {string[]|string} [opts.changedFiles]
 * @param {string} [opts.intentId]
 * @param {string} [opts.packageRoot] — Construct package root for registry-seeded disk checks when projectDir differs.
 * @returns {{ ok: boolean, violations: { kind: string, message: string }[], intentId?: string|null }}
 */
export function verifyGraph(rootDir, { changedFiles = [], intentId = null, packageRoot = null } = {}) {
  const violations = [];
  const graph = loadGraph(rootDir);

  if (!graph.exists) {
    violations.push({ kind: 'missing-graph', message: 'no graph found — run construct graph build first' });
    return { ok: false, violations, intentId: null };
  }

  if (graph.meta?.partial === true) {
    const reasons = Array.isArray(graph.meta.partialReasons) ? graph.meta.partialReasons : [];
    const detail = reasons.length ? reasons.join('; ') : 'unknown reason';
    violations.push({ kind: 'partial-graph', message: `living graph is partial: ${detail}` });
  }

  for (const message of validateSchema(graph).errors) {
    violations.push({ kind: 'schema', message });
  }

  for (const message of validateGraph(rootDir, { strict: true, packageRoot: packageRoot || rootDir }).errors) {
    violations.push({ kind: 'validate', message });
  }

  const files = normalizeChangedFiles(changedFiles);
  let resolvedIntentId = null;
  if (files.length) {
    const intentCheck = verifyChangeIntentImpact({ rootDir, changedFiles: files, intentId });
    violations.push(...intentCheck.violations);
    resolvedIntentId = intentCheck.intentId || null;
  }

  return { ok: violations.length === 0, violations, intentId: resolvedIntentId };
}
