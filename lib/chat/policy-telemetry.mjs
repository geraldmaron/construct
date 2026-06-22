/**
 * lib/chat/policy-telemetry.mjs — bounded sink for execution-policy degraded-mode
 * events (construct-6zga.1.2 / construct-rv2x).
 *
 * When the owned loop compiles a turn's execution policy from a missing, unknown,
 * or degraded capability profile, the policy collapses to the conservative
 * envelope. The engine records that fact here instead of printing to the chat
 * stream so the degradation is observable (dashboard, diagnostics) without
 * touching the renderer event union or the live transcript. The buffer is
 * in-process and bounded; it is a diagnostic signal, not durable state.
 */

const RECENT = [];
const MAX_EVENTS = 50;

export function recordPolicyTelemetry(event = {}) {
  const entry = {
    kind: typeof event.kind === 'string' ? event.kind : 'execution-policy-degraded',
    model: event.model ?? null,
    capabilityClass: event.capabilityClass ?? 'unknown',
    reasons: Array.isArray(event.reasons) ? [...event.reasons] : [],
  };
  RECENT.push(entry);
  if (RECENT.length > MAX_EVENTS) RECENT.shift();
  return entry;
}

export function recentPolicyTelemetry() {
  return RECENT.map((e) => ({ ...e, reasons: [...e.reasons] }));
}

export function clearPolicyTelemetry() {
  RECENT.length = 0;
}
