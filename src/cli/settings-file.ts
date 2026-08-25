/**
 * cli/settings-file.ts — the resolution ladder for a workspace's file-backed
 * preferences, and the closed schema that keeps a file from carrying anything
 * it must not.
 *
 * A preference resolves the way git config does: a built-in default, then a
 * global file, then a project file discovered by walking up the working tree,
 * then a CONSTRUCT_* environment variable, then a flag — each layer overriding
 * the one beneath it. The command that prints them names, per value, the layer
 * it came from, because a settings system a person can only debug by opening
 * files one at a time and guessing which one won has failed at the one thing it
 * exists to do.
 *
 * TWO KINDS OF SETTING, AND ONLY ONE OF THEM LIVES IN A FILE. A preference says
 * how Construct should behave when nothing overrides it: which host to reach
 * for, what locale to write in, what to keep in mind while reading ground. A
 * consent-bearing setting — standing consent for outward writes, the engagement
 * mode a workspace declares — is a statement about what Construct is allowed to
 * do on someone's behalf, and it stays in the store, set by its own command,
 * where it cannot be turned on by a file that happened to be sitting in a
 * checked-out repository.
 *
 * The split is enforced as an ALLOWLIST, not a denylist. PREFERENCE_KEYS is the
 * whole of what a file may carry; every other key is refused outright, so a
 * consent key never reaches a parser because none exists for it, and no alias,
 * case fold, Unicode confusable, or nested restatement of one can slip through a
 * gap a denylist would have left. A key that merely looks like a consent
 * setting is refused with a pointer to where that setting actually lives, but
 * the refusal does not depend on recognizing it: the allowlist already turned
 * it away.
 *
 * WHAT A FILE VALUE CANNOT BE. A `host` is validated at parse to one of the
 * enumerated adapter names — never a path, because a host that is a path is an
 * instruction to execute a program, and a preference file is exactly the place
 * an attacker would write one. Every value this module hands back is rendered
 * for a terminal through escapeForTerminal at the point it is printed; ground
 * hints, which are model-facing, additionally go through escapeForPrompt.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Paths } from '../kernel/paths.ts';
import { HOST_NAMES } from './runtime.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { escapeForPrompt } from '../kernel/run/sourcereads.ts';

/**
 * The layers of the ladder, lowest precedence first. A value's source is the
 * highest of these that carried one.
 */
export const SETTING_LAYERS = [
  'built-in default',
  'global file',
  'project file',
  'environment',
  'flag',
] as const;

export type SettingLayer = (typeof SETTING_LAYERS)[number];

/** A settings file that carried a key it may not, or a value that will not parse. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/**
 * One preference key's whole contract: where it reads from in each layer, how
 * to validate a value out of a file and out of a scalar (env or flag), how to
 * show it, and how to render it safe for the screen. Values are carried as
 * `unknown` across the shared machinery and narrowed inside each spec, because
 * the keys do not share a value type — a host is a string, ground hints are a
 * list — and a single typed table over both would be a lie in one row or the
 * other.
 */
export interface PreferenceSpec {
  /** The key as it appears in a file, and the id the print command shows. */
  readonly key: string;
  /** The environment variable that overrides the files for this key. */
  readonly envVar: string;
  /** The flag that overrides everything for this key. */
  readonly flag: string;
  /** The value with no file, env, or flag saying otherwise. */
  readonly fallback: unknown;
  /** Validate a value read from a JSON file. Throws SettingsError if unusable. */
  fromFile(raw: unknown): unknown;
  /** Validate a value read from an env var or a flag (always a string). */
  fromScalar(raw: string): unknown;
  /** The human form of a value, before terminal escaping. */
  show(value: unknown): string;
  /** Render a shown value safe for the operator's screen. */
  harden(shown: string): string;
}

const HOST_LIST = HOST_NAMES.join('|');

