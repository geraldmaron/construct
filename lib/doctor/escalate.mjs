/**
 * lib/doctor/escalate.mjs — bridge from L0 watchers to L1 personas.
 *
 * Wraps the role-framework gateway so watchers stay decoupled from it. Every
 * escalation is also recorded in the doctor audit log so the L0 timeline is
 * complete on its own.
 */

import { record } from './audit.mjs';

export async function escalate({ watcher, eventType, summary, context = null }) {
  let result;
  try {
    const { recordAndMaybeInvoke } = await import('../roles/gateway.mjs');
    result = await recordAndMaybeInvoke(eventType, { summary, context });
  } catch (err) {
    result = { recorded: false, escalated: false, reason: 'gateway-load-failed', error: String(err) };
  }
  record({
    kind: 'escalate',
    watcher,
    action: 'role-event',
    target: eventType,
    result: result.escalated ? 'escalated' : (result.recorded ? 'recorded' : 'failed'),
    summary,
    context: { ...result, originalContext: context },
  });
  return result;
}
