/**
 * lib/embedded-contract/role-facts.mjs — shared role/contract enrichment.
 *
 * Both the triage/planning and workflow-invocation contracts need the same
 * facts about a role chain: per-role rationale, the union of declared skills,
 * and the evidence a role requires plus the outputs it must produce. Those facts
 * come only from verifiable sources — the role catalog (registry) and the
 * specialist contracts — so this module centralizes the lookups and keeps the
 * two contracts consistent and free of invented requirements.
 */

import { listRoles } from '../roles/catalog.mjs';
import { getIncomingContracts } from '../specialist-contracts.mjs';

/**
 * Map of role id → catalog descriptor for the current registry.
 * @returns {Map<string, object>}
 */
export function roleMap() {
  return new Map(listRoles().map((role) => [role.id, role]));
}

/**
 * Per-role rationale for a chain, drawn from each role's catalog description.
 *
 * @param {string[]} chain
 * @param {Map<string,object>} [map]
 * @returns {Array<{role:string, reason:string}>}
 */
export function roleRationale(chain, map = roleMap()) {
  return chain.map((id) => ({
    role: `cx-${id}`,
    reason: map.get(id)?.description || 'No role description available.',
  }));
}

/**
 * Union of declared skills across a role chain, de-duplicated.
 *
 * @param {string[]} chain
 * @param {Map<string,object>} [map]
 * @returns {string[]}
 */
export function skillsForChain(chain, map = roleMap()) {
  return [...new Set(chain.flatMap((id) => map.get(id)?.skills || []))];
}

/**
 * Evidence a role requires and the outputs it must produce, taken from the
 * role's incoming specialist contract (input.mustContain + preconditions /
 * output.mustContain). Returns empty arrays when no contract is declared.
 *
 * @param {string} roleId   Bare role id (no cx- prefix).
 * @returns {{evidenceRequirements:string[], expectedOutputs:string[]}}
 */
export function contractFacts(roleId) {
  const contracts = getIncomingContracts(`cx-${roleId}`) || [];
  const evidence = new Set();
  const outputs = new Set();
  for (const c of contracts) {
    for (const item of c.input?.mustContain || []) evidence.add(item);
    for (const pre of c.preconditions || []) evidence.add(pre);
    for (const item of c.output?.mustContain || []) outputs.add(item);
  }
  return { evidenceRequirements: [...evidence], expectedOutputs: [...outputs] };
}
