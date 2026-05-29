/**
 * lib/specialist-contracts-enforce.mjs — runtime contract enforcement.
 *
 * Wraps `validatePacket` from `lib/specialist-contracts.mjs` with three production
 * concerns:
 *
 *   1. Block on violation. `enforcePacket` throws a `ContractViolationError`
 *      when the packet doesn't satisfy the contract direction. Callers can
 *      catch and degrade if they want advisory mode, but the default is hard
 *      enforcement so contract bugs surface loudly.
 *
 *   2. Tamper-evident violation log. Every violation appends a JSONL record
 *      to `~/.cx/contract-violations.jsonl` with a sha256 chain-hash over
 *      the prior line. Same pattern as the mutation audit trail. Operators
 *      can replay the chain to detect after-the-fact tampering.
 *
 *   3. Visibility into `construct doctor`. `recentViolations(windowMs)`
 *      returns the last N violations so doctor can surface
 *      "3 contract violations in the last 24h — see ~/.cx/contract-violations.jsonl".
 *
 * The enforcement is identity-aware. Each violation logs the active agent
 * (via `~/.cx/last-agent.json` like audit-trail does) so operators can
 * identify which producer or consumer is at fault.
 */

import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { getContractById, validatePacket } from './specialist-contracts.mjs';
import { appendBounded } from './logging/rotate.mjs';
import { resolveProjectScopedPath } from './project-root.mjs';
import { validatePostconditions } from './specialists/postconditions.mjs';

const CX_DIR = join(homedir(), '.cx');
// contract-violations are PROJECT-SCOPED — a violation belongs to a
// specific contract chain in a specific project. Resolves to
// <project>/.cx/contract-violations.jsonl when inside a project, falling
// back to the legacy ~/.cx path for standalone invocations. Resolved on
// every call so cwd/HOME changes inside the same process (tests, harness
// reuse) route correctly.

function logFile() {
  return resolveProjectScopedPath('contract-violations.jsonl', { ensureDir: false });
}
const LAST_AGENT = join(CX_DIR, 'last-agent.json');

export class ContractViolationError extends Error {
  constructor({ contractId, direction, missing, verdict = 'CONTRACT_VIOLATION', postconditionFailures = [] }) {
    const detail = postconditionFailures.length > 0
      ? `postcondition(s) failed: ${postconditionFailures.map((f) => f.id).join(', ')}`
      : `missing field(s): ${(missing || []).join(', ')}`;
    super(`contract '${contractId}' (${direction}) violated — ${detail}`);
    this.name = 'ContractViolationError';
    this.contractId = contractId;
    this.direction = direction;
    this.missing = missing || [];
    this.verdict = verdict;
    this.postconditionFailures = postconditionFailures;
  }
}

function sha256(input) { return createHash('sha256').update(input).digest('hex'); }

function readLastAgent() {
  try { return JSON.parse(readFileSync(LAST_AGENT, 'utf8'))?.agent || 'construct'; }
  catch { return 'construct'; }
}

function readPrevLineHash() {
  try {
    const file = logFile();
    if (!existsSync(file)) return null;
    const size = statSync(file).size;
    if (size === 0) return null;
    const tail = readFileSync(file, 'utf8').slice(Math.max(0, size - 2048));
    const lines = tail.split('\n').filter(Boolean);
    return lines.length === 0 ? null : sha256(lines[lines.length - 1]);
  } catch { return null; }
}

function logViolation(contractId, direction, missing, packet, extra = {}) {
  try {
    const file = logFile();
    mkdirSync(dirname(file), { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      agent: readLastAgent(),
      contractId,
      direction,
      missing,
      packet_keys: packet && typeof packet === 'object' ? Object.keys(packet) : null,
      prev_line_hash: readPrevLineHash(),
      ...extra,
    };
    appendBounded('contract-violations', file, JSON.stringify(record) + '\n');
  } catch { /* logging is best-effort */ }
}

/**
 * Validate `packet` against `contractId` in the given `direction`. Throws
 * a `ContractViolationError` on failure (and logs the violation). Returns
 * the validation result on success so callers can inspect the resolved
 * contract metadata.
 *
 * For `direction === 'output'`, also evaluates the producer's binary
 * postconditions from `lib/agents/postconditions.mjs`. A failed postcondition
 * raises with `verdict: 'BLOCKED_CONTRACT'` so the dispatcher can branch on
 * the typed verdict rather than parsing the error message.
 *
 * @param {string} contractId
 * @param {object} packet
 * @param {'input'|'output'} [direction]
 * @returns {{ ok: true, contract, direction }}
 */
export function enforcePacket(contractId, packet, direction = 'input') {
  const result = validatePacket(contractId, packet, direction);
  if (!result.ok) {
    if (result.reason === 'contract-not-found') {
      throw new ContractViolationError({
        contractId,
        direction,
        missing: ['(contract not found)'],
      });
    }
    logViolation(contractId, direction, result.missing || [], packet);
    throw new ContractViolationError({
      contractId,
      direction,
      missing: result.missing || [],
    });
  }

  if (direction === 'output') {
    const contract = result.contract || getContractById(contractId);
    const producer = contract?.producer;
    if (producer) {
      const postcondition = validatePostconditions(producer, packet);
      if (!postcondition.ok) {
        logViolation(contractId, direction, [], packet, {
          verdict: 'BLOCKED_CONTRACT',
          postconditionFailures: postcondition.failures,
        });
        throw new ContractViolationError({
          contractId,
          direction,
          verdict: 'BLOCKED_CONTRACT',
          postconditionFailures: postcondition.failures,
        });
      }
    }
  }

  return result;
}

/**
 * Read recent violations from the chain log. Returns oldest-first.
 */
export function recentViolations({ windowMs = 24 * 60 * 60 * 1000 } = {}) {
  const file = logFile();
  if (!existsSync(file)) return [];
  try {
    const cutoff = Date.now() - windowMs;
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((r) => r && new Date(r.ts).getTime() >= cutoff);
  } catch { return []; }
}