/**
 * A host preference names one of the adapters Construct ships, and nothing
 * else. The path check is not redundant with the enum check: it is the
 * explanation. An enum miss on `./evil.sh` would otherwise read as "not one of
 * these four", burying the fact that the file tried to make the default host a
 * program to run.
 */
function validateHost(raw: unknown, where: string): string {
  if (typeof raw !== 'string') {
    throw new SettingsError(`${where}: host must be one of ${HOST_LIST}, not ${typeof raw}`);
  }
  const value = raw.trim();
  if (value.includes('/') || value.includes('\\') || value.includes('.')) {
    throw new SettingsError(
      `${where}: host names one of the adapters (${HOST_LIST}), not a path — got "${value}"`,
    );
  }
  if (!(HOST_NAMES as readonly string[]).includes(value)) {
    throw new SettingsError(`${where}: "${value}" is not a host Construct ships (${HOST_LIST})`);
  }
  return value;
}

/** A locale tag Construct will write in: BCP-47-shaped, no path or control bytes. */
function validateLocale(raw: unknown, where: string): string {
  if (typeof raw !== 'string') {
    throw new SettingsError(`${where}: locale must be text like "en-US", not ${typeof raw}`);
  }
  const value = raw.trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
    throw new SettingsError(
      `${where}: locale must be a language tag like "en-US" or "pt-BR" — got "${value}"`,
    );
  }
  return value;
}

const MAX_GROUND_HINTS = 20;
const MAX_GROUND_HINT_LENGTH = 200;

/** The ground hints as a validated list: non-empty phrases, bounded in count and length. */
function validateGroundHints(raw: readonly unknown[], where: string): string[] {
  if (raw.length > MAX_GROUND_HINTS) {
    throw new SettingsError(
      `${where}: at most ${MAX_GROUND_HINTS} ground hints, got ${raw.length}`,
    );
  }
  const hints: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new SettingsError(`${where}: every ground hint is text, got ${typeof item}`);
    }
    const hint = item.trim();
    if (hint === '') continue;
    if (hint.length > MAX_GROUND_HINT_LENGTH) {
      throw new SettingsError(
        `${where}: a ground hint runs to ${hint.length} characters; keep each under ${MAX_GROUND_HINT_LENGTH}`,
      );
    }
    hints.push(hint);
  }
  return hints;
}

/**
 * The whole of what a settings file may carry. Adding a key here is the only
 * way to make one legible to a file; a key absent from this list is refused no
 * matter how it is spelled.
 */
export const PREFERENCE_SPECS: readonly PreferenceSpec[] = Object.freeze([
  {
    key: 'host',
    envVar: 'CONSTRUCT_HOST',
    flag: 'host',
    fallback: HOST_NAMES[0],
    fromFile: (raw) => validateHost(raw, 'settings file'),
    fromScalar: (raw) => validateHost(raw, 'setting'),
    show: (value) => value as string,
    harden: (shown) => escapeForTerminal(shown),
  },
  {
    key: 'locale',
    envVar: 'CONSTRUCT_LOCALE',
    flag: 'locale',
    fallback: 'en-US',
    fromFile: (raw) => validateLocale(raw, 'settings file'),
    fromScalar: (raw) => validateLocale(raw, 'setting'),
    show: (value) => value as string,
    harden: (shown) => escapeForTerminal(shown),
  },
  {
    key: 'groundHints',
    envVar: 'CONSTRUCT_GROUND_HINTS',
    flag: 'ground-hint',
    fallback: [] as string[],
    fromFile: (raw) => {
      if (!Array.isArray(raw)) {
        throw new SettingsError('settings file: groundHints is a list of phrases, e.g. ["prefer the ADRs"]');
      }
      return validateGroundHints(raw, 'settings file');
    },
    // A scalar carries several hints separated by commas; the file form (a JSON
    // list) is the way to write a hint that itself contains one.
    fromScalar: (raw) => validateGroundHints(raw.split(','), 'setting'),
    show: (value) => {
      const hints = value as string[];
      return hints.length === 0 ? '(none)' : hints.join(', ');
    },
    // Model-facing text: neutralized for a prompt line as well as for the
    // terminal, so a hint printed here reads the same as it would be handed to a
    // model, with nothing that could forge either boundary.
    harden: (shown) => escapeForTerminal(escapeForPrompt(shown)),
  },
]);

