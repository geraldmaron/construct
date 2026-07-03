/**
 * lib/mcp/denied-store.mjs — durable store for denied policy decisions.
 *
 * LMCP-I3: a PolicyDenied throw is a transient exception unless the decision
 * that produced it is also written somewhere a reviewer can re-open later.
 * DeniedStore appends one JSONL line per denied decision to
 * `<rootDir>/.cx/denied-decisions.jsonl` — append-only, never rewritten, so a
 * repeated-denial pattern for one actor+tool is visible as a policy-tuning
 * signal without replaying the audit-trail chain. Every record uses the same
 * schema as the audit-trail entry for the same decision — {decisionId, actor,
 * tenant, project, tool, target, risk, outcome, correlationId, ts} — so the
 * two stores can be cross-referenced by decisionId. Disk I/O is best-effort:
 * a write failure never breaks the broker call it originated from.
 */

import fs from 'node:fs';
import path from 'node:path';

const DENIED_STORE_SUBPATH = path.join('.cx', 'denied-decisions.jsonl');

export function deniedStorePath(rootDir) {
  return path.join(rootDir, DENIED_STORE_SUBPATH);
}

export class DeniedStore {
  constructor({ rootDir, file } = {}) {
    if (!rootDir && !file) throw new Error('DeniedStore: rootDir or file is required');
    this.file = file || deniedStorePath(rootDir);
  }

  /**
   * Append a denied-decision record. Returns the record on success, or null
   * if the write failed (disk full, permissions) — best-effort, never throws.
   *
   * @param {object} record - {decisionId, actor, tenant, project, tool, target, risk, outcome, correlationId, ts}
   */
  append(record) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
      return record;
    } catch {
      return null;
    }
  }

  /**
   * Read all durable denied records. Returns [] if the store is absent or
   * unreadable rather than throwing — a missing store means zero denials so
   * far, not a hard error.
   */
  readAll() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /** Find denied records matching decisionId. Linear scan — store is low-volume by design. */
  findByDecisionId(decisionId) {
    return this.readAll().filter((r) => r.decisionId === decisionId);
  }

  /** Find denied records matching correlationId, tying a denial back to its originating call. */
  findByCorrelationId(correlationId) {
    return this.readAll().filter((r) => r.correlationId === correlationId);
  }
}
