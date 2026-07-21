/**
 * lib/workplace-loop/fingerprint.mjs — deterministic content fingerprinting
 * for the workplace loop's no-fabrication guarantee (construct-b0nny.25,
 * generalizing spike D's static-file sha256 fingerprint,
 * docs/notes/research/workspace-control-plane/spikes/d-daily-workplace-loop/
 * loop/run-loop.mjs's fingerprintFixture()).
 *
 * Spike D fingerprinted fixed local files. Production sources return live
 * API responses that carry volatile fields (rate-limit headers, request
 * echoes, `updated_at` timestamps that tick even when nothing meaningful
 * changed server-side is out of scope here — a real `updated_at` change IS
 * meaningful). fingerprintSignalInputs hashes only the caller-supplied
 * normalized record set, so the caller — not this module — decides which
 * fields are load-bearing for "did anything change" by choosing what it
 * normalizes into the record before fingerprinting. Records are sorted by id
 * first so fingerprint stability does not depend on API response ordering,
 * which real GitHub/Jira/Slack search endpoints do not guarantee run to run.
 */

import crypto from 'node:crypto';

/**
 * @param {Array<{id: string}>} records - normalized records, each carrying a
 *   stable `id`; every other field is fingerprinted as-is.
 * @returns {string} sha256 hex digest
 */
export function fingerprintSignalInputs(records) {
  const sorted = [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const hash = crypto.createHash('sha256');
  for (const record of sorted) {
    hash.update(record.id);
    hash.update(' ');
    hash.update(JSON.stringify(record, Object.keys(record).sort()));
    hash.update(' ');
  }
  return hash.digest('hex');
}
