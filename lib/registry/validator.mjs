/**
 * lib/registry/validator.mjs — Validate the canonical Construct registry.
 *
 * Validation is fail-closed at the public owner boundary: retired peer fields,
 * unknown top-level fields, dangling references, prefixed worker identities,
 * and duplicate ids are errors. The validator does not translate an older
 * public shape or preserve aliases.
 *
 * Worker Profile display fields: `id` is the list/CLI key; list labels are
 * derived from `id` at render time; `displayName` and optional `tagline` are
 * perspective taglines for show surfaces (see lib/registry/catalog-format.mjs).
 */

import { resolveContractEnforcement } from '../contracts/enforcement.mjs';

const REQUIRED_FIELDS = ['schemaVersion', 'workspacePresets', 'workerProfiles', 'procedures', 'capabilities', 'policies'];
// Compat surface (owner: construct-tsyfe.8.18, expires: 2026-12-31): reject retired
// top-level registry keys (including specialists) with no silent alias reads.
const RETIRED_FIELDS = ['teams', 'groups', 'specialists', 'contracts', 'roles', 'personas', 'scopes', 'workflows'];
const ENTITY_FIELDS = {
  workspacePresets: new Set(['id', 'displayName', 'tagline', 'skills', 'procedures', 'intake', 'artifactClasses', 'hooks', 'toneDefaults', 'researchProfiles', 'rebrand', 'capabilities', 'experimental']),
  workerProfiles: new Set(['id', 'displayName', 'tagline', 'description', 'runtime', 'modelTier', 'reasoningEffort', 'skillEmphasis', 'procedureAffinity', 'capabilities', 'policyFence', 'events', 'artifactClasses', 'watchConditions', 'permissions', 'participationRules', 'toolGrants', 'webAccess', 'manualOnly']),
  procedures: new Set(['id', 'version', 'type', 'workerProfiles', 'approvalMode', 'modelTier', 'state', 'modes', 'surfaces', 'description', 'outputSchema', 'durableStateModel', 'intakeType', 'embed']),
  capabilities: new Set(['id', 'name', 'description', 'criticality', 'ownerWorkerProfiles', 'requiredSkills', 'requiredProcedures', 'contracts', 'state', 'surfaces', 'verification', 'humanGate', 'lastValidated']),
  policies: new Set(['id', 'ownerWorkerProfile', 'description', 'enforcement', 'mode', 'approvalWorkerProfiles', 'requiredPolicies', 'vetoWorkerProfiles', 'escalationWorkerProfiles', 'governs', 'conditions', 'evidence']),
};
const CONTRACT_FIELDS = new Set(['id', 'producer', 'consumer', 'trigger', 'input', 'output', 'preconditions', 'postconditions', 'description', 'skillHints', 'enforcementLevel', 'approvalWorkerProfiles']);

