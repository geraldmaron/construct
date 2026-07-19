/**
 * Workspace Preset language helper.
 *
 * Each Workspace Preset carries a `rebrand` block: how the active preset
 * wants the intake queue and individual signal items named in user-facing
 * surfaces (CLI output, daemon logs, session-start prelude).
 */

import { resolveActiveWorkspacePreset } from './loader.mjs';

export const DEFAULT_REBRAND = Object.freeze({
  intakeQueueLabel: 'Intake queue',
  signalNoun: 'signal',
});

export function getRebrand(rootDir) {
  if (!rootDir || typeof rootDir !== 'string') return { ...DEFAULT_REBRAND };
  try {
    const workspacePreset = resolveActiveWorkspacePreset(rootDir);
    const rb = workspacePreset?.rebrand;
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
