/**
 * lib/doctor/watchers/provider-breaker.mjs — surfaces open provider circuit breakers.
 *
 * Reads lib/providers/circuit-breaker.mjs's describeBreakers(), which lib/
 * providers/registry.mjs populates by wrapping every resolved provider's read/
 * search/watch/write/webhook methods (failureThreshold=5, cooldownMs=30_000).
 * Surfaces that breaker state continuously, so a downed provider shows as
 * "provider X circuit OPEN since T, N failures" in the doctor audit log and
 * role-escalation path instead of a mystery failure.
 *
 * Escalates once per open episode (keyed by the breaker's own `openedAt`), not
 * once per tick, so a provider stuck OPEN for an hour doesn't spam. Recovery
 * to CLOSED/HALF_OPEN logs a plain recovery record. Tick: 60s.
 */

import { record } from '../audit.mjs';
import { escalate } from '../escalate.mjs';
import { describeBreakers } from '../../providers/circuit-breaker.mjs';

export const name = 'provider-breaker';
export const intervalMs = 60 * 1000;

const PROVIDER_KEY_PREFIX = 'provider:';
const escalatedOpenedAt = {};

export async function tick() {
  const actions = [];
  const escalations = [];
  const notes = [];

  const breakers = describeBreakers().filter((b) => b.key.startsWith(PROVIDER_KEY_PREFIX));

  for (const breaker of breakers) {
    const providerId = breaker.key.slice(PROVIDER_KEY_PREFIX.length);
    notes.push({ id: providerId, state: breaker.state, failureCount: breaker.failureCount });

    if (breaker.state !== 'open') {
      if (escalatedOpenedAt[providerId]) {
        record({
          kind: 'recovery',
          watcher: name,
          target: providerId,
          summary: `${providerId} provider circuit recovered (was OPEN since ${new Date(escalatedOpenedAt[providerId]).toISOString()})`,
          context: { previousOpenedAt: escalatedOpenedAt[providerId] },
        });
      }
      delete escalatedOpenedAt[providerId];
      continue;
    }

    if (escalatedOpenedAt[providerId] === breaker.openedAt) continue;

    const summary = `${providerId} provider circuit OPEN since ${new Date(breaker.openedAt).toISOString()} (${breaker.failureCount} consecutive failures)`;
    record({
      kind: 'sample',
      watcher: name,
      target: providerId,
      result: 'open',
      summary,
      context: { openedAt: breaker.openedAt, failureCount: breaker.failureCount },
    });

    const result = await escalate({
      watcher: name,
      eventType: 'provider.circuit_open',
      summary,
      context: { provider: providerId, openedAt: breaker.openedAt, failureCount: breaker.failureCount },
    });
    escalatedOpenedAt[providerId] = breaker.openedAt;
    escalations.push({ eventType: 'provider.circuit_open', provider: providerId, result });
  }

  return { actions, escalations, notes };
}

export function __resetProviderBreakerWatcherState() {
  for (const key of Object.keys(escalatedOpenedAt)) delete escalatedOpenedAt[key];
}