function issue(id, message, location) {
  return { id, severity: 'error', message, location };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkShape(registry) {
  const errors = [];
  if (registry.schemaVersion !== 1) {
    errors.push(issue('invalid-schema-version', `schemaVersion must be 1, got ${registry.schemaVersion}`, '#/schemaVersion'));
  }
  for (const field of REQUIRED_FIELDS.slice(1)) {
    if (!isRecord(registry[field])) errors.push(issue(`missing-${field}`, `${field} must be an object`, `#/${field}`));
  }
  for (const field of RETIRED_FIELDS) {
    if (field in registry) errors.push(issue('retired-registry-field', `${field} is not part of the canonical registry`, `#/${field}`));
  }
  for (const field of Object.keys(registry)) {
    if (!REQUIRED_FIELDS.includes(field)) errors.push(issue('unknown-registry-field', `Unknown registry field: ${field}`, `#/${field}`));
  }
  return errors;
}

function checkMapIdentity(sectionName, entries) {
  const errors = [];
  const seen = new Set();
  for (const [key, entry] of Object.entries(entries)) {
    if (!isRecord(entry)) {
      errors.push(issue('invalid-registry-entry', `${sectionName}.${key} must be an object`, `#/${sectionName}/${key}`));
      continue;
    }
    if (entry.id !== key) errors.push(issue('registry-id-mismatch', `${sectionName}.${key} declares id ${entry.id}`, `#/${sectionName}/${key}/id`));
    if (seen.has(entry.id)) errors.push(issue('duplicate-registry-id', `Duplicate ${sectionName} id: ${entry.id}`, `#/${sectionName}/${key}/id`));
    seen.add(entry.id);
    for (const field of Object.keys(entry)) {
      if (!ENTITY_FIELDS[sectionName].has(field)) errors.push(issue('unknown-entity-field', `Unknown field ${sectionName}.${key}.${field}`, `#/${sectionName}/${key}/${field}`));
    }
    if (sectionName === 'capabilities') {
      for (const [contractId, contract] of Object.entries(entry.contracts || {})) {
        for (const field of Object.keys(contract)) {
          if (!CONTRACT_FIELDS.has(field)) errors.push(issue('unknown-contract-field', `Unknown field in ${key}.${contractId}: ${field}`, `#/capabilities/${key}/contracts/${contractId}/${field}`));
        }
      }
    }
  }
  return errors;
}

function checkReferences(registry) {
  const errors = [];
  const profileIds = new Set(Object.keys(registry.workerProfiles));
  const procedureIds = new Set(Object.keys(registry.procedures));
  const capabilityIds = new Set(Object.keys(registry.capabilities));
  const policyIds = new Set(Object.keys(registry.policies));
  const validParties = new Set(['user', 'construct', '*', ...profileIds]);

  for (const [id, profile] of Object.entries(registry.workerProfiles)) {
    if (/^cx-/.test(id)) errors.push(issue('prefixed-worker-profile-id', `Worker Profile id must not use cx-: ${id}`, `#/workerProfiles/${id}`));
    for (const procedureId of profile.procedureAffinity || []) {
      if (!procedureIds.has(procedureId)) errors.push(issue('worker-profile-unknown-procedure', `${id} references unknown Procedure ${procedureId}`, `#/workerProfiles/${id}/procedureAffinity`));
    }
    for (const capabilityId of profile.capabilities || []) {
      if (!capabilityIds.has(capabilityId)) errors.push(issue('worker-profile-unknown-capability', `${id} references unknown Capability ${capabilityId}`, `#/workerProfiles/${id}/capabilities`));
    }
  }

  for (const [id, preset] of Object.entries(registry.workspacePresets)) {
    for (const procedureId of preset.procedures || []) {
      if (!procedureIds.has(procedureId)) errors.push(issue('workspace-preset-unknown-procedure', `${id} references unknown Procedure ${procedureId}`, `#/workspacePresets/${id}/procedures`));
    }
  }

  for (const [id, procedure] of Object.entries(registry.procedures)) {
    for (const profileId of procedure.workerProfiles || []) {
      if (!profileIds.has(profileId)) errors.push(issue('procedure-unknown-worker-profile', `${id} references unknown Worker Profile ${profileId}`, `#/procedures/${id}/workerProfiles`));
    }
  }

  for (const [id, capability] of Object.entries(registry.capabilities)) {
    for (const profileId of capability.ownerWorkerProfiles || []) {
      if (!profileIds.has(profileId)) errors.push(issue('capability-unknown-worker-profile', `${id} references unknown Worker Profile ${profileId}`, `#/capabilities/${id}/ownerWorkerProfiles`));
    }
    for (const procedureId of capability.requiredProcedures || []) {
      if (!procedureIds.has(procedureId)) errors.push(issue('capability-unknown-procedure', `${id} references unknown Procedure ${procedureId}`, `#/capabilities/${id}/requiredProcedures`));
    }
    for (const [contractId, contract] of Object.entries(capability.contracts || {})) {
      if (contract.id !== contractId) errors.push(issue('capability-contract-id-mismatch', `${id} contract key ${contractId} declares id ${contract.id}`, `#/capabilities/${id}/contracts/${contractId}`));
      if (!validParties.has(contract.producer)) errors.push(issue('capability-contract-unknown-producer', `${contractId} references unknown producer ${contract.producer}`, `#/capabilities/${id}/contracts/${contractId}/producer`));
      if (!validParties.has(contract.consumer)) errors.push(issue('capability-contract-unknown-consumer', `${contractId} references unknown consumer ${contract.consumer}`, `#/capabilities/${id}/contracts/${contractId}/consumer`));

      // An unreadable enforcement rung must not degrade to advisory: a typo
      // would silently disable the gate it was meant to declare.

      const enforcement = resolveContractEnforcement(contract);
      if (enforcement.error) {
        errors.push(issue('capability-contract-enforcement', enforcement.error, `#/capabilities/${id}/contracts/${contractId}/enforcementLevel`));
      }
      for (const approver of contract.approvalWorkerProfiles || []) {
        if (!validParties.has(approver)) errors.push(issue('capability-contract-unknown-approver', `${contractId} names unknown approvalWorkerProfile ${approver}`, `#/capabilities/${id}/contracts/${contractId}/approvalWorkerProfiles`));
      }
    }
  }

  for (const [id, policy] of Object.entries(registry.policies)) {
    for (const [field, values] of [
      ['ownerWorkerProfile', [policy.ownerWorkerProfile]],
      ['approvalWorkerProfiles', policy.approvalWorkerProfiles || []],
      ['vetoWorkerProfiles', policy.vetoWorkerProfiles || []],
      ['escalationWorkerProfiles', policy.escalationWorkerProfiles || []],
    ]) {
      for (const profileId of values) {
        if (profileId !== 'construct' && !profileIds.has(profileId)) errors.push(issue('policy-unknown-worker-profile', `${id}.${field} references unknown Worker Profile ${profileId}`, `#/policies/${id}/${field}`));
      }
    }
    for (const requiredPolicy of policy.requiredPolicies || []) {
      if (!policyIds.has(requiredPolicy)) errors.push(issue('policy-unknown-policy', `${id} references unknown Policy ${requiredPolicy}`, `#/policies/${id}/requiredPolicies`));
    }
  }
  return errors;
}

export function validate(registry) {
  if (!isRecord(registry)) {
    return { ok: false, errors: [issue('invalid-input', 'Registry must be a non-null object', '#')], warnings: [] };
  }
  const errors = checkShape(registry);
  if (errors.length > 0) return { ok: false, errors, warnings: [] };

  for (const section of REQUIRED_FIELDS.slice(1)) errors.push(...checkMapIdentity(section, registry[section]));
  errors.push(...checkReferences(registry));
  return { ok: errors.length === 0, errors, warnings: [] };
}
