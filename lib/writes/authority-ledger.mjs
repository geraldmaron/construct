/**
 * lib/writes/authority-ledger.mjs — the one durable ledger every authority
 * decision behind the governed-write chokepoint (lib/writes/control-plane.mjs)
 * appends to, regardless of which surface produced the decision: a queued
 * provider-write intent reaching execution, an MCP destructive-tool
 * approval-token issuance/consumption (lib/mcp/destructive-approval.mjs), or
 * a role-fence action that needed human visibility (formerly
 * lib/roles/approval-surface.mjs, deleted — its three callers now import
 * recordApprovalNotice from here directly).
 *
 * Deliberately lightweight: only node:fs/node:path and config-dir.mjs, so a
 * hot-path hook (lib/hooks/edit-guard.mjs, guard-bash.mjs) that lazily
 * imports recordApprovalNotice never pulls in control-plane.mjs's heavier
 * provider-adapter-factory graph. control-plane.mjs re-exports this module's
 * authority-recording API as part of declaring itself the sole governed-write
 * path, but does not require every caller to import control-plane.mjs itself.
 *
 * Append-only; a record here documents a decision made elsewhere (an
 * ApprovalQueue state transition, a destructive-gate token check, a
 * role-fence verdict) — this module never itself authorizes or blocks
 * anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { configPath } from '../config-dir.mjs';

/** Absolute path to the project-scoped authority-ledger JSONL file. */
export function resolvePersistPath(rootDir) {
  return configPath(rootDir ?? process.cwd(), 'writes', 'authority-ledger.jsonl');
}

/**
 * Append one authority decision to the ledger.
 *
 * @param {object} entry
 * @param {string} entry.kind - 'provider-write' | 'destructive-token' | 'role-fence'
 * @param {string} [entry.scope] - e.g. 'jira.issue', 'storage_reset', 'edit'
 * @param {string} entry.decision - 'approved' | 'denied' | 'issued' | 'consumed' | 'requested'
 * @param {object} [entry.actor] - identity the decision concerns
 * @param {string} [entry.reason]
 * @param {object} [entry.meta]
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @returns {object} the persisted record
 */
export function recordAuthorityEvent(entry, opts = {}) {
  const record = {
    ts: new Date().toISOString(),
    kind: entry.kind,
    scope: entry.scope ?? null,
    decision: entry.decision,
    actor: entry.actor ?? {},
    reason: entry.reason ?? null,
    meta: entry.meta ?? null,
  };
  const file = resolvePersistPath(opts.rootDir);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    process.stderr.write('[authority-ledger.mjs] record: ' + (err?.message ?? String(err)) + '\n');
  }
  return record;
}

/**
 * Read back ledger entries, optionally filtered by kind.
 *
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 * @param {string} [opts.kind]
 * @returns {object[]}
 */
export function listAuthorityEvents(opts = {}) {
  const file = resolvePersistPath(opts.rootDir);
  let records = [];
  try {
    if (!fs.existsSync(file)) return records;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
    }
  } catch {
    return [];
  }
  return opts.kind ? records.filter((r) => r.kind === opts.kind) : records;
}

/**
 * Record a role-fence action that needed human visibility — the direct
 * replacement for the deleted lib/roles/approval-surface.mjs's
 * recordApprovalRequest(). Same semantic guarantee (an approval is recorded
 * and the operator is notified before the guarded action proceeds), routed
 * through the shared ledger instead of a standalone JSONL + notification
 * module. Best-effort: any failure here never blocks the caller (a guard
 * hook must never fail its own tool call over a notification problem).
 *
 * @param {object} spec
 * @param {string} spec.personaId
 * @param {string} spec.action
 * @param {string} [spec.target]
 * @param {string} [spec.reason]
 * @param {object} [spec.context]
 * @param {object} [opts]
 * @param {string} [opts.rootDir]
 */
export async function recordApprovalNotice({ personaId, action, target = '', reason = '', context = null }, opts = {}) {
  if (process.env.CONSTRUCT_ROLES === 'off') return;

  recordAuthorityEvent({
    kind: 'role-fence',
    scope: action,
    decision: 'requested',
    actor: { personaId },
    reason,
    meta: { target: String(target).slice(0, 512), context },
  }, opts);

  try {
    const mod = await import('../embed/notifications.mjs');
    if (typeof mod.emitEmbedNotification === 'function') {
      mod.emitEmbedNotification({
        type: 'warning',
        source: 'roles',
        message: `cx-${personaId} requesting approval: ${action} ${String(target).slice(0, 80)}`,
        meta: { personaId, action, target, reason },
      });
    }
  } catch { /* best effort */ }
}
