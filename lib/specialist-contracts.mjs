/**
 * lib/specialist-contracts.mjs — loader + query layer for specialists/unified-registry.json contracts.
 *
 * Agent contracts are explicit service contracts between Construct roles —
 * "when cx-product-manager hands off to cx-architect, the packet MUST contain
 * X and the response MUST be shape Y." Single machine-readable source of
 * truth for handoff schemas, doc ownership, specialist mappings, and the
 * framing/research gates.
 *
 * Consumed by:
 *   - lib/orchestration-policy.mjs → routeRequest returns the contract chain
 *     for a request, not just a list of specialists.
 *   - lib/mcp/server.mjs → exposes agent_contract MCP tool for specialists
 *     to introspect their inputs and expected outputs at handoff time.
 *   - future: handoff validators that check packet shape before dispatch.
 */
import { loadRegistry } from './registry/loader.mjs';

let _cache = null;

function loadRaw() {
  if (_cache) return _cache;
  const registry = loadRegistry();
  const contracts = Object.values(registry.contracts || {});
  _cache = { version: 2, contracts };
  return _cache;
}

export function getAllContracts() {
  return loadRaw().contracts || [];
}

export function getContractById(id) {
  return getAllContracts().find((c) => c.id === id) || null;
}

/**
 * Returns the contract for a specific producer→consumer pair. If multiple
 * contracts match (e.g. wildcard producer "*"), returns the most specific one.
 */
export function getContract(producer, consumer) {
  const all = getAllContracts();
  const exact = all.find((c) => c.producer === producer && c.consumer === consumer);
  if (exact) return exact;
  return all.find((c) => (c.producer === '*' && c.consumer === consumer)) || null;
}

/**
 * Returns all contracts where the given agent is the consumer — the set of
 * inbound packets the agent is expected to receive from upstream producers.
 */
export function getIncomingContracts(consumer) {
  return getAllContracts().filter((c) => c.consumer === consumer);
}

/**
 * Returns all contracts where the given agent is the producer — the set of
 * outbound packets the agent is expected to send to downstream consumers.
 */
export function getOutgoingContracts(producer) {
  return getAllContracts().filter((c) => c.producer === producer || c.producer === '*');
}

/**
 * Matches contracts whose `trigger` is satisfied by the given routing
 * context. Surfaces which contracts apply to a dispatch plan so routeRequest
 * can attach them to the response.
 *
 * Trigger language:
 *   { always: true }                              → always fires
 *   { intent: "fix" | ["fix","investigation"] }    → intent match
 *   { workCategory: "deep" }                       → work category match
 *   { track: "orchestrated" }                      → execution track match
 *   { riskFlags: ["security"] }                    → any-of risk flags set
 *   { "framingChallenge.required": true }          → gate required
 *   { "externalResearch.required": true }          → gate required
 *   { "docAuthoring.docType": ["prd","adr"] }      → authoring intent match
 *   { postConsumer: true, changedCoreDocs: true }  → fires after consumer ran and core docs changed
 */
export function triggerMatches(contract, ctx = {}) {
  const t = contract.trigger || {};
  if (t.always === true) return true;

  // intent: string | string[]
  if (t.intent) {
    const intents = Array.isArray(t.intent) ? t.intent : [t.intent];
    if (!intents.includes(ctx.intent)) return false;
  }
  if (t.workCategory) {
    const cats = Array.isArray(t.workCategory) ? t.workCategory : [t.workCategory];
    if (!cats.includes(ctx.workCategory)) return false;
  }
  if (t.track) {
    const tracks = Array.isArray(t.track) ? t.track : [t.track];
    if (!tracks.includes(ctx.track)) return false;
  }
  if (Array.isArray(t.riskFlags)) {
    const anyMatch = t.riskFlags.some((flag) => ctx.riskFlags?.[flag]);
    if (!anyMatch) return false;
  }
  if (t['framingChallenge.required'] === true) {
    if (!ctx.framingChallenge?.required) return false;
  }
  if (t['externalResearch.required'] === true) {
    if (!ctx.externalResearch?.required) return false;
  }
  if (t['docAuthoring.docType']) {
    const docTypes = Array.isArray(t['docAuthoring.docType'])
      ? t['docAuthoring.docType']
      : [t['docAuthoring.docType']];
    if (!ctx.docAuthoring?.docType || !docTypes.includes(ctx.docAuthoring.docType)) return false;
  }
  // Post-consumer contracts (e.g. docs-keeper) fire as side effects, not
  // from the initial routing decision. They're returned by
  // resolveContractChain but marked so callers can defer them.
  return true;
}

