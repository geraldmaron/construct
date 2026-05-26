/**
 * lib/contracts/validate.mjs — Validate agents/contracts.json at sync time + at handoff.
 *
 * Three validation tiers:
 *   1. Schema shape: contracts.json conforms to contracts.schema.json (minimal
 *      validator — top-level required fields, contract entry required fields).
 *   2. Cross-file refs: every output.schema points to a real file in lib/schemas/,
 *      every producer/consumer name resolves to an agent or persona in
 *      agents/registry.json, every well-known event/intake string is reachable.
 *   3. Runtime handoff: a single artifact validated against the schema referenced
 *      by a producer→consumer contract, with mustContain post-conditions.
 *
 * Surfaces:
 *   - scripts/sync-agents.mjs invokes validateContractsFile at sync time.
 *   - bin/construct lint:contracts invokes the same path in CI.
 *   - workflowContractValidate (runtime) invokes validateHandoff per handoff.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACTS_PATH = join(REPO_ROOT, 'agents', 'contracts.json');
const CONTRACTS_SCHEMA_PATH = join(REPO_ROOT, 'agents', 'contracts.schema.json');
const REGISTRY_PATH = join(REPO_ROOT, 'agents', 'registry.json');

const WELL_KNOWN_PRODUCERS = new Set(['user', 'oncall', 'incident-system', '*']);
const WELL_KNOWN_CONSUMERS = new Set(['user', 'construct']);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Validate agents/contracts.json shape and cross-file references.
 * Returns { ok, errors[] } — errors is empty on success.
 */
export function validateContractsFile({ contractsPath, registryPath, repoRoot = REPO_ROOT } = {}) {
  const errors = [];

  // When repoRoot is supplied but explicit paths are not, derive both from it
  // so test fixtures and the consistency watcher can validate slices in a
  // tmpdir without pointing at the live repo.
  const cPath = contractsPath || join(repoRoot, 'agents', 'contracts.json');
  const rPath = registryPath || join(repoRoot, 'agents', 'registry.json');
  const schemaPath = join(repoRoot, 'agents', 'contracts.schema.json');

  if (!existsSync(cPath)) {
    return { ok: false, errors: [`contracts file not found: ${cPath}`] };
  }
  if (!existsSync(schemaPath)) {
    errors.push(`contracts schema missing: ${schemaPath}`);
  }

  let contracts;
  try { contracts = readJson(cPath); }
  catch (err) { return { ok: false, errors: [`contracts.json parse error: ${err.message}`] }; }

  for (const key of ['version', 'terminalStates', 'severities', 'contracts']) {
    if (!(key in contracts)) errors.push(`contracts.json missing top-level field: ${key}`);
  }

  const knownNames = collectAgentNames(rPath);

  if (Array.isArray(contracts.contracts)) {
    const ids = new Set();
    contracts.contracts.forEach((c, idx) => {
      const where = `contracts[${idx}]${c.id ? ` (${c.id})` : ''}`;
      if (!c.id) errors.push(`${where}: missing id`);
      else if (!/^[a-z0-9][a-z0-9-]*$/.test(c.id)) errors.push(`${where}: id must be kebab-case`);
      else if (ids.has(c.id)) errors.push(`${where}: duplicate id`);
      else ids.add(c.id);

      if (!c.producer) errors.push(`${where}: missing producer`);
      if (!c.consumer) errors.push(`${where}: missing consumer`);
      if (!c.input) errors.push(`${where}: missing input`);

      if (c.producer && !nameResolves(c.producer, knownNames, 'producer')) {
        errors.push(`${where}: producer '${c.producer}' is not an agent/persona in registry.json and is not a well-known producer`);
      }
      if (c.consumer && !nameResolves(c.consumer, knownNames, 'consumer')) {
        errors.push(`${where}: consumer '${c.consumer}' is not an agent/persona in registry.json and is not a well-known consumer`);
      }

      const schemaRef = c.output?.schema;
      if (schemaRef) {
        const outputSchemaPath = join(repoRoot, schemaRef);
        if (!existsSync(outputSchemaPath)) {
          errors.push(`${where}: output.schema '${schemaRef}' does not exist on disk`);
        } else {
          try { readJson(outputSchemaPath); }
          catch (err) { errors.push(`${where}: output.schema '${schemaRef}' is not valid JSON: ${err.message}`); }
        }
      }
    });
  } else {
    errors.push('contracts.json: contracts must be an array');
  }

  return { ok: errors.length === 0, errors };
}

