/**
 * lib/profiles/rebrand.mjs — Profile-aware language helper.
 *
 * Each curated profile carries a `rebrand` block: how the active profile
 * wants the intake queue and individual signal items named in user-facing
 * surfaces (CLI output, daemon logs, session-start prelude). The helper
 * centralises that lookup so every consumer goes through one path with
 * safe defaults instead of hardcoding "intake queue" / "signal" / "intake".
 *
 * Defaults match the legacy strings so behaviour is unchanged for the rnd
 * profile and for any environment where profile resolution fails.
 */

import { resolveActiveProfile } from './loader.mjs';

export const DEFAULT_REBRAND = Object.freeze({
  intakeQueueLabel: 'Intake queue',
  signalNoun: 'signal',
});

/**
 * Return the active profile's rebrand labels.
 *
 * @param {string} [rootDir] - project root where profile.json / construct.config.json live.
 * @returns {{ intakeQueueLabel: string, signalNoun: string }}
 *
 * Returns defaults when `rootDir` is missing, when the profile cannot be
 * loaded, or when the profile omits its `rebrand` block. Never throws.
 */
export function getRebrand(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') return { ...DEFAULT_REBRAND };
  try {
    const profile = resolveActiveProfile(rootDir);
    const rb = profile?.rebrand;
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
