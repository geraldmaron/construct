/**
 * lib/hooks/_lib/log.mjs — Centralized hook failure telemetry.
 *
 * Hook scripts (lib/hooks/*.mjs) catch and swallow most stdin/parse errors so
 * a regression in the hook harness or a malformed payload does not block the
 * user. The trade-off is silent failure: until now, hook regressions were
 * invisible. This helper writes a single JSONL entry per failure to
 * <doctorRoot>/hook-failures.jsonl so `construct doctor` can surface the top
 * failing hooks without changing the fail-open behavior of any individual
 * hook.
 *
 * Usage from a hook:
 *   import { logHookFailure } from './_lib/log.mjs';
 *   try { ... } catch (err) { logHookFailure({ hook: 'session-start', err }); }
 *
 * Failure-of-the-failure is also tolerated — if writing the log itself fails,
 * the helper swallows the error so the hook proceeds normally.
 *
 * The log file is rotated at LOG_MAX_BYTES to keep disk usage bounded.
 */

import { appendFileSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { doctorRoot } from '../../config/xdg.mjs';

const LOG_DIR = doctorRoot();
const LOG_PATH = join(LOG_DIR, 'hook-failures.jsonl');
const LOG_ROTATED_PATH = join(LOG_DIR, 'hook-failures.1.jsonl');
const LOG_MAX_BYTES = 1_048_576; // 1 MiB

function rotateIfNeeded() {
  try {
    const size = statSync(LOG_PATH).size;
    if (size >= LOG_MAX_BYTES) {
      renameSync(LOG_PATH, LOG_ROTATED_PATH);
    }
  } catch { /* file does not exist yet, nothing to rotate */ }
}

/**
 * Append a structured failure record. Never throws.
 *
 * @param {object} args
 * @param {string} args.hook — hook id, e.g. 'session-start' or 'pre-push-gate'
 * @param {Error|string} args.err — caught error or message
 * @param {object} [args.input] — relevant subset of the hook input (avoid large payloads)
 * @param {string} [args.phase] — hook lifecycle phase: 'parse' | 'execute' | 'cleanup'
 */
export function logHookFailure({ hook, err, input, phase = 'execute' } = {}) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    rotateIfNeeded();
    const entry = {
      ts: new Date().toISOString(),
      hook: String(hook || 'unknown'),
      phase,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 4).join('\n') : null,
      input: input ? safeShallow(input) : null,
      pid: process.pid,
    };
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch { /* hook telemetry is best-effort and must never block the hook itself */ }
}

function safeShallow(obj) {
  try {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
      } else if (Array.isArray(v)) {
        out[k] = `[${v.length} items]`;
      } else {
        out[k] = '[object]';
      }
    }
    return out;
  } catch {
    return null;
  }
}
