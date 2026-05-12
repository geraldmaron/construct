/**
 * lib/roles/approval-surface.mjs — visibility for approval-required actions.
 *
 * When a persona-tagged session hits an action that lands in the fence's
 * `approvalRequired` bucket (commit, push, out-of-fence edit, etc.), this
 * module appends a marker to ~/.cx/approval-pending.jsonl and emits an SSE
 * toast through the embed notification bus. The user sees a dashboard toast
 * instead of having to grep stderr.
 *
 * Best-effort: any failure is swallowed so guard hooks never get blocked by
 * notification problems.
 */

import { existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PENDING_PATH = join(homedir(), '.cx', 'approval-pending.jsonl');

function ensureDir() {
  const dir = join(homedir(), '.cx');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function recordApprovalRequest({ personaId, action, target = '', reason = '', context = null }) {
  if (process.env.CONSTRUCT_ROLES === 'off') return;
  try {
    ensureDir();
    const entry = {
      ts: Date.now(),
      personaId,
      cxId: `cx-${personaId}`,
      action,
      target: String(target).slice(0, 512),
      reason,
      context,
    };
    appendFileSync(PENDING_PATH, JSON.stringify(entry) + '\n');
  } catch { /* best effort */ }

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

export { PENDING_PATH };