/** Every key a file may legibly carry. */
export const PREFERENCE_KEYS: readonly string[] = Object.freeze(
  PREFERENCE_SPECS.map((s) => s.key),
);

/**
 * Where a consent-bearing setting actually lives, keyed by the names a file
 * might reach for. This is a courtesy on the refusal message, not the gate: the
 * allowlist above has already turned the key away by the time this is
 * consulted, so a name missing from here still gets refused — it just gets the
 * generic message instead of the pointed one.
 */
const CONSENT_KEY_HOMES: Record<string, string> = {
  consent: 'standing consent lives in the store — set it with `construct consent --set=on|off`',
  writeconsent: 'standing consent lives in the store — set it with `construct consent --set=on|off`',
  mode: 'engagement mode lives in the store — set it with `construct mode --set=team|seat`',
  engagement: 'engagement mode lives in the store — set it with `construct mode --set=team|seat`',
  engagementmode: 'engagement mode lives in the store — set it with `construct mode --set=team|seat`',
};

function refuseUnknownKey(key: string): never {
  const home = CONSENT_KEY_HOMES[key.toLowerCase().replace(/[-_\s]/g, '')];
  if (home !== undefined) {
    throw new SettingsError(
      `settings file: "${key}" is not a file setting — ${home}`,
    );
  }
  throw new SettingsError(
    `settings file: "${key}" is not a setting Construct reads from a file ` +
      `(allowed: ${PREFERENCE_KEYS.join(', ')})`,
  );
}

/**
 * The values a settings file supplies, by key, with every unknown key already
 * refused and every known value already validated. Missing keys are simply
 * absent; the ladder fills them from a lower layer.
 */
export type FileValues = ReadonlyMap<string, unknown>;

const SPEC_BY_KEY = new Map(PREFERENCE_SPECS.map((s) => [s.key, s] as const));

/**
 * Read and validate one settings file. A file that is not there contributes
 * nothing (null). A file that is there is held to the closed schema: it must be
 * a JSON object, every key must be a preference key, and every value must
 * parse. Anything else is a SettingsError naming the file, because a preference
 * file that is malformed should say so loudly rather than be half-read.
 */
