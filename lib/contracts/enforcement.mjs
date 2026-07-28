/**
 * lib/contracts/enforcement.mjs — per-contract enforcement ladder (construct-uizpv.5).
 *
 * A contract postcondition that no mechanism can decide is documented as
 * advisory (lib/contracts/validate.mjs). That classification answers "can this
 * be checked?" but not "what happens when it fails?" — so a contract could
 * declare `ship blocked` and halt nothing. This module owns the second
 * question as a three-rung ladder declared in registry data:
 *
 *   advisory — reported, never blocks. The default for an undeclared contract.
 *   soft     — blocks unless an actor overrides; the override is recorded in
 *              the audit trail (lib/audit-trail.mjs), so bypassing is possible
 *              but never silent.
 *   hard     — blocks until a Worker Profile named in approvalWorkerProfiles
 *              records a sign-off. An override cannot clear it.
 *
 * Both the level and the approving Worker Profiles are registry data. No
 * domain name (legal, security, privacy) appears in this file: the first
 * instance happens to be legal sign-off, but the mechanism is persona-generic
 * and a preset can declare a different one without touching lib/.
 *
 * Contracts come from two places and both are honored: contracts nested under
 * capabilities in the unified registry, and the standalone seeds in
 * registry/contracts/*.json (which loadRegistry does not surface).
 *
 * Fail-closed: when the contract set cannot be read, evaluateContractGate
 * denies rather than passing an unevaluated artifact, mirroring
 * lib/policy/audit-gate.mjs. An evaluator that cannot see its rules must not
 * report "no violations found" — that is indistinguishable from a clean run.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Contracts ship with the package, so the seed directory resolves relative to
// the module rather than the caller's cwd — matching REPO_ROOT in
// lib/contracts/validate.mjs.

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ENFORCEMENT_LEVELS = Object.freeze(['advisory', 'soft', 'hard']);

export const DEFAULT_ENFORCEMENT_LEVEL = 'advisory';

export const CONTRACT_GATE_SOURCE = 'contract-enforcement-ladder';

export class ContractEvaluatorUnavailableError extends Error {
  constructor(reason) {
    super(`contract enforcement evaluator unavailable: ${reason}`);
    this.name = 'ContractEvaluatorUnavailableError';
    this.reason = reason;
  }
}

export function isEnforcementLevel(level) {
  return ENFORCEMENT_LEVELS.includes(level);
}

/**
 * A contract's declared level, defaulting to advisory. An unrecognized value
 * is not silently downgraded — an unreadable rung is a registry error, and
 * treating it as advisory would turn a typo into a disabled gate.
 */
