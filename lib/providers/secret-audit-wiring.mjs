/**
 * lib/providers/secret-audit-wiring.mjs — connect secret resolution to the durable
 * audit trail.
 *
 * enableSecretAuditTrail routes the value-free events from secret-resolver into the
 * append-only audit log (lib/audit-trail.mjs). Two event types are recorded:
 * - secret.op_read: an actual op:// CLI read (prompt-bearing, never cached)
 * - secret.resolve (non-op): any plaintext tier resolution (project-env, config-env,
 *   home-env, shell-rc, alt-store) — records the source tier, never the value
 * Cache hits on op reads are skipped; op-ref resolve events are skipped because
 * their paired op_read event carries the canonical record. The materialized secret
 * value is never available to this layer and is never written.
 */

import { appendAuditRecord } from '../audit-trail.mjs';
import { setSecretAuditSink } from './secret-resolver.mjs';

export function enableSecretAuditTrail({ file } = {}) {
  const sink = file ? { file } : {};
  setSecretAuditSink((event) => {
    if (event.event === 'secret.op_read') {
      if (event.cacheHit) return;
      appendAuditRecord(
        {
          ts: new Date().toISOString(),
          tool: 'secret-resolver',
          action: 'op_read',
          ref: event.ref,
          ok: event.ok,
          code: event.code ?? null,
        },
        sink,
      );
    } else if (event.event === 'secret.resolve' && !event.isOpRef) {
      appendAuditRecord(
        {
          ts: new Date().toISOString(),
          tool: 'secret-resolver',
          action: 'resolve',
          varName: event.varName,
          source: event.source ?? null,
          ok: event.ok,
          code: event.code ?? null,
        },
        sink,
      );
    }
  });
}