export function readSettingsFile(path: string): FileValues | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsError(`${path}: not valid JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SettingsError(`${path}: a settings file is a JSON object of preferences`);
  }
  const values = new Map<string, unknown>();
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) refuseUnknownKey(key);
    values.set(key, spec.fromFile(raw));
  }
  return values;
}

/** The global settings file: one per machine, beside every other Construct state. */
export function globalSettingsPath(paths: Paths): string {
  return join(paths.configDir, 'settings.json');
}

const PROJECT_SETTINGS_DIR = '.construct';
const PROJECT_SETTINGS_FILE = 'settings.json';

/**
 * The project settings file nearest the working directory, found by walking up
 * the tree the way git finds `.git`, or null if none is in the ancestry.
 */
export function findProjectSettingsPath(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, PROJECT_SETTINGS_DIR, PROJECT_SETTINGS_FILE);
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * SEAM (project-file trust). Whether a project settings file discovered in the
 * working tree may inform a run is a trust question with its own weight, and its
 * full answer — ratifying a file the way a person ratifies any other input from
 * a checked-out repository — is separate work. Until that gate lands, a project
 * file is admitted only under an explicit opt-in, so a file that merely sits in
 * a repository someone cloned is never silently trusted. When the trust gate
 * arrives it replaces the body of this function with the real ratification
 * check; every reader of the project layer already routes through here, so
 * nothing else has to change to close the hole.
 */
export function projectSettingsAdmitted(env: Record<string, string | undefined>): boolean {
  const optIn = env.CONSTRUCT_TRUST_PROJECT_SETTINGS?.trim().toLowerCase();
  return optIn === '1' || optIn === 'true' || optIn === 'yes' || optIn === 'on';
}

export interface ResolveInputs {
  readonly paths: Paths;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly flags: Record<string, string>;
}

/** One resolved preference: its key, the value shown safe for the screen, and where it came from. */
export interface ResolvedSetting {
  readonly key: string;
  /** The value, hardened for the terminal (and prompt, for ground hints). */
  readonly display: string;
  readonly source: SettingLayer;
}

/**
 * A layer's contribution to one key: its value, or absent. Kept as a small
 * result rather than a bare value so `undefined` from a lower layer cannot be
 * mistaken for a value a higher layer actually set to nothing.
 */
type Contribution = { readonly present: false } | { readonly present: true; readonly value: unknown };

const ABSENT: Contribution = { present: false };

function fromFileLayer(values: FileValues | null, key: string): Contribution {
  if (values && values.has(key)) return { present: true, value: values.get(key) };
  return ABSENT;
}

/**
 * Resolve every preference against the full ladder, returning each with the
 * layer that won. The project file is read and validated whether or not it is
 * admitted — a malformed project file is a real error the operator should see —
 * but its values enter the ladder only when the trust seam admits them.
 */
export function resolveSettings(inputs: ResolveInputs): ResolvedSetting[] {
  const globalValues = readSettingsFile(globalSettingsPath(inputs.paths));
  const projectPath = findProjectSettingsPath(inputs.cwd);
  const projectValues = projectPath ? readSettingsFile(projectPath) : null;
  const projectAdmitted = projectValues !== null && projectSettingsAdmitted(inputs.env);

  return PREFERENCE_SPECS.map((spec) => {
    // Highest precedence first: the first layer that carries a value wins.
    const candidates: Array<{ readonly source: SettingLayer; readonly contribution: Contribution }> = [
      {
        source: 'flag',
        contribution:
          inputs.flags[spec.flag] !== undefined
            ? { present: true, value: spec.fromScalar(inputs.flags[spec.flag]) }
            : ABSENT,
      },
      {
        source: 'environment',
        contribution:
          inputs.env[spec.envVar] !== undefined && inputs.env[spec.envVar] !== ''
            ? { present: true, value: spec.fromScalar(inputs.env[spec.envVar] as string) }
            : ABSENT,
      },
      {
        source: 'project file',
        contribution: projectAdmitted ? fromFileLayer(projectValues, spec.key) : ABSENT,
      },
      { source: 'global file', contribution: fromFileLayer(globalValues, spec.key) },
      { source: 'built-in default', contribution: { present: true, value: spec.fallback } },
    ];

    const won = candidates.find((c) => c.contribution.present);
    // The built-in default is always present, so a winner is guaranteed.
    const value = won && won.contribution.present ? won.contribution.value : spec.fallback;
    return {
      key: spec.key,
      display: spec.harden(spec.show(value)),
      source: won ? won.source : 'built-in default',
    };
  });
}

/**
 * A note for the print command when a project settings file exists but is not
 * admitted, so the operator learns why its values did not take rather than
 * suspecting the resolver. Null when there is nothing to say.
 */
export function projectTrustNote(inputs: ResolveInputs): string | null {
  const projectPath = findProjectSettingsPath(inputs.cwd);
  if (!projectPath) return null;
  if (projectSettingsAdmitted(inputs.env)) return null;
  return (
    `a project settings file at ${projectPath} was found but not applied — ` +
    'set CONSTRUCT_TRUST_PROJECT_SETTINGS=on to opt in until project-file trust ships'
  );
}
