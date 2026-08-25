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

import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  ENGAGEMENT_MODES,
  engagementMode,
  setEngagementMode,
  setWriteConsent,
  writeConsentAllowsLowRisk,
} from '../kernel/store/sources.ts';
import type { EngagementMode } from '../kernel/store/sources.ts';
import {
  latestRatificationForRepo,
  ratifySettingsFile,
  revokeRatification,
  settingsFileRatified,
} from '../kernel/store/ratifications.ts';
import type { Ratification } from '../kernel/store/ratifications.ts';
import { resolvePaths } from '../kernel/paths.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags, workspaceFlag } from './flags.ts';
import {
  discoverProjectSettings,
  fileValuesToObject,
  PREFERENCE_KEYS,
  projectTrustNote,
  renderFileValue,
  resolveSettings,
  resolveSettingValue,
  SettingsError,
} from './settings-file.ts';
import type { FileValues, ProjectDiscovery, ResolveInputs } from './settings-file.ts';
import type { Store } from '../kernel/store/open.ts';

/** The user's home, the discovery floor when a working directory sits under no repository. */
function homeDir(): string {
  return process.env.HOME ?? homedir();
}

/** The workspace a command should act in, and whether it fell to the shared default with nothing binding it. */
export interface EffectiveWorkspace {
  readonly workspace: string;
  /**
   * True only when the value is the shared `default` and nothing set it — no
   * `--workspace`, no CONSTRUCT_WORKSPACE, no ratified project binding. This is
   * the exposed case: a repository whose sources and outcomes pool in the one
   * workspace every other repository under this HOME also reads.
   */
  readonly unboundDefault: boolean;
}

/**
 * The one sentence a command prints when it is about to write into the shared
 * `default` workspace with nothing scoping it there. Named so `source add` and
 * `outcome` say the same thing about the same exposure.
 */
export const SHARED_DEFAULT_WORKSPACE_NOTICE =
  "this lands in the shared 'default' workspace, visible to every repo on this machine; " +
  'scope it with --workspace=<name> or bind one in .construct/settings.json';

/**
 * Which workspace a command runs in, resolved through the same ladder
 * `construct settings` prints: an explicit `--workspace` wins, then
 * CONSTRUCT_WORKSPACE, then a ratified project file's binding, then the shared
 * `default`. A malformed or untrusted-shaped project file cannot decide it —
 * that is surfaced by `construct settings` and `construct trust`, not by
 * failing the command that only wanted to know where to file its work — so a
 * parse refusal falls back to the shared default, flagged as unbound.
 */
export function effectiveWorkspace(store: Store, flagValue: string | undefined): EffectiveWorkspace {
  const trimmed = flagValue?.trim();
  const inputs: ResolveInputs = {
    paths: resolvePaths(),
    cwd: process.cwd(),
    env: process.env,
    flags: trimmed ? { workspace: trimmed } : {},
    home: homeDir(),
    ratified: (repoIdentity, hash) => settingsFileRatified(store, repoIdentity, hash),
  };
  let resolved: { readonly value: unknown; readonly source: string } | null;
  try {
    resolved = resolveSettingValue(inputs, 'workspace');
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    return { workspace: 'default', unboundDefault: true };
  }
  const workspace = resolved ? String(resolved.value) : 'default';
  const unboundDefault = workspace === 'default' && (resolved === null || resolved.source === 'built-in default');
  return { workspace, unboundDefault };
}

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
  // The store is opened first, and opening it resolves `state` through this
  // same ladder to know where the store lives — so a malformed or
  // consent-bearing project file refuses at the ladder before the body below
  // ever runs. Catching SettingsError around the whole command, not only
  // around the resolve inside it, is what turns that refusal into a one-line
  // error instead of an uncaught stack trace.
  try {
    return withStore((store) => {
      const inputs: ResolveInputs = {
        paths: resolvePaths(),
        cwd: process.cwd(),
        env: process.env,
        flags,
        home: homeDir(),
        ratified: (repoIdentity, hash) => settingsFileRatified(store, repoIdentity, hash),
      };
      const resolved = resolveSettings(inputs);
      const note = projectTrustNote(inputs);
      const keyWidth = Math.max(...resolved.map((r) => r.key.length));
      const valueWidth = Math.max(...resolved.map((r) => r.display.length));
      for (const setting of resolved) {
        process.stdout.write(
          `${setting.key.padEnd(keyWidth)}  ${setting.display.padEnd(valueWidth)}  (${setting.source})\n`,
        );
      }
      if (note !== null) process.stdout.write(`\n${escapeForTerminal(note)}\n`);
      return 0;
    });
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    process.stderr.write(`construct settings: ${error.message}\n`);
    return 1;
  }
}

const TRUST_USAGE =
  'usage: construct trust [--ratify|--revoke]\n' +
  '  Show the project settings file discovered under this repository and whether\n' +
  '  it is trusted. A checked-out .construct/settings.json is its author\'s, not\n' +
  '  yours, so it informs nothing until you trust its exact bytes: --ratify does\n' +
  '  that for this repository, --revoke withdraws it.\n';

