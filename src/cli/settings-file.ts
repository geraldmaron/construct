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
 *
 * `state` is the one preference whose effect is not "how Construct behaves"
 * but "where Construct keeps what it knows": `local` roots the sqlite store
 * inside the repository instead of the user's home directory, for the
 * fully-embedded case of a disposable environment where the repository is the
 * only thing that persists. It resolves through this same ladder — a file
 * still needs ratifying before it can set it — but where it actually takes
 * effect, and the refusal that guards a repo-local store from being
 * accidentally committable, live in cli/local-state.ts, not here: this module
 * only says what a valid value looks like.
 */

import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Paths } from '../kernel/paths.ts';
import { HOST_NAMES } from './host-names.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { escapeForPrompt } from '../kernel/run/sourcereads.ts';
import { symlinkToward } from './skills.ts';

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
 * One preference key's whole definition: where it reads from in each layer, how
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

const STATE_VALUES = ['home', 'local'] as const;
type StateValue = (typeof STATE_VALUES)[number];

/**
 * Where the sqlite store lives: `home`, under the user's data directory (the
 * default), or `local`, inside the repository — see cli/local-state.ts for
 * where that second value actually takes effect and the refusal that guards
 * it. Validated here the same way `host` is: an enum, not a path, because a
 * value that resolved to an arbitrary filesystem location would let a
 * checked-out file point Construct's client-fact store anywhere on disk.
 */
function validateState(raw: unknown, where: string): StateValue {
  if (typeof raw !== 'string') {
    throw new SettingsError(`${where}: state must be "local" or "home", not ${typeof raw}`);
  }
  const value = raw.trim();
  if (!(STATE_VALUES as readonly string[]).includes(value)) {
    throw new SettingsError(`${where}: state must be "local" or "home" — got "${value}"`);
  }
  return value as StateValue;
}

const MAX_WORKSPACE_NAME_LENGTH = 64;

/**
 * A workspace name a file may bind the repository to: a plain label, never a
 * path. The path check is the whole point of validating it here — a workspace
 * that resolved to `../other` or an absolute location would let a checked-out
 * file steer this repository's records into another workspace's store rows,
 * the exact cross-client leak the binding exists to close. Letters, digits,
 * dot, dash, and underscore only, starting on an alphanumeric, so the
 * traversal names `.` and `..` cannot occur.
 */
