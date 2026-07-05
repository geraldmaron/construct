/**
 * lib/security/recall-wrapper.mjs — Trust-aware context assembly for recalled
 * records.
 *
 * Before a set of recalled observations or documents is assembled into model
 * context, callers pass them through `wrapForContextAssembly`. Records
 * stamped as external (authenticated or unauthenticated) are wrapped with
 * explicit untrusted delimiters. Internal and team-authored records pass
 * through unchanged. Unstamped records are warned and treated as the most
 * restrictive level: EXTERNAL_UNAUTHENTICATED.
 *
 * The module is additive — existing memory, recall, or context assembly code is not modified.
 * Integration is left to follow-on beads (N2, N4).
 *
 * References: CX-AUDIT-LLMSEC-001, construct-9oi4.14.1
 */

import { TRUST_LEVELS, recallTrustGrade, stampTrust, wrapUntrusted } from './trust.mjs';

// Trust levels that require the untrusted-delimiter treatment.
const UNTRUSTED_LEVELS = new Set([
  TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
  TRUST_LEVELS.EXTERNAL_AUTHENTICATED,
]);

/**
 * Wrap a single recalled record for safe context assembly.
 *
 * - TRUSTED_INTERNAL / TEAM_AUTHORED → returned as-is.
 * - EXTERNAL_AUTHENTICATED / EXTERNAL_UNAUTHENTICATED → content wrapped with
 *   `[UNTRUSTED:…]` delimiters in both the `content` field (if present) and
 *   as a `_wrappedContent` convenience field.
 * - No `_trust` stamp → warned, treated as EXTERNAL_UNAUTHENTICATED.
 *
 * @param {Record<string, unknown>} record  A recalled observation/document.
 * @param {{ warn?: (msg: string) => void }} [opts]
 * @returns {Record<string, unknown>} Wrapped or passthrough record.
 */
export function wrapRecordForContext(record, opts = {}) {
  const warn = opts.warn ?? ((msg) => console.warn('[recall-wrapper]', msg));
  let trustMeta = recallTrustGrade(record);

  if (trustMeta === null) {
    warn(
      `Recalled record has no _trust stamp — treating as ${TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED}. ` +
      `Record keys: ${Object.keys(record ?? {}).join(', ') || '(empty)'}`,
    );
    // Re-stamp defensively so downstream consumers always see _trust.
    const stamped = stampTrust(
      record,
      TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
      'unstamped-recall',
    );
    trustMeta = stamped._trust;
    record = stamped;
  }

  if (!UNTRUSTED_LEVELS.has(trustMeta.level)) {
    // TRUSTED_INTERNAL or TEAM_AUTHORED — pass through unchanged.
    return record;
  }

  // External content: wrap any present content field and attach _wrappedContent.
  const rawContent = record.content ?? record.text ?? record.body ?? null;
  const wrapped = rawContent != null
    ? wrapUntrusted(String(rawContent), trustMeta)
    : null;

  return {
    ...record,
    ...(wrapped != null ? { _wrappedContent: wrapped } : {}),
  };
}

/**
 * Wrap an array of recalled records for safe context assembly.
 *
 * Iterates each record through `wrapRecordForContext`. The returned array
 * preserves original order. Non-object entries are returned as-is with a
 * warning (defensive).
 *
 * @param {unknown[]} records  Array of recalled observations or documents.
 * @param {{ warn?: (msg: string) => void }} [opts]
 * @returns {unknown[]} Array of wrapped/passthrough records.
 */
export function wrapForContextAssembly(records, opts = {}) {
  if (!Array.isArray(records)) {
    throw new TypeError('wrapForContextAssembly: records must be an array');
  }
  const warn = opts.warn ?? ((msg) => console.warn('[recall-wrapper]', msg));

  return records.map((record, idx) => {
    if (record === null || typeof record !== 'object') {
      warn(`Record at index ${idx} is not an object — skipping wrap (type: ${typeof record})`);
      return record;
    }
    return wrapRecordForContext(record, { warn });
  });
}
