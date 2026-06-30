/**
 * lib/providers/secret-audit-wiring.mjs — connect secret resolution to the durable
 * audit trail.
 *
 * enableSecretAuditTrail routes the value-free events from secret-resolver into the
 * append-only audit log (lib/audit-trail.mjs). Only actual op:// resolutions are
 * recorded — the prompt-bearing, security-significant events — not cache hits or
 * high-frequency plain reads, so the resolve path is not serialized behind a file
 * lock. The materialized secret value is never available to this layer and is never
 * written. Wiring is per-process: the CLI entrypoint enables it; worker and daemon
 * processes are a tracked follow-up.
 */

import { appendAuditRecord } from '../audit-trail.mjs';
import { setSecretAuditSink } from './secret-resolver.mjs';

export function enableSecretAuditTrail({ file } = {}) {
  setSecretAuditSink((event) => {
    if (event.event !== 'secret.op_read' || event.cacheHit) return;
    appendAuditRecord(
      {
        ts: new Date().toISOString(),
        tool: 'secret-resolver',
        action: 'op_read',
        ref: event.ref,
        ok: event.ok,
        code: event.code ?? null,
      },
      file ? { file } : {},
    );
  });
}
