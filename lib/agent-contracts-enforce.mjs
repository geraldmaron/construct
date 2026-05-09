/**
 * lib/agent-contracts-enforce.mjs — runtime contract enforcement.
 *
 * Wraps `validatePacket` from `lib/agent-contracts.mjs` with three production
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

import { existsSync, mkdirSync, statSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { validatePacket } from './agent-contracts.mjs';

const CX_DIR = join(homedir(), '.cx');
const LOG_FILE = join(CX_DIR, 'contract-violations.jsonl');
const LAST_AGENT = join(CX_DIR, 'last-agent.json');

export class ContractViolationError extends Error {
  constructor({ contractId, direction, missing }) {
    super(
      `contract '${contractId}' (${direction}) violated — missing field(s): ${missing.join(', ')}`
    );
    this.name = 'ContractViolationError';
    this.contractId = contractId;
    this.direction = direction;
    this.missing = missing;
  }
}

function sha256(input) { return createHash('sha256').update(input).digest('hex'); }

function readLastAgent() {
  try { return JSON.parse(readFileSync(LAST_AGENT, 'utf8'))?.agent || 'construct'; }
  catch { return 'construct'; }
}

function readPrevLineHash() {
  try {
    if (!existsSync(LOG_FILE)) return null;
    const size = statSync(LOG_FILE).size;
    if (size === 0) return null;
    const tail = readFileSync(LOG_FILE, 'utf8').slice(Math.max(0, size - 2048));
    const lines = tail.split('\n').filter(Boolean);
    return lines.length === 0 ? null : sha256(lines[lines.length - 1]);
  } catch { return null; }
}

function logViolation(contractId, direction, missing, packet) {
  try {
    mkdirSync(CX_DIR, { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      agent: readLastAgent(),
      contractId,
      direction,
      missing,
      packet_keys: packet && typeof packet === 'object' ? Object.keys(packet) : null,
      prev_line_hash: readPrevLineHash(),
    };
    appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch { /* logging is best-effort */ }
}

/**
 * Validate `packet` against `contractId` in the given `direction`. Throws
 * a `ContractViolationError` on failure (and logs the violation). Returns
 * the validation result on success so callers can inspect the resolved
 * contract metadata.
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
  return result;
}

/**
 * Read recent violations from the chain log. Returns oldest-first.
 */
export function recentViolations({ windowMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!existsSync(LOG_FILE)) return [];
  try {
    const cutoff = Date.now() - windowMs;
    return readFileSync(LOG_FILE, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((r) => r && new Date(r.ts).getTime() >= cutoff);
  } catch { return []; }
}
