/**
 * lib/scopes/rebrand.mjs — Scope-aware language helper.
 *
 * Each curated scope carries a `rebrand` block: how the active scope
 * wants the intake queue and individual signal items named in user-facing
 * surfaces (CLI output, daemon logs, session-start prelude).
 */

import { resolveActiveScope } from './loader.mjs';

export const DEFAULT_REBRAND = Object.freeze({
  intakeQueueLabel: 'Intake queue',
  signalNoun: 'signal',
});

export function getRebrand(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') return { ...DEFAULT_REBRAND };
  try {
    const scope = resolveActiveScope(rootDir);
    const rb = scope?.rebrand;
    if (!rb || typeof rb !== 'object') return { ...DEFAULT_REBRAND };
    const intakeQueueLabel = typeof rb.intakeQueueLabel === 'string' && rb.intakeQueueLabel.trim()
      ? rb.intakeQueueLabel.trim()
      : DEFAULT_REBRAND.intakeQueueLabel;
    const signalNoun = typeof rb.signalNoun === 'string' && rb.signalNoun.trim()
      ? rb.signalNoun.trim()
      : DEFAULT_REBRAND.signalNoun;
    return { intakeQueueLabel, signalNoun };
  } catch {
    return { ...DEFAULT_REBRAND };
  }
}