export function resolveContractEnforcement(contract = {}) {
  const declared = contract.enforcementLevel;
  if (declared == null) {
    return {
      level: DEFAULT_ENFORCEMENT_LEVEL,
      approvalWorkerProfiles: [],
      declared: false,
      error: null,
    };
  }
  if (!isEnforcementLevel(declared)) {
    return {
      level: null,
      approvalWorkerProfiles: [],
      declared: true,
      error: `contract '${contract.id}' declares unknown enforcementLevel '${declared}' (expected one of: ${ENFORCEMENT_LEVELS.join(', ')})`,
    };
  }
  const approvers = Array.isArray(contract.approvalWorkerProfiles)
    ? contract.approvalWorkerProfiles.filter((entry) => typeof entry === 'string' && entry.length > 0)
    : [];
  if (declared === 'hard' && approvers.length === 0) {
    return {
      level: declared,
      approvalWorkerProfiles: [],
      declared: true,
      error: `contract '${contract.id}' declares enforcementLevel 'hard' but names no approvalWorkerProfiles — nothing could ever clear it`,
    };
  }
  return { level: declared, approvalWorkerProfiles: approvers, declared: true, error: null };
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Every contract visible to the enforcement ladder, keyed by id. Capability
 * contracts and standalone registry/contracts/ seeds are merged; a seed wins
 * on id collision because it is the editable source of truth for contracts
 * that no capability owns.
 */
export function loadEnforceableContracts({ rootDir = PACKAGE_ROOT, registry = null } = {}) {
  const byId = new Map();

  for (const capability of Object.values(registry?.capabilities || {})) {
    for (const contract of Object.values(capability?.contracts || {})) {
      if (contract?.id) byId.set(contract.id, contract);
    }
  }

  const seedDir = path.join(rootDir, 'registry', 'contracts');
  if (existsSync(seedDir)) {
    for (const name of readdirSync(seedDir)) {
      if (!name.endsWith('.json')) continue;
      const contract = readJsonOrNull(path.join(seedDir, name));
      if (contract?.id) byId.set(contract.id, contract);
    }
  }

  return [...byId.values()];
}

function normalizeFlags(flags) {
  if (!Array.isArray(flags)) return [];
  return flags.filter((flag) => typeof flag === 'string' && flag.length > 0);
}

/**
 * A contract applies when its trigger matches the artifact under evaluation.
 * artifactType must match when the trigger names one; riskFlags match on any
 * overlap, so an artifact carrying one declared flag engages the contract.
 * A trigger naming neither never applies — an unscoped gate that fires on
 * everything is a misconfiguration, not a catch-all.
 */
export function contractApplies(contract, { artifactType = null, riskFlags = [] } = {}) {
  const trigger = contract?.trigger;
  if (!trigger) return false;

  const triggerType = trigger.artifactType ?? null;
  const triggerFlags = normalizeFlags(trigger.riskFlags);
  if (triggerType == null && triggerFlags.length === 0) return false;

  if (triggerType != null && triggerType !== artifactType) return false;

  if (triggerFlags.length > 0) {
    const present = new Set(normalizeFlags(riskFlags));
    if (!triggerFlags.some((flag) => present.has(flag))) return false;
  }

  return true;
}

function signOffSatisfies(record, contract, approvers) {
  if (record?.contractId !== contract.id) return false;
  if (record?.decision !== 'approved') return false;
  return approvers.includes(record.workerProfile);
}

/**
 * Evaluate every applicable contract for one artifact.
 *
 * Returns { ok, blocked[], overridden[], advisory[], evaluated[], errors[] }.
 * `ok` is false when any hard contract lacks a sign-off or any soft contract
 * lacks either a sign-off or an override.
 *
 * Throws ContractEvaluatorUnavailableError when the contract set could not be
 * loaded — callers gate on that rather than treating it as a pass.
 */
export function evaluateContractGate({
  artifactType = null,
  riskFlags = [],
  contracts = null,
  signOffs = [],
  overrides = [],
  rootDir = null,
  registry = null,
} = {}) {
  let contractSet = contracts;
  if (contractSet == null) {
    try {
      contractSet = loadEnforceableContracts({ rootDir: rootDir ?? PACKAGE_ROOT, registry });
    } catch (err) {
      throw new ContractEvaluatorUnavailableError(err.message);
    }
    if (!Array.isArray(contractSet)) {
      throw new ContractEvaluatorUnavailableError('contract set did not load as a list');
    }
  }

  const blocked = [];
  const overridden = [];
  const advisory = [];
  const evaluated = [];
  const errors = [];

  for (const contract of contractSet) {
    if (!contractApplies(contract, { artifactType, riskFlags })) continue;

    const resolution = resolveContractEnforcement(contract);
    if (resolution.error) errors.push(resolution.error);
    if (resolution.level == null) {
      blocked.push({
        contractId: contract.id,
        level: null,
        reason: resolution.error,
        clearedBy: null,
      });
      continue;
    }

    evaluated.push({ contractId: contract.id, level: resolution.level });

    if (resolution.level === 'advisory') {
      advisory.push({
        contractId: contract.id,
        level: 'advisory',
        reason: `contract '${contract.id}' applies as advisory — reported, not enforced`,
      });
      continue;
    }

    const approvers = resolution.approvalWorkerProfiles;
    const signOff = signOffs.find((record) => signOffSatisfies(record, contract, approvers));
    if (signOff) {
      evaluated[evaluated.length - 1].clearedBy = 'sign-off';
      continue;
    }

    if (resolution.level === 'hard') {
      blocked.push({
        contractId: contract.id,
        level: 'hard',
        reason: approvers.length > 0
          ? `contract '${contract.id}' is hard-blocked pending sign-off from: ${approvers.join(', ')}`
          : `contract '${contract.id}' is hard-blocked and names no approver`,
        approvalWorkerProfiles: approvers,
        clearedBy: null,
      });
      continue;
    }

    const override = overrides.find((record) => record?.contractId === contract.id);
    if (override) {
      overridden.push({
        contractId: contract.id,
        level: 'soft',
        reason: override.reason || '(no reason recorded)',
        actor: override.actor ?? null,
        auditRef: override.auditRef ?? null,
      });
      continue;
    }

    blocked.push({
      contractId: contract.id,
      level: 'soft',
      reason: approvers.length > 0
        ? `contract '${contract.id}' is soft-blocked pending sign-off from ${approvers.join(', ')} or a recorded override`
        : `contract '${contract.id}' is soft-blocked pending a recorded override`,
      approvalWorkerProfiles: approvers,
      clearedBy: null,
    });
  }

  return {
    ok: blocked.length === 0,
    blocked,
    overridden,
    advisory,
    evaluated,
    errors,
    source: CONTRACT_GATE_SOURCE,
  };
}