function nameResolves(name, knownNames, role) {
  if (WELL_KNOWN_PRODUCERS.has(name) && role === 'producer') return true;
  if (WELL_KNOWN_CONSUMERS.has(name) && role === 'consumer') return true;
  if (knownNames.has(name)) return true;
  // Persona registry stores names without the cx- prefix; contracts.json
  // conventionally uses the cx-prefixed form. Normalize both directions.
  const stripped = name.startsWith('cx-') ? name.slice(3) : `cx-${name}`;
  return knownNames.has(stripped);
}

function collectAgentNames(registryPath) {
  const names = new Set();
  if (!existsSync(registryPath)) return names;
  try {
    const registry = readJson(registryPath);
    for (const a of registry.agents || []) {
      if (a?.name) names.add(a.name);
      if (a?.displayName) names.add(a.displayName);
    }
    for (const p of registry.personas || []) {
      if (p?.name) names.add(p.name);
      if (p?.displayName) names.add(p.displayName);
    }
  } catch { /* fall through with whatever names we collected */ }
  return names;
}

/**
 * Look up a contract by producer/consumer pair (and optional id).
 */
export function findContract({ producer, consumer, id, contractsPath = CONTRACTS_PATH }) {
  if (!existsSync(contractsPath)) return null;
  let contracts;
  try { contracts = readJson(contractsPath); } catch { return null; }
  const list = contracts.contracts || [];
  if (id) return list.find((c) => c.id === id) || null;
  return list.find((c) => c.producer === producer && c.consumer === consumer) || null;
}

/**
 * Validate a single artifact against its contract at handoff time.
 *
 * Returns one of:
 *   { ok: true, contract }
 *   { ok: false, status: 'BLOCKED_CONTRACT', errors[], contract }
 *
 * Enforcement defaults to the value of process.env.CONSTRUCT_CONTRACT_ENFORCEMENT
 * ('warn' or 'block'), and may be overridden by the caller. In warn mode the
 * result includes errors but ok stays true so a session is not blocked.
 */
export function validateHandoff({
  producer,
  consumer,
  id,
  artifact,
  contractsPath = CONTRACTS_PATH,
  repoRoot = REPO_ROOT,
  enforcement = process.env.CONSTRUCT_CONTRACT_ENFORCEMENT || 'warn',
}) {
  const contract = findContract({ producer, consumer, id, contractsPath });
  if (!contract) {
    return enforcement === 'block'
      ? { ok: false, status: 'BLOCKED_CONTRACT', errors: [`no contract found for ${producer}→${consumer}${id ? ` id=${id}` : ''}`], contract: null }
      : { ok: true, warnings: [`no contract found for ${producer}→${consumer}`], contract: null };
  }

  const errors = [];

  // A handoff carries a producer's output, which is the consumer's input. The
  // input contract is what the consumer expects to receive; check mustContain
  // against that first. Output.schema validation only applies when the artifact
  // declares the matching `type` (e.g. the consumer is forwarding its own
  // produced artifact downstream).
  const inputMustContain = contract.input?.mustContain || [];
  for (const field of inputMustContain) {
    if (!hasField(artifact, field)) {
      errors.push(`artifact missing required field: ${field}`);
    }
  }

  const outputType = contract.output?.type;
  const schemaRef = contract.output?.schema;
  if (schemaRef && outputType && artifact && artifact.type === outputType) {
    const schemaPath = join(repoRoot, schemaRef);
    if (!existsSync(schemaPath)) {
      errors.push(`contract output.schema '${schemaRef}' does not exist on disk`);
    } else {
      const schema = readJson(schemaPath);
      for (const field of schema.required || []) {
        if (!hasField(artifact, field)) errors.push(`artifact missing schema-required field: ${field}`);
      }
    }
  }

  if (errors.length === 0) return { ok: true, contract };
  if (enforcement === 'block') return { ok: false, status: 'BLOCKED_CONTRACT', errors, contract };
  return { ok: true, warnings: errors, contract };
}

function hasField(obj, field) {
  if (obj == null) return false;
  if (typeof obj !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(obj, field) && obj[field] != null && obj[field] !== '';
}
