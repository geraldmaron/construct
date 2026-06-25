/**
 * lib/contracts/validate.mjs — Validate specialists/unified-registry.json contracts at sync time + at handoff.
 *
 * Three validation tiers:
 *   1. Schema shape: unified registry conforms to unified-registry.schema.json.
 *   2. Cross-file refs: every output.schema points to a real file in lib/contract-schemas/,
 *      every producer/consumer name resolves to a specialist in the unified registry,
 *      every well-known event/intake string is reachable.
 *   3. Runtime handoff: a single artifact validated against the schema referenced
 *      by a producer→consumer contract, with mustContain post-conditions.
 *
 * Surfaces:
 *   - scripts/sync-specialists.mjs invokes validateContractsFile at sync time.
 *   - bin/construct lint:contracts invokes the same path in CI.
 *   - workflowContractValidate (runtime) invokes validateHandoff per handoff.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  missingRequiredReviewers,
} from '../artifact-reviewers.mjs';
import { inferArtifactTypeFromPath } from '../artifact-type-from-path.mjs';
import { POSTCONDITIONS, validateBinaryPostconditions } from '../specialists/postconditions.mjs';
import { logViolation } from './violation-log.mjs';
import { loadRegistry } from '../registry/loader.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const WELL_KNOWN_PRODUCERS = new Set(['user', 'oncall', 'incident-system', 'construct', '*']);
const WELL_KNOWN_CONSUMERS = new Set(['user', 'construct']);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Validate the unified registry's contracts (shape + cross-file references).
 * Reads registry.contracts via loadRegistry; an explicit contractsPath
 * overrides for legacy/standalone files. Returns { ok, errors[] } — errors
 * is empty on success.
 */