function validateWorkspace(raw: unknown, where: string): string {
  if (typeof raw !== 'string') {
    throw new SettingsError(`${where}: workspace must be a name like "acme", not ${typeof raw}`);
  }
  const value = raw.trim();
  if (value === '') {
    throw new SettingsError(`${where}: workspace is a name like "acme", not empty`);
  }
  if (value.length > MAX_WORKSPACE_NAME_LENGTH) {
    throw new SettingsError(
      `${where}: a workspace name runs to ${value.length} characters; keep it under ${MAX_WORKSPACE_NAME_LENGTH}`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new SettingsError(
      `${where}: workspace names a workspace (letters, digits, dot, dash, underscore), not a path — got "${value}"`,
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
  {
    key: 'state',
    envVar: 'CONSTRUCT_STATE',
    flag: 'state',
    fallback: 'home',
    fromFile: (raw) => validateState(raw, 'settings file'),
    fromScalar: (raw) => validateState(raw, 'setting'),
    show: (value) => value as string,
    harden: (shown) => escapeForTerminal(shown),
  },
  {
    // Which workspace a repository's declared sources, outcomes, and records
    // belong to. Bound in a ratified project file so that checking a client's
    // repository out is enough to keep its ground out of the shared `default`
    // pool every other repository under one HOME would otherwise share. The
    // value is a name, validated against paths the same way `host` is.
    key: 'workspace',
    envVar: 'CONSTRUCT_WORKSPACE',
    flag: 'workspace',
    fallback: 'default',
    fromFile: (raw) => validateWorkspace(raw, 'settings file'),
    fromScalar: (raw) => validateWorkspace(raw, 'setting'),
    show: (value) => value as string,
    harden: (shown) => escapeForTerminal(shown),
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
 * Hold parsed settings text to the closed schema: a JSON object, every key a
 * preference key, every value parsing. The `where` names the file (or the fact
 * that these are ratified bytes) so a refusal points somewhere. Shared by every
 * reader, whichever way the bytes reached it, so one file and another are held
 * to exactly the same schema.
 */
function parseSettings(text: string, where: string): FileValues {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SettingsError(`${where}: not valid JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SettingsError(`${where}: a settings file is a JSON object of preferences`);
  }
  const values = new Map<string, unknown>();
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    const spec = SPEC_BY_KEY.get(key);
    if (!spec) refuseUnknownKey(key);
    values.set(key, spec.fromFile(raw));
  }
  return values;
}

/**
 * Read and validate one settings file by path. A file that is not there
 * contributes nothing (null). This is for the global file, which lives in the
 * user's own config directory and is theirs to write; a project file, which is
 * a repository's and therefore an attacker's to write, does not come through
 * here — it comes through {@link discoverProjectSettings}, which reads its bytes
 * once behind the trust guards rather than by re-opening a path.
 */
export function readSettingsFile(path: string): FileValues | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseSettings(text, path);
}

/**
 * Render one file value the way it will be shown to a person: through the same
 * spec that hardens it for the terminal (and, for ground hints, for a prompt
 * line as well), so a value from a checked-out file cannot carry a byte that
 * moves the cursor or forges a boundary. A key with no spec cannot occur in a
 * validated FileValues, but is escaped defensively rather than trusted.
 */
export function renderFileValue(key: string, value: unknown): string {
  const spec = SPEC_BY_KEY.get(key);
  return spec ? spec.harden(spec.show(value)) : escapeForTerminal(String(value));
}

/** A validated FileValues as a plain object, for storage beside a ratification. */
export function fileValuesToObject(values: FileValues): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [key, value] of values) object[key] = value;
  return object;
}

/** The global settings file: one per machine, beside every other Construct state. */
export function globalSettingsPath(paths: Paths): string {
  return join(paths.configDir, 'settings.json');
}

/** Whether a key names a file-backed preference — the whole of what a file, or
 * `construct settings set`, may write. */
export function isPreferenceKey(key: string): boolean {
  return SPEC_BY_KEY.has(key);
}

/**
 * Validate a scalar value (as typed at the CLI) for one file-backed preference,
 * returning its parsed form. This is the same validation the ladder applies to
 * an environment variable or a flag, reused so `construct settings set` refuses
 * exactly what a file would — a host that is a path, a malformed locale — rather
 * than writing an unusable value the next read would reject. Throws
 * SettingsError for an unknown key or an unusable value.
 */
export function parseFileSettingScalar(key: string, raw: string): unknown {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) {
    throw new SettingsError(`"${key}" is not a file setting (allowed: ${PREFERENCE_KEYS.join(', ')})`);
  }
  return spec.fromScalar(raw);
}

/**
 * Write one preference into the global settings file, preserving every other
 * key already there, and return the path written.
 *
 * The global file is the user's own — it lives under their config directory,
 * never in a checked-out repository — so it needs no ratification, which is the
 * whole reason `construct settings set` targets it: a project file is
 * attacker-authored ground, trusted rather than written. The value is stored in
 * the parsed, validated form the caller supplies, so it round-trips through the
 * same closed schema on the next read.
 */
export function writeGlobalSetting(paths: Paths, key: string, value: unknown): string {
  const path = globalSettingsPath(paths);
  const existing = readSettingsFile(path);
  const object = existing ? fileValuesToObject(existing) : {};
  object[key] = value;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(object, null, 2)}\n`, { mode: 0o600 });
  return path;
}

const PROJECT_SETTINGS_DIR = '.construct';
const PROJECT_SETTINGS_FILE = 'settings.json';

/** The raw-bytes SHA-256 of a settings file, hex. */
export function hashSettingsBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Two absolute paths naming the same directory, compared by segment not prefix. */
function sameDir(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

/** Whether `dir` is `ceiling` or lies inside it, by path segment rather than string prefix. */
function withinOrEqual(dir: string, ceiling: string): boolean {
  const rel = relative(resolve(ceiling), resolve(dir));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.startsWith(sep));
}

/**
 * The nearest ancestor of `cwd` (or `cwd` itself) that is a git root — a
 * directory carrying a `.git`, whether that is a directory (an ordinary
 * checkout), a file (a worktree or a submodule), or a link. Nearest wins, so a
 * repository nested inside another resolves to its own root and discovery never
 * reaches the outer one. Null when no ancestor carries a `.git`.
 */
export function gitRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    try {
      lstatSync(join(dir, '.git'));
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The best-effort origin remote of a git checkout, as a stable identity for the
 * repository independent of where it sits on disk. Read straight from the config
 * of an ordinary checkout; a worktree or submodule keeps its config elsewhere
 * (its `.git` is a file, not a directory), so those fall through to null and the
 * caller keys on the checkout's real path instead. Never throws: a repository
 * with no remote, or an unreadable config, simply has no remote identity.
 */
function gitOriginRemote(root: string): string | null {
  let text: string;
  try {
    if (!statSync(join(root, '.git')).isDirectory()) return null;
    text = readFileSync(join(root, '.git', 'config'), 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  let inOrigin = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const section = /^\[(.+)\]$/.exec(trimmed);
    if (section) {
      inOrigin = /^remote\s+"origin"$/.test(section[1].trim());
      continue;
    }
    if (!inOrigin) continue;
    const url = /^url\s*=\s*(.+)$/.exec(trimmed);
    if (url) return url[1].trim();
  }
  return null;
}

/**
 * A directory an attacker cannot have planted the file in: one this user owns
 * and that is not writable by the world. Discovery in a world-writable or
 * non-owner directory is refused, because there `/tmp/.construct` — a file any
 * user could drop — would otherwise bind the run. Returns the reason it is
 * unsafe, or null when it is safe. Ownership is only checked where the platform
 * reports a uid; a world-writable bit is refused wherever the platform sets one.
 */
function unsafeDirReason(dir: string): string | null {
  let mode: number;
  let uid: number;
  try {
    const st = statSync(dir);
    mode = st.mode;
    uid = st.uid;
  } catch (error) {
    return `cannot inspect ${dir}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`;
  }
  if ((mode & 0o002) !== 0) return `${dir} is writable by any user on this machine`;
  const self = typeof process.getuid === 'function' ? process.getuid() : null;
  if (self !== null && uid !== self) return `${dir} is not owned by you`;
  return null;
}

/**
 * What a look for a project settings file found. A file only ever *binds* when
 * `found`; `refused` is a file that exists but sits behind a link, in a
 * directory the world can write, or one this user does not own, and it carries
 * the reason so a person can be told why their file was ignored; `absent` is no
 * file in the bounded chain at all.
 */
export type ProjectDiscovery =
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'refused'; readonly path: string; readonly reason: string }
  | {
      readonly outcome: 'found';
      /** The absolute path the file was found at. */
      readonly path: string;
      /** The repository this file's trust is scoped to: its remote, or its real path. */
      readonly repoIdentity: string;
      /** The SHA-256 of the exact bytes read, which is what a ratification is keyed on. */
      readonly hash: string;
      /** The validated values those same bytes parsed to — never re-read by path. */
      readonly values: FileValues;
    };

/**
 * Look for a project settings file that may bind this working directory, and
 * read it under the guards that make a checked-out file safe to consider at all.
 *
 * A project file is attacker-authored ground: cloning a repository hands you
 * whatever `.construct/settings.json` its author wrote. Five things hold before
 * its bytes are ever hashed or its values ever handed back.
 *
 *   - DISCOVERY IS BOUNDED. The walk goes up only as far as the git root of the
 *     working directory — the nearest one, so a nested repository never reaches
 *     the outer tree's file — or, with no git root, the user's home directory.
 *     Above that there is no fallback: an unbounded walk to the filesystem root
 *     is what makes `/tmp/.construct` bind a run in `/tmp`.
 *   - THE DIRECTORY IS THE USER'S. Discovery in a world-writable or non-owner
 *     directory is refused, because there anyone could have planted the file.
 *   - NO COMPONENT IS A LINK. Every path component from the git root down is
 *     lstat'd; a `.construct` or a `settings.json` that is a symbolic link is
 *     refused, because a link is an instruction to read somewhere else.
 *   - THE BYTES ARE READ ONCE. The file is opened with `O_NOFOLLOW` — refusing a
 *     link swapped in at the final component after the walk — read once into a
 *     buffer, and it is that buffer that is hashed and that buffer that is
 *     parsed. Nothing re-opens the path, so the hash and the values are of the
 *     same bytes no later write can change underneath them.
 *   - THE VALUES ARE STILL THE CLOSED SCHEMA. A consent key, an unknown key, a
 *     host that is a path — every refusal the schema already makes holds here
 *     too, because the same parser runs on these bytes as on any other.
 */
export function discoverProjectSettings(cwd: string, home: string | null): ProjectDiscovery {
  const root = gitRoot(cwd);
  // The floor is the git root, or home when there is no repository. With
  // neither — a working directory under no repository and outside home — there
  // is nothing to bound the walk, and an unbounded walk is the vulnerability, so
  // discovery finds nothing rather than climbing to the filesystem root.
  const floor = root ?? (home !== null && withinOrEqual(cwd, home) ? resolve(home) : null);
  if (floor === null) return { outcome: 'absent' };

  let dir = resolve(cwd);
  for (;;) {
    const conDir = join(dir, PROJECT_SETTINGS_DIR);
    const file = join(conDir, PROJECT_SETTINGS_FILE);
    let exists = false;
    try {
      lstatSync(file);
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (exists) return admitProjectFile(floor, dir, conDir, file, root);
    if (sameDir(dir, floor)) return { outcome: 'absent' };
    const parent = dirname(dir);
    if (parent === dir) return { outcome: 'absent' };
    dir = parent;
  }
}

/**
 * The guards for one candidate file, in the order that keeps each meaningful: a
 * link anywhere from the repo root down is refused before the directory's
 * ownership is trusted, ownership before the bytes are opened, and the open
 * itself refuses a link swapped in at the last moment.
 */
function admitProjectFile(
  floor: string,
  dir: string,
  conDir: string,
  file: string,
  root: string | null,
): ProjectDiscovery {
  // Every component from the repo floor down, the audited walk skills.ts uses.
  const link = symlinkToward(floor, file);
  if (link !== null) {
    return { outcome: 'refused', path: file, reason: `${link} is a symbolic link` };
  }
  for (const guarded of [dir, conDir]) {
    const unsafe = unsafeDirReason(guarded);
    if (unsafe !== null) return { outcome: 'refused', path: file, reason: unsafe };
  }

  // Read the bytes exactly once, refusing a link at the final component, and
  // hash and parse that one buffer. Re-opening by path after hashing is the
  // gap a settings file could be swapped through; there is no second open.
  let bytes: Buffer;
  try {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      bytes = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      return { outcome: 'refused', path: file, reason: `${file} is a symbolic link` };
    }
    throw error;
  }

  const values = parseSettings(bytes.toString('utf8'), file);
  const hash = hashSettingsBytes(bytes);
  const remote = root ? gitOriginRemote(root) : null;
  const repoIdentity = remote !== null ? `remote:${remote}` : `path:${realpathSync(file)}`;
  return { outcome: 'found', path: file, repoIdentity, hash, values };
}

export interface ResolveInputs {
  readonly paths: Paths;
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly flags: Record<string, string>;
  /** The user's home directory, the discovery floor when there is no repository. */
  readonly home: string | null;
  /**
   * Whether a discovered project file — identified by its repository and the
   * hash of its exact bytes — has been ratified. The ladder holds no store; the
   * caller supplies this from wherever ratifications live. A file that has not
   * been ratified for this repository and these bytes contributes nothing, which
   * is the whole of the gate.
   */
  readonly ratified: (repoIdentity: string, hash: string) => boolean;
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
 * The three file layers of the ladder, read once for a resolution. Every
 * preference is resolved against the same reading, so one key and another
 * cannot disagree about which project file was in effect or whether it was
 * trusted.
 */
interface LadderContext {
  readonly inputs: ResolveInputs;
  readonly globalValues: FileValues | null;
  readonly projectValues: FileValues | null;
  readonly projectAdmitted: boolean;
}

function ladderContext(inputs: ResolveInputs): LadderContext {
  const globalValues = readSettingsFile(globalSettingsPath(inputs.paths));
  const discovery = discoverProjectSettings(inputs.cwd, inputs.home);
  const projectValues = discovery.outcome === 'found' ? discovery.values : null;
  const projectAdmitted =
    discovery.outcome === 'found' && inputs.ratified(discovery.repoIdentity, discovery.hash);
  return { inputs, globalValues, projectValues, projectAdmitted };
}

/** One preference's winning value and the layer it came from, raw (unhardened). */
function resolveOne(spec: PreferenceSpec, ctx: LadderContext): { value: unknown; source: SettingLayer } {
  const { inputs, globalValues, projectValues, projectAdmitted } = ctx;
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
  return { value, source: won ? won.source : 'built-in default' };
}

/**
 * Resolve every preference against the full ladder, returning each with the
 * layer that won. The project file is read and validated whether or not it is
 * trusted — a malformed project file is a real error the operator should see,
 * and a refused one is not silently ignored either — but its values enter the
 * ladder only once ratified for this repository and these bytes. The
 * ratification check runs before any value is placed in the ladder a run acts
 * on, so an untrusted file has no effect on a resolved setting at all.
 */
export function resolveSettings(inputs: ResolveInputs): ResolvedSetting[] {
  const ctx = ladderContext(inputs);
  return PREFERENCE_SPECS.map((spec) => {
    const { value, source } = resolveOne(spec, ctx);
    return { key: spec.key, display: spec.harden(spec.show(value)), source };
  });
}

/**
 * One preference's resolved value, raw rather than hardened for the screen, so
 * a caller that acts on the value — where a run's records land, which store to
 * open — reads the same name the resolver chose. Null when the key names no
 * preference. Same ladder and same ratification gate as {@link resolveSettings};
 * an untrusted project file contributes nothing here either.
 */
export function resolveSettingValue(
  inputs: ResolveInputs,
  key: string,
): { readonly value: unknown; readonly source: SettingLayer } | null {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) return null;
  return resolveOne(spec, ladderContext(inputs));
}

/**
 * A note for the print command when a project settings file exists but did not
 * inform the run, so the operator learns why rather than suspecting the
 * resolver: it was found and not yet trusted, or it was refused outright. Null
 * when there is nothing to say — no file, or a file already trusted.
 */
export function projectTrustNote(inputs: ResolveInputs): string | null {
  const discovery = discoverProjectSettings(inputs.cwd, inputs.home);
  if (discovery.outcome === 'absent') return null;
  if (discovery.outcome === 'refused') {
    return `a project settings file at ${discovery.path} was refused: ${discovery.reason}`;
  }
  if (inputs.ratified(discovery.repoIdentity, discovery.hash)) return null;
  return (
    `a project settings file at ${discovery.path} was found but is not trusted — ` +
    'review it with `construct trust`, then `construct trust --ratify` to let it inform runs'
  );
}
