/**
 * lib/contracts/violation-log.mjs — tamper-evident append-only log for
 * specialist-contract violations.
 *
 * Each record carries:
 *   ts                  — ISO timestamp
 *   sequence            — monotonic per-log counter, gap-detects truncation
 *   prev_line_hash      — sha256 of the prior line, gap-detects modification
 *   agent               — last-known active agent (from ~/.cx/last-agent.json)
 *   contractId          — the contract that fired the violation
 *   direction           — 'input' | 'output'
 *   missing             — field names that failed shape validation
 *   packet_keys         — Object.keys(packet) when packet is an object
 *   verdict             — 'CONTRACT_VIOLATION' (default) or 'BLOCKED_CONTRACT'
 *                         (binary postcondition failures)
 *   postconditionFailures — [{id, reason}] when verdict is BLOCKED_CONTRACT
 *
 * The hash chain spans rotation: when the active file is empty (post-rotate),
 * the tail is read from the most recent segment (gzipped or plain) via
 * readLastLineAcrossSegments. The sequence counter follows the same path.
 *
 * Single owner of the file. All readers go through recentViolations or
 * verifyChain; all writers go through logViolation.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { appendBounded, readLastLineAcrossSegments } from '../logging/rotate.mjs';
import { resolveProjectScopedPath } from '../project-root.mjs';

const CX_DIR = join(homedir(), '.cx');
const LAST_AGENT = join(CX_DIR, 'last-agent.json');

// contract-violations are PROJECT-SCOPED: resolves to
// <project>/.cx/contract-violations.jsonl when inside a project, falling
// back to ~/.cx for standalone invocations. Resolved on every call so
// cwd/HOME changes inside the same process (tests, harness reuse) route
// correctly.

function logFile() {
  return resolveProjectScopedPath('contract-violations.jsonl', { ensureDir: false });
}

function sha256(input) { return createHash('sha256').update(input).digest('hex'); }

function readLastAgent() {
  try { return JSON.parse(readFileSync(LAST_AGENT, 'utf8'))?.agent || 'construct'; }
  catch { return 'construct'; }
}

function readTailRecord() {
  const file = logFile();
  const lastLine = readLastLineAcrossSegments(file);
  if (!lastLine) return null;
  try { return JSON.parse(lastLine); }
  catch { return null; }
}

function readPrevLineHash() {
  const file = logFile();
  const lastLine = readLastLineAcrossSegments(file);
  return lastLine ? sha256(lastLine) : null;
}

function nextSequence() {
  const tail = readTailRecord();
  const prior = Number.isInteger(tail?.sequence) ? tail.sequence : 0;
  return prior + 1;
}

/**
 * Append a violation record. Best-effort: file I/O failures are swallowed
 * so logging never crashes the caller.
 */
export function logViolation(contractId, direction, missing, packet, extra = {}) {
  try {
    const file = logFile();
    mkdirSync(dirname(file), { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      sequence: nextSequence(),
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
 * Read recent violations from the active log segment. Returns oldest-first.
 * Rotated segments are intentionally not included — this is the doctor
 * surface, scoped to the active window.
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

/**
 * Walk the active log segment, asserting:
 *   - each record's prev_line_hash matches sha256 of the prior line
 *   - sequence numbers are monotonic with no gaps
 *
 * Returns { ok, brokenAt? } where brokenAt is { index, reason } on first
 * failure. An empty / missing log is `{ ok: true }` (nothing to break).
 */
export function verifyChain() {
  const file = logFile();
  if (!existsSync(file)) return { ok: true };
  try {
    const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
    let priorLine = null;
    let priorSeq = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let record;
      try { record = JSON.parse(line); }
      catch { return { ok: false, brokenAt: { index: i, reason: 'unparseable JSON' } }; }

      if (priorLine !== null) {
        const expectedHash = sha256(priorLine);
        if (record.prev_line_hash !== expectedHash) {
          return { ok: false, brokenAt: { index: i, reason: 'prev_line_hash mismatch' } };
        }
      }
      if (Number.isInteger(record.sequence)) {
        if (priorSeq !== null && record.sequence !== priorSeq + 1) {
          return { ok: false, brokenAt: { index: i, reason: `sequence gap (expected ${priorSeq + 1}, got ${record.sequence})` } };
        }
        priorSeq = record.sequence;
      }
      priorLine = line;
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, brokenAt: { index: -1, reason: err.message } };
  }
}
