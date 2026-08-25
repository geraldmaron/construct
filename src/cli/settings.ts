/**
 * cli/settings.ts — the two declared settings a workspace carries: how
 * Construct engages with it, and whether it has given standing consent for
 * low-risk outward changes.
 *
 * Both are declared rather than inferred from usage, and both print whether or
 * not the call changed anything — the value is knowing where a workspace
 * stands, which is not something to have to infer from whether a change went
 * out.
 */

import {
  ENGAGEMENT_MODES,
  engagementMode,
  setEngagementMode,
  setWriteConsent,
  writeConsentAllowsLowRisk,
} from '../kernel/store/sources.ts';
import type { EngagementMode } from '../kernel/store/sources.ts';
import { resolvePaths } from '../kernel/paths.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags, workspaceFlag } from './flags.ts';
import { projectTrustNote, resolveSettings, SettingsError } from './settings-file.ts';
import type { ResolveInputs } from './settings-file.ts';

const MODE_USAGE = 'usage: construct mode [--workspace=<name>] [--set=<team|seat>]\n';

/**
 * Show or set how a workspace engages: `team` (Construct is the whole team,
 * work tracked its own way) or `seat` (it fills one role on a human team and
 * works inside their tracker). Downstream consent postures read this, so it
 * is a declared setting rather than something inferred from usage.
 */
export function mode(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const workspace = workspaceFlag(flags);
  return withStore((store) => {
    if (flags.set !== undefined) {
      if (!(ENGAGEMENT_MODES as readonly string[]).includes(flags.set)) {
        process.stderr.write(MODE_USAGE);
        return 2;
      }
      setEngagementMode(store, workspace, flags.set as EngagementMode, now());
    }
    const current = engagementMode(store, workspace);
    process.stdout.write(
      `workspace ${workspace}: ${current}` +
        (current === 'team'
          ? ' (Construct is the whole team)\n'
          : ' (Construct fills one role on your team)\n'),
    );
    return 0;
  });
}

const CONSENT_USAGE = 'usage: construct consent [--workspace=<name>] [--set=<on|off>]\n';

/**
 * Show or set a workspace's standing consent for low-risk outward changes.
 *
 * Consent is a setting rather than evidence, so it upserts, and it prints
 * whether or not this call changed it — the value of the command is knowing
 * where a workspace stands, which is not something to have to infer from
 * whether a change went out.
 *
 * It covers exactly one class. A low-risk change under standing consent may
 * be carried out without a decision on that particular change; a high-risk
 * one never may, in any workspace and under any engagement mode, and turning
 * consent on says so out loud rather than leaving the reader to discover the
 * limit from a refusal later. A blanket yes is the wrong shape for the class
 * of change nobody can take back.
 */
export function consent(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const workspace = workspaceFlag(flags);
  if (flags.set !== undefined && flags.set !== 'on' && flags.set !== 'off') {
    process.stderr.write(CONSENT_USAGE);
    return 2;
  }
  return withStore((store) => {
    if (flags.set !== undefined) setWriteConsent(store, workspace, flags.set === 'on', now());
    const allows = writeConsentAllowsLowRisk(store, workspace);
    process.stdout.write(
      `workspace ${workspace}: standing consent ${allows ? 'on' : 'off'}` +
        (allows
          ? ' — a low-risk outward change may be carried out without a decision on each one.\n'
          : ' — every outward change waits for your decision.\n') +
        'High-risk changes are never covered by it: each one waits for ' +
        'construct decide --approve=<id> "<why>".\n',
    );
    return 0;
  });
}

/**
 * Print every file-backed preference, its effective value, and the layer that
 * value came from — a built-in default, the global file, an admitted project
 * file, a CONSTRUCT_* environment variable, or a flag. This is the whole point
 * of the ladder: a preference whose winning layer a person has to discover by
 * opening files in turn is a preference nobody can reason about.
 *
 * Consent-bearing settings are deliberately absent here. They do not resolve
 * from a file, so they have no layer to name; `construct mode` and
 * `construct consent` remain the one place each is read and set.
 */
export function settings(argv: string[]): number {
  const { flags } = parseFlags(argv);
  const inputs: ResolveInputs = {
    paths: resolvePaths(),
    cwd: process.cwd(),
    env: process.env,
    flags,
  };
  let resolved;
  let note: string | null;
  try {
    resolved = resolveSettings(inputs);
    note = projectTrustNote(inputs);
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    process.stderr.write(`construct settings: ${error.message}\n`);
    return 1;
  }
  const keyWidth = Math.max(...resolved.map((r) => r.key.length));
  const valueWidth = Math.max(...resolved.map((r) => r.display.length));
  for (const setting of resolved) {
    process.stdout.write(
      `${setting.key.padEnd(keyWidth)}  ${setting.display.padEnd(valueWidth)}  (${setting.source})\n`,
    );
  }
  if (note !== null) process.stdout.write(`\n${escapeForTerminal(note)}\n`);
  return 0;
}
