/**
 * lib/orchestration/routing-triggers.mjs — generic, registry-driven trigger
 * evaluator for persona/domain routing rules (construct-uizpv.4).
 *
 * Replaces the hardcoded isLegalComplianceRequest() keyword list and the
 * flow-selection.mjs `return ['security']` special-case with declarative
 * records: { id, match: { keywords, riskFlags, artifactTypes }, chain,
 * position }. A record matches when the request text contains any declared
 * keyword, any declared risk flag is truthy, or the resolved doc-authoring
 * artifact type is in the declared list. Adding a new domain trigger or an
 * extra risk-flag dimension is a registry data change; this module is the one
 * generic evaluator every caller shares. Canonical records live in
 * registry/routing-triggers.json; a project may append/override via
 * .construct/orchestration/routing-triggers.json (last-writer-wins on id),
 * mirroring the signal-dimensions.mjs overlay convention.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProjectRoot } from '../project-root.mjs';
import { configPath } from '../config-dir.mjs';
import { containsAny } from './classification.mjs';

const REGISTRY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'registry', 'routing-triggers.json');

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function loadCanonical() {
  const data = readJsonSafe(REGISTRY_PATH) || {};
  return {
    riskFlagDimensions: Array.isArray(data.riskFlagDimensions) ? data.riskFlagDimensions : [],
    triggers: Array.isArray(data.triggers) ? data.triggers : [],
  };
}

function loadOverlay() {
  const root = findProjectRoot();
  if (!root) return { riskFlagDimensions: [], triggers: [] };
  const overlayPath = configPath(root, 'orchestration', 'routing-triggers.json');
  if (!existsSync(overlayPath)) return { riskFlagDimensions: [], triggers: [] };
  const data = readJsonSafe(overlayPath) || {};
  return {
    riskFlagDimensions: Array.isArray(data.riskFlagDimensions) ? data.riskFlagDimensions : [],
    triggers: Array.isArray(data.triggers) ? data.triggers : [],
  };
}

let cache = null;

function tables() {
  if (cache) return cache;
  const canonical = loadCanonical();
  const overlay = loadOverlay();

  const dimensionsByKey = new Map();
  for (const dim of canonical.riskFlagDimensions) {
    if (dim && typeof dim.key === 'string' && Array.isArray(dim.keywords)) dimensionsByKey.set(dim.key, dim);
  }
  for (const dim of overlay.riskFlagDimensions) {
    if (dim && typeof dim.key === 'string' && Array.isArray(dim.keywords)) dimensionsByKey.set(dim.key, dim);
  }

  const triggersById = new Map();
  for (const trigger of canonical.triggers) {
    if (trigger && typeof trigger.id === 'string') triggersById.set(trigger.id, trigger);
  }
  for (const trigger of overlay.triggers) {
    if (trigger && typeof trigger.id === 'string') triggersById.set(trigger.id, trigger);
  }

  cache = {
    riskFlagDimensions: Array.from(dimensionsByKey.values()),
    triggers: Array.from(triggersById.values()),
  };
  return cache;
}

export function clearRoutingTriggersCache() {
  cache = null;
}

/**
 * Extra risk-flag booleans declared by registry data, merged onto
 * detectRiskFlags()'s fixed enum in classification.mjs so a persona can add a
 * new risk flag without a lib/ edit.
 */
export function extraRiskFlags(request = '') {
  const text = String(request).toLowerCase();
  const out = {};
  for (const { key, keywords } of tables().riskFlagDimensions) {
    out[key] = containsAny(text, keywords);
  }
  return out;
}

function triggerMatches(trigger, { text, riskFlags = {}, docType = null } = {}) {
  const match = trigger?.match || {};
  if (Array.isArray(match.keywords) && match.keywords.length && containsAny(text, match.keywords)) return true;
  if (Array.isArray(match.riskFlags) && match.riskFlags.some((flag) => Boolean(riskFlags[flag]))) return true;
  if (Array.isArray(match.artifactTypes) && docType && match.artifactTypes.includes(docType)) return true;
  return false;
}

/**
 * All registry triggers whose match declaration fires for this request.
 * Each returned record carries its declared `chain` and `position`
 * ("prepend" | "append", default "prepend").
 */
export function matchRoutingTriggers(request = '', { riskFlags = {}, docType = null } = {}) {
  const text = String(request).toLowerCase();
  return tables().triggers.filter((trigger) => triggerMatches(trigger, { text, riskFlags, docType }));
}

/**
 * Whether a specific named trigger fires for this request, for callers that
 * need a single boolean rather than the full match list.
 */
export function routingTriggerFires(id, request = '', context = {}) {
  return matchRoutingTriggers(request, context).some((trigger) => trigger.id === id);
}

/**
 * The Worker Profile chain a matched trigger requires for a focused-track
 * dispatch, or null when nothing matches. Replaces the flow-selection.mjs
 * `return ['security']` hardcode: the chain is registry data, not code.
 */
export function focusedRoutingChain(request = '', context = {}) {
  const [first] = matchRoutingTriggers(request, context);
  return first ? [...first.chain] : null;
}

/**
 * Apply every matched trigger's chain to a Worker Profile list, honoring each
 * trigger's declared prepend/append position. Skips ids already present.
 */
export function applyRoutingTriggerAugmentation(workerProfiles = [], request = '', context = {}) {
  let list = [...workerProfiles];
  for (const trigger of matchRoutingTriggers(request, context)) {
    const additions = (trigger.chain || []).filter((id) => !list.includes(id));
    if (additions.length === 0) continue;
    list = trigger.position === 'append' ? [...list, ...additions] : [...additions, ...list];
  }
  return list;
}