function contractParticipantsApply(contract, ctx = {}) {
  const specialists = Array.isArray(ctx.specialists) ? ctx.specialists : null;
  if (!specialists) return true;

  const participants = new Set(['user', 'construct', ...specialists]);
  const producerApplies = contract.producer === '*' || participants.has(contract.producer);
  const consumerApplies = participants.has(contract.consumer);
  return producerApplies && consumerApplies;
}

/**
 * Returns the ordered contract chain that applies to a routing context.
 * Each element is `{ contract, stage }` where stage is "precheck" (runs
 * before work begins), "handoff" (runs between specialists), or "followup"
 * (runs after DONE, e.g. docs-keeper).
 */
export function resolveContractChain(ctx = {}) {
  const chain = [];
  for (const contract of getAllContracts()) {
    if (!triggerMatches(contract, ctx)) continue;
    if (!contractParticipantsApply(contract, ctx)) continue;
    const stage = contract.trigger?.postConsumer ? 'followup'
      : contract.producer === 'user' ? 'precheck'
      : 'handoff';
    chain.push({ contract, stage });
  }
  return chain;
}

function isPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Lightweight shape validation for handoff packets. Checks three shapes:
 *   mustContain     — every key must be present (non-null, non-empty-string).
 *   mustContainOneOf — array of OR groups; at least one field in each group
 *                      must be present. Missing entries report joined keys:
 *                      ["findings", "noIssuesFoundAt"] → "findings|noIssuesFoundAt".
 *   mustMatchEnum   — map of key → allowed values. Mismatch reports
 *                      "<key>!=<allowed>" so callers can branch on it.
 *
 * Empty arrays and empty objects count as present — they signal "declared
 * but empty," a legitimate state. Use `mustHaveNonEmpty` in a future spec
 * if you need a stricter check.
 */
export function validatePacket(contractId, packet, direction = 'input') {
  const contract = getContractById(contractId);
  if (!contract) return { ok: false, reason: 'contract-not-found', contractId };
  const spec = direction === 'input' ? contract.input : contract.output;
  if (!spec) return { ok: true, contract, direction };

  const missing = [];

  if (Array.isArray(spec.mustContain)) {
    for (const key of spec.mustContain) {
      if (!isPresent(packet?.[key])) missing.push(key);
    }
  }

  if (Array.isArray(spec.mustContainOneOf)) {
    for (const group of spec.mustContainOneOf) {
      if (!Array.isArray(group) || group.length === 0) continue;
      const anyPresent = group.some((key) => isPresent(packet?.[key]));
      if (!anyPresent) missing.push(group.join('|'));
    }
  }

  if (spec.mustMatchEnum && typeof spec.mustMatchEnum === 'object') {
    for (const [key, allowed] of Object.entries(spec.mustMatchEnum)) {
      if (!Array.isArray(allowed) || allowed.length === 0) continue;
      const value = packet?.[key];
      if (value === undefined || value === null) continue;
      if (!allowed.includes(value)) missing.push(`${key}!=${allowed.join('|')}`);
    }
  }

  return { ok: missing.length === 0, missing, contract, direction };
}

/**
 * Summary statistics for `construct status` / `construct doctor` surfaces.
 */
export function summarize() {
  const all = getAllContracts();
  const byProducer = {};
  const byConsumer = {};
  for (const c of all) {
    byProducer[c.producer] = (byProducer[c.producer] || 0) + 1;
    byConsumer[c.consumer] = (byConsumer[c.consumer] || 0) + 1;
  }
  return {
    total: all.length,
    producers: Object.keys(byProducer).length,
    consumers: Object.keys(byConsumer).length,
    byProducer,
    byConsumer,
  };
}