export function validateContractsFile({ contractsPath, registryPath, repoRoot = REPO_ROOT } = {}) {
   const errors = [];
 
   // Load contracts from unified registry or explicit path
   const registry = loadRegistry();
   const specialistIds = new Set(Object.keys(registry.specialists));

   let contractsArray;
   if (contractsPath) {
     const cPath = contractsPath;
     const schemaPath = join(repoRoot, 'specialists', 'contracts.schema.json');
     if (!existsSync(cPath)) {
       return { ok: false, errors: [`contracts file not found: ${cPath}`] };
     }
     if (!existsSync(schemaPath)) {
       errors.push(`contracts schema missing: ${schemaPath}`);
     }
     const raw = readJson(cPath);
     for (const key of ['version', 'terminalStates', 'severities', 'contracts']) {
       if (!(key in raw)) errors.push(`contracts file missing top-level field: ${key}`);
     }
     contractsArray = raw.contracts || [];
   } else {
     // From unified registry - normalize contracts to array format
     contractsArray = Object.values(registry.contracts || {});
     // Support old-format contracts object with .contracts array
     if (Array.isArray(contractsArray) && contractsArray.length === 0 && registry.contracts?.contracts) {
       contractsArray = registry.contracts.contracts;
     }
   }

   const knownNames = registryPath
     ? collectAgentNames(registryPath)
     : new Set(Object.keys(registry.specialists).concat(Object.values(registry.specialists).map(s => s.name)));

   if (Array.isArray(contractsArray)) {
     const ids = new Set();
     contractsArray.forEach((c, idx) => {
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
    if (registry.orchestrator?.name) names.add(registry.orchestrator.name);
    if (registry.orchestrator?.displayName) names.add(registry.orchestrator.displayName);
    for (const s of Object.values(registry.specialists || {})) {
      if (s?.name) names.add(s.name);
      if (s?.displayName) names.add(s.displayName);
    }
  } catch { /* fall through with whatever names we collected */ }
  return names;
}

/**
 * Look up a contract by producer/consumer pair (and optional id).
 */
export function findContract({ producer, consumer, id, contractsPath }) {
   if (contractsPath) {
     if (!existsSync(contractsPath)) return null;
     try {
       const contracts = readJson(contractsPath);
       const list = contracts.contracts || [];
       if (id) return list.find((c) => c.id === id) || null;
       return list.find((c) => c.producer === producer && c.consumer === consumer) || null;
     } catch { return null; }
   }
   // Default: use unified registry
   const registry = loadRegistry();
   if (id) return registry.contracts[id] || null;
   return Object.values(registry.contracts).find((c) => c.producer === producer && c.consumer === consumer) || null;
 }

/**
 * Validate a single artifact against its contract at handoff time.
 *
 * Returns one of:
 *   { ok: true, contract }
 *   { ok: false, status: 'BLOCKED_CONTRACT', errors[], contract }
 *
 * Enforcement defaults to `block` (CISA Secure-by-Design pledge —
 * strong-default configurations). Callers can pass `enforcement: 'warn'`
 * explicitly per-call when they genuinely need advisory mode.
 *
 * Binary postconditions are enforced when the producer has a rule table in
 * `lib/specialists/postconditions.mjs`. The check is self-enforcing: if a
 * producer has rules and the caller does not pass a `packet`, the call is
 * itself a contract violation (MCP best-practice 2025 — no silent skip on
 * tool-argument omission).
 */
export function validateHandoff(opts = {}) {
  const {
    producer,
    consumer,
    id,
    artifact,
    packet,
    contractsPath,
    repoRoot = REPO_ROOT,
    enforcement = 'block',
  } = opts;
  // Distinguish caller-supplied repoRoot from the default. Only an explicit
  // repoRoot routes the violation log write — the default REPO_ROOT is for
  // joining schema paths in this module, and forwarding it to the logger
  // would override the cwd-based project-scope resolver that the test
  // suite (and runtime project state) relies on.
  const explicitRepoRoot = Object.prototype.hasOwnProperty.call(opts, 'repoRoot') ? repoRoot : undefined;

  const errors = [];
  const postconditionFailures = [];

  // Binary postconditions are producer-bound invariants that fire regardless
  // of whether the producer→consumer contract is registered in contracts.json.
  // A producer with rules cannot have its packet validation skipped by
  // claiming an unregistered consumer.
  const hasBinaryRules = Array.isArray(POSTCONDITIONS[producer]) && POSTCONDITIONS[producer].length > 0;
  if (hasBinaryRules) {
    if (packet === undefined || packet === null) {
      errors.push(`producer '${producer}' has binary postconditions; validateHandoff must be called with a packet argument`);
    } else {
      const binary = validateBinaryPostconditions(producer, packet);
      for (const failure of binary.failures) {
        errors.push(`[${failure.id}] ${failure.reason}`);
        postconditionFailures.push(failure);
      }
    }
  }

  const contract = findContract({ producer, consumer, id, contractsPath });
  if (!contract) {
    if (errors.length > 0) {
      logViolation(`${producer}->${consumer}`, 'output', errors, packet ?? artifact, {
        verdict: postconditionFailures.length > 0 ? 'BLOCKED_CONTRACT' : 'CONTRACT_VIOLATION',
        postconditionFailures,
        repoRoot: explicitRepoRoot,
      });
      return enforcement === 'block'
        ? { ok: false, status: 'BLOCKED_CONTRACT', errors: [`no contract found for ${producer}→${consumer}${id ? ` id=${id}` : ''}`, ...errors], contract: null }
        : { ok: true, warnings: [`no contract found for ${producer}→${consumer}`, ...errors], contract: null };
    }
    return enforcement === 'block'
      ? { ok: false, status: 'BLOCKED_CONTRACT', errors: [`no contract found for ${producer}→${consumer}${id ? ` id=${id}` : ''}`], contract: null }
      : { ok: true, warnings: [`no contract found for ${producer}→${consumer}`], contract: null };
  }

  // Team boundary validation: check if cross-team handoff requires approvals.
  if (contract.teamBoundary?.crosses && Array.isArray(contract.teamBoundary.requiresApprovalFrom)) {
    const teamBoundaryErrors = validateTeamBoundary(contract);
    for (const err of teamBoundaryErrors) {
      errors.push(err);
    }
  }

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

  // Disk-artifact postconditions: frontmatter, sections, citations.
  const declaredArtifactPath = artifact?.artifactPath || artifact?.output?.artifactPath;
  if (declaredArtifactPath) {
    const absPath = isAbsolutePath(declaredArtifactPath)
      ? declaredArtifactPath
      : join(repoRoot, declaredArtifactPath);
    const pcErrors = validateArtifactPostconditions({
      contract,
      artifactPath: absPath,
      cwd: repoRoot,
      rootDir: repoRoot,
    });
    for (const e of pcErrors) errors.push(e);
  }

  if (errors.length === 0) return { ok: true, contract };

  // Persist to the chain-hashed violation log so `construct doctor` and
  // forensic replay see the failure. Best-effort; logging never throws.
  const verdict = postconditionFailures.length > 0 ? 'BLOCKED_CONTRACT' : 'CONTRACT_VIOLATION';
  logViolation(contract.id, 'output', errors, packet ?? artifact, {
    verdict,
    postconditionFailures,
    repoRoot: explicitRepoRoot,
  });

  if (enforcement === 'block') return { ok: false, status: 'BLOCKED_CONTRACT', errors, contract };
  return { ok: true, warnings: errors, contract };
}

function isAbsolutePath(p) {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

function hasField(obj, field) {
  if (obj == null) return false;
  if (typeof obj !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(obj, field) && obj[field] != null && obj[field] !== '';
}

/**
 * Validate team boundary enforcement on a contract.
 * Returns array of error strings (empty if validation passes).
 *
 * Team boundaries are declarative metadata that enforce organizational
 * separation of concerns. A contract.teamBoundary.requiresApprovalFrom
 * lists teams that must explicitly approve before the handoff can complete.
 */
function validateTeamBoundary(contract = {}) {
  const errors = [];
  const boundary = contract.teamBoundary || {};

  if (!boundary.crosses) return errors;
  if (!Array.isArray(boundary.requiresApprovalFrom) || boundary.requiresApprovalFrom.length === 0) {
    return errors;
  }

  // Check that producer and consumer teams are declared.
  if (!boundary.producerTeam) {
    errors.push(`team boundary marked as crossing but producerTeam is missing in contract ${contract.id}`);
  }
  if (!boundary.consumerTeam) {
    errors.push(`team boundary marked as crossing but consumerTeam is missing in contract ${contract.id}`);
  }

  // Load registry to verify team ids exist.
  try {
    const registry = loadRegistry();
    for (const teamId of boundary.requiresApprovalFrom) {
      if (!registry.teams?.[teamId]) {
        errors.push(`team boundary references unknown team: ${teamId} (in contract ${contract.id})`);
      }
    }
    if (boundary.producerTeam && !registry.teams?.[boundary.producerTeam]) {
      errors.push(`contract ${contract.id}: producerTeam '${boundary.producerTeam}' not found in registry`);
    }
    if (boundary.consumerTeam && !registry.teams?.[boundary.consumerTeam]) {
      errors.push(`contract ${contract.id}: consumerTeam '${boundary.consumerTeam}' not found in registry`);
    }
  } catch (err) {
    errors.push(`failed to validate team boundary for contract ${contract.id}: ${err.message}`);
  }

  return errors;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

function parseArtifactFrontmatter(text) {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: {}, body: text };
  const fm = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (key) fm[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return { frontmatter: fm, body: text.slice(m[0].length) };
}

function hasSection(body, sectionTitle) {
  const target = sectionTitle.trim().toLowerCase();
  const headingRe = /^#{1,6}\s+(.+)$/gm;
  let m;
  while ((m = headingRe.exec(body))) {
    if (m[1].trim().toLowerCase() === target) return true;
  }
  return false;
}

// A fenced ```mermaid block, optionally of a required diagram kind (the kind is
// matched against the first keyword inside the fence, e.g. flowchart, sequenceDiagram).

function hasMermaid(body, kind) {
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(body))) {
    if (!kind) return true;
    if (new RegExp(`\\b${kind}\\b`, 'i').test(m[1])) return true;
  }
  return false;
}

function hasTable(body) {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (/\|/.test(lines[i]) && /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      return true;
    }
  }
  return false;
}

// Header rows of every GFM table in the body, each as a lowercased cell list.
// A table is a `| ... |` line immediately followed by a `|---|` separator row.

function tableHeaderRows(body) {
  const lines = body.split('\n');
  const headers = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (/\|/.test(lines[i]) && /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const cells = lines[i].split('|').map((c) => c.trim().toLowerCase()).filter(Boolean);
      headers.push({ line: i + 1, cells, rowsBelow: countRows(lines, i + 2) });
    }
  }
  return headers;
}

function countRows(lines, start) {
  let n = 0;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*\|/.test(lines[i]) || (/\|/.test(lines[i]) && lines[i].trim())) n += 1;
    else break;
  }
  return n;
}