/**
 * Show a project settings file and whether it is trusted, or trust or withdraw
 * trust in its exact current bytes.
 *
 * A file checked out of a repository is attacker-authored ground, so it is inert
 * until ratified, per repository and per the hash of its bytes. Showing it is
 * safe because every value is hardened for the terminal on the way out — the
 * escaping the schema promises holds here too — and a whitespace-only edit is a
 * different hash, so trust never carries silently across a change.
 */
export function trust(argv: string[]): number {
  const { flags, rest } = parseFlags(argv);
  const known = new Set(['ratify', 'revoke']);
  const unknown = Object.keys(flags).filter((flag) => !known.has(flag));
  if (
    unknown.length > 0 ||
    rest.length > 0 ||
    (flags.ratify !== undefined && flags.revoke !== undefined)
  ) {
    process.stderr.write(TRUST_USAGE);
    return 2;
  }

  let discovery: ProjectDiscovery;
  try {
    discovery = discoverProjectSettings(process.cwd(), homeDir());
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    process.stderr.write(`construct trust: ${error.message}\n`);
    return 1;
  }
  if (discovery.outcome === 'absent') {
    process.stdout.write(
      'construct trust: no project settings file (.construct/settings.json) under this repository.\n',
    );
    return 0;
  }
  if (discovery.outcome === 'refused') {
    process.stderr.write(
      `construct trust: ${escapeForTerminal(discovery.path)} was refused — ${escapeForTerminal(discovery.reason)}.\n`,
    );
    return 1;
  }

  const found = discovery;
  return withStore((store) => {
    if (flags.revoke !== undefined) {
      const removed = revokeRatification(store, found.repoIdentity, found.hash);
      process.stdout.write(
        removed
          ? `construct trust: withdrew trust for ${escapeForTerminal(found.path)}.\n`
          : `construct trust: nothing to withdraw — ${escapeForTerminal(found.path)} was not trusted at its current bytes.\n`,
      );
      return 0;
    }
    if (flags.ratify !== undefined) {
      const ratification: Ratification = {
        repoIdentity: found.repoIdentity,
        contentHash: found.hash,
        path: found.path,
        settings: fileValuesToObject(found.values),
        ratifiedAt: now(),
      };
      ratifySettingsFile(store, ratification);
      process.stdout.write(
        `construct trust: trusted ${escapeForTerminal(found.path)}.\n` +
          '  Its values inform runs in this repository until the file\'s bytes change.\n',
      );
      return 0;
    }
    if (settingsFileRatified(store, found.repoIdentity, found.hash)) {
      process.stdout.write(
        `construct trust: ${escapeForTerminal(found.path)} is trusted; its values inform runs.\n`,
      );
      return 0;
    }
    renderPending(found, latestRatificationForRepo(store, found.repoIdentity));
    return 0;
  });
}

/** Print one settings value per line, each hardened for the terminal. */
function writeValues(keys: readonly string[], value: (key: string) => string | null): void {
  for (const key of keys) {
    const shown = value(key);
    if (shown !== null) process.stdout.write(`    ${key} = ${shown}\n`);
  }
}

/**
 * Show a not-yet-trusted file. On a first ask, or a file that is different from
 * the one previously trusted, the whole file is shown and its path named. On a
 * re-ask for the same path with new bytes, only the keys that changed are shown,
 * because that is the whole of what a person is being asked to re-approve — and
 * the message says which case it is, so a changed file is never mistaken for a
 * different one.
 */
function renderPending(
  found: Extract<ProjectDiscovery, { outcome: 'found' }>,
  prior: Ratification | null,
): void {
  const out = process.stdout;
  const path = escapeForTerminal(found.path);
  if (prior !== null && resolve(prior.path) === resolve(found.path)) {
    out.write(`construct trust: the trusted project settings file has changed.\n  ${path}\n`);
    const changed = changedKeys(found.values, prior.settings);
    if (changed.length === 0) {
      out.write('    (its bytes changed but no value did — a whitespace or ordering edit)\n');
    } else {
      writeValues(changed, (key) => valueLine(found.values, prior.settings, key));
    }
  } else {
    if (prior !== null) {
      out.write(
        'construct trust: a different project settings file is now in effect, and it is not trusted.\n' +
          `  now:     ${path}\n  trusted: ${escapeForTerminal(prior.path)}\n`,
      );
    } else {
      out.write(`construct trust: a project settings file is not yet trusted.\n  ${path}\n`);
    }
    writeValues(PREFERENCE_KEYS, (key) =>
      found.values.has(key) ? renderFileValue(key, found.values.get(key)) : null,
    );
  }
  out.write('  Trust it with: construct trust --ratify\n');
}

/** The preference keys whose value differs between the file in hand and a prior ratification. */
function changedKeys(current: FileValues, prior: Readonly<Record<string, unknown>>): string[] {
  return PREFERENCE_KEYS.filter((key) => {
    const here = current.has(key) ? JSON.stringify(current.get(key)) : undefined;
    const there = key in prior ? JSON.stringify(prior[key]) : undefined;
    return here !== there;
  });
}

/** One changed key's current value, hardened — or its removal, when the new file drops it. */
function valueLine(
  current: FileValues,
  prior: Readonly<Record<string, unknown>>,
  key: string,
): string {
  if (current.has(key)) return renderFileValue(key, current.get(key));
  return key in prior ? '(removed)' : '(none)';
}