function tableWithColumns(body, columns) {
  const want = columns.map((c) => c.trim().toLowerCase());
  for (const header of tableHeaderRows(body)) {
    if (want.every((w) => header.cells.includes(w))) return header;
  }
  return null;
}

function sectionIsNonEmpty(body, sectionTitle) {
  const target = sectionTitle.trim().toLowerCase();
  const lines = body.split('\n');
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      if (inSection) return false;
      inSection = heading[1].trim().toLowerCase() === target;
      continue;
    }
    if (inSection && line.trim() && !line.trim().startsWith('<!--')) return true;
  }
  return false;
}

function claimsHaveCitations(body) {
  const lines = body.split('\n');
  const offenders = [];
  let inFence = false;
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    inTable = /^\s*\|.*\|\s*$/.test(line);
    if (inTable) continue;
    if (/\b\d{1,3}\s*%/.test(line) || /\b\d{2,}x\b/i.test(line)) {
      const window = [lines[i - 1] || '', line, lines[i + 1] || ''].join('\n');
      if (!/\[source:|\bhttps?:\/\/|\[\^\d+\]/i.test(window)) {
        offenders.push({ line: i + 1, snippet: line.trim().slice(0, 80) });
      }
    }
  }
  return offenders;
}

/**
 * Run structured postcondition checks against a handoff's output artifact on
 * disk. Postconditions can be strings (descriptive, ignored here) or objects
 * with { id, check, field?, section? }. Returns an array of error strings.
 */
export function validateArtifactPostconditions({ contract, artifactPath, cwd = process.cwd(), rootDir } = {}) {
  if (!contract?.postconditions?.length) return [];
  if (!artifactPath || !existsSync(artifactPath)) {
    const structured = contract.postconditions.filter((p) => typeof p === 'object');
    if (structured.length === 0) return [];
    return [`postcondition checks declared but artifact not found on disk: ${artifactPath}`];
  }
  const text = readFileSync(artifactPath, 'utf8');
  const { frontmatter, body } = parseArtifactFrontmatter(text);
  const errors = [];
  for (const pc of contract.postconditions) {
    if (typeof pc !== 'object') continue;
    const tag = pc.id || pc.check;
    switch (pc.check) {
      case 'artifact-has-frontmatter-field': {
        if (!pc.field) {
          errors.push(`[${tag}] postcondition missing 'field' for artifact-has-frontmatter-field`);
          break;
        }
        if (!frontmatter[pc.field]) {
          errors.push(`[${tag}] artifact missing frontmatter field: ${pc.field}`);
        }
        break;
      }
      case 'artifact-has-section': {
        if (!pc.section) {
          errors.push(`[${tag}] postcondition missing 'section' for artifact-has-section`);
          break;
        }
        if (!hasSection(body, pc.section)) {
          errors.push(`[${tag}] artifact missing required section: "${pc.section}"`);
        }
        break;
      }
      case 'artifact-claims-cited': {
        const offenders = claimsHaveCitations(body);
        for (const o of offenders) {
          errors.push(`[${tag}] uncited numeric claim at line ${o.line}: ${o.snippet}`);
        }
        break;
      }
      case 'artifact-has-mermaid': {
        if (!hasMermaid(body, pc.diagram)) {
          errors.push(`[${tag}] artifact missing required mermaid diagram${pc.diagram ? ` (${pc.diagram})` : ''}`);
        }
        break;
      }
      case 'artifact-has-table': {
        if (!hasTable(body)) {
          errors.push(`[${tag}] artifact missing a required table`);
        }
        break;
      }
      case 'artifact-table-has-columns': {
        if (!Array.isArray(pc.columns) || pc.columns.length === 0) {
          errors.push(`[${tag}] postcondition missing 'columns' for artifact-table-has-columns`);
          break;
        }
        const match = tableWithColumns(body, pc.columns);
        if (!match) {
          errors.push(`[${tag}] no table has the required columns: ${pc.columns.join(', ')}`);
        } else if (match.rowsBelow === 0) {
          errors.push(`[${tag}] required table (${pc.columns.join(', ')}) has no data rows`);
        }
        break;
      }
      case 'artifact-section-nonempty': {
        if (!pc.section) {
          errors.push(`[${tag}] postcondition missing 'section' for artifact-section-nonempty`);
          break;
        }
        if (!sectionIsNonEmpty(body, pc.section)) {
          errors.push(`[${tag}] required section is empty or missing: "${pc.section}"`);
        }
        break;
      }
      case 'artifact-reviewers-seen': {
        let missing;
        if (pc.fromManifest) {
          missing = missingRequiredReviewers({ filePath: artifactPath, cwd, rootDir });
        } else {
          missing = missingRequiredReviewers({
            docType: pc.docType || inferArtifactTypeFromPath(artifactPath, { rootDir: cwd }),
            filePath: artifactPath,
            cwd,
            rootDir,
          });
        }
        if (Array.isArray(pc.reviewers) && pc.reviewers.length > 0) {
          missing = missing.filter((r) => pc.reviewers.includes(r));
        }
        if (missing.length > 0) {
          errors.push(`[${tag}] required reviewers not in agent log: ${missing.join(', ')}`);
        }
        break;
      }
      default:
        errors.push(`[${tag}] unknown postcondition check: ${pc.check}`);
    }
  }
  return errors;
}

// Minimum evidence required: either a PR reference (#N or PR #N) or a file
// reference of the form `path:<line>` or `file:<line>` where line is a number.
const CLOSE_REASON_PR_PATTERN = /#\d+/;
const CLOSE_REASON_FILE_PATTERN = /[\w./\\-]+(?:\.(?:mjs|ts|js|tsx|jsx|py|go|rs|java|md|json|yml|yaml)):[0-9]+/i;
const CLOSE_REASON_MIN_LENGTH = 20;

/**
 * Validate a beads close reason for evidence quality.
 *
 * Returns { ok: boolean, message: string|null }. On failure, `message` describes
 * what is missing. The caller decides whether to warn or block based on
 * CONSTRUCT_BEADS_HYGIENE (warn | block). Default behavior is warn.
 *
 * A passing reason must:
 *   - Be at least 20 characters.
 *   - Contain a PR reference (#N) OR a file:line reference (path.mjs:42).
 */
export function validateBeadsCloseReason(reason) {
  if (!reason || typeof reason !== 'string') {
    return { ok: false, message: 'Close reason is empty. Add evidence: PR reference (#N) or file:line reference.' };
  }
  const trimmed = reason.trim();
  if (trimmed.length < CLOSE_REASON_MIN_LENGTH) {
    return { ok: false, message: `Close reason too short (${trimmed.length} chars). Minimum: ${CLOSE_REASON_MIN_LENGTH}. Add evidence.` };
  }
  const hasPr = CLOSE_REASON_PR_PATTERN.test(trimmed);
  const hasFile = CLOSE_REASON_FILE_PATTERN.test(trimmed);
  if (!hasPr && !hasFile) {
    return {
      ok: false,
      message: `Close reason lacks evidence. Include a PR reference (#N) or a file:line reference (e.g. lib/foo.mjs:42). Got: "${trimmed.slice(0, 80)}"`,
    };
  }
  return { ok: true, message: null };
}

/**
 * Apply the beads close-reason policy: warn or block based on
 * CONSTRUCT_BEADS_HYGIENE env var. Returns exit code (0 = ok, 1 = block).
 */
export function applyBeadsHygienePolicy(reason, { stderr = process.stderr } = {}) {
  const { ok, message } = validateBeadsCloseReason(reason);
  if (ok) return 0;

  const mode = (process.env.CONSTRUCT_BEADS_HYGIENE || 'warn').toLowerCase();
  const prefix = mode === 'block' ? '[beads-hygiene] BLOCK' : '[beads-hygiene] WARN';
  stderr.write(`${prefix}: ${message}\n`);
  return mode === 'block' ? 1 : 0;
}
