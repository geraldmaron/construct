/**
 * kernel/project/config.ts — project.json, per-user defaults, and how a
 * configuration value is resolved.
 *
 * Five tiers, lowest first: built-in default, per-user presentation defaults,
 * committed project config, environment, explicit flag. Every key says which
 * tiers may set it. A committed file can describe presentation and project
 * policy; it can never grant consent, carry a secret, name an executable, or
 * switch on external writes, and the file reader refuses such keys outright.
 */

import { join } from 'node:path';
import type { Paths } from '../paths.ts';
import {
  ProjectFileError,
  expectFormat,
  expectRecord,
  expectString,
  isRecord,
  refuseForbiddenKeys,
} from './files.ts';

export const PROJECT_CONFIG_FORMAT = 'construct-project';
export const PROJECT_CONFIG_VERSION = 2;

export const USER_DEFAULTS_FORMAT = 'construct-user-defaults';
export const USER_DEFAULTS_VERSION = 1;
export const USER_DEFAULTS_FILE_NAME = 'config.json';

export const CONFIG_TIERS = [
  'built-in default',
  'user defaults',
  'project config',
  'environment',
  'flag',
] as const;
export type ConfigTier = (typeof CONFIG_TIERS)[number];

export interface ConfigKeySpec {
  readonly key: string;
  readonly description: string;
  /** Tiers above the built-in default that may set this key. */
  readonly settableBy: readonly Exclude<ConfigTier, 'built-in default'>[];
  readonly envVar?: string;
  readonly flag?: string;
  readonly fallback: unknown;
  /** Validate a value from a file (JSON) or a scalar (env, flag). */
  parse(raw: unknown, where: string): unknown;
}

const EXECUTOR_ID = /^[a-z][a-z0-9-]{1,40}$/;

function oneOf(allowed: readonly string[]): ConfigKeySpec['parse'] {
  return (raw, where) => {
    if (typeof raw !== 'string' || !allowed.includes(raw)) {
      throw new ProjectFileError(where, `must be one of ${allowed.join(' | ')}`);
    }
    return raw;
  };
}

function positiveInteger(raw: unknown, where: string): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ProjectFileError(where, 'must be a positive whole number');
  }
  return value;
}

export const CONFIG_KEYS: readonly ConfigKeySpec[] = Object.freeze([
  {
    key: 'locale',
    description: 'Language and region for prose Construct writes to you.',
    settableBy: ['user defaults', 'project config', 'environment', 'flag'],
    envVar: 'CONSTRUCT_LOCALE',
    flag: '--locale',
    fallback: 'en-US',
    parse(raw, where) {
      if (typeof raw !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(raw)) {
        throw new ProjectFileError(where, 'must be a language tag such as en-US');
      }
      return raw;
    },
  },
  {
    key: 'color',
    description: 'Whether terminal output uses color. Meaning is never carried by color alone.',
    settableBy: ['user defaults', 'environment', 'flag'],
    envVar: 'CONSTRUCT_COLOR',
    flag: '--color',
    fallback: 'auto',
    parse: oneOf(['auto', 'always', 'never']),
  },
  {
    key: 'headless.executor',
    description: 'The one runner scheduled and event-driven work may use. An id from the executor registry, never a path.',
    settableBy: ['project config', 'environment', 'flag'],
    envVar: 'CONSTRUCT_HEADLESS_EXECUTOR',
    flag: '--executor',
    fallback: null,
    parse(raw, where) {
      if (raw === null) return null;
      if (typeof raw !== 'string' || !EXECUTOR_ID.test(raw)) {
        throw new ProjectFileError(where, 'must be an executor id (letters, digits, dashes), not a path or a command');
      }
      return raw;
    },
  },
  {
    key: 'policy.projectWrite',
    description: 'When Construct may write project files: only inside a managed outcome, or never.',
    settableBy: ['project config'],
    fallback: 'managed',
    parse: oneOf(['managed', 'never']),
  },
  {
    key: 'sources.defaultFreshnessHours',
    description: 'How old a source read may be before it counts as stale, when the source declares no expectation.',
    settableBy: ['project config', 'environment'],
    envVar: 'CONSTRUCT_SOURCE_FRESHNESS_HOURS',
    fallback: 168,
    parse: positiveInteger,
  },
  {
    key: 'review.cadence',
    description: 'How often the standing constitution review runs.',
    settableBy: ['project config'],
    fallback: 'monthly',
    parse: oneOf(['weekly', 'monthly', 'quarterly', 'none']),
  },
]);

export const CONFIG_KEY_NAMES: readonly string[] = Object.freeze(CONFIG_KEYS.map((k) => k.key));

export function configKey(key: string): ConfigKeySpec | null {
  return CONFIG_KEYS.find((k) => k.key === key) ?? null;
}

export interface ProjectConfig {
  readonly format: typeof PROJECT_CONFIG_FORMAT;
  readonly formatVersion: typeof PROJECT_CONFIG_VERSION;
  /** Stable identity, minted at init and committed. */
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** Behavior keys, each validated by its CONFIG_KEYS spec. */
  readonly behavior: Readonly<Record<string, unknown>>;
}

export function newProjectConfig(input: { readonly id: string; readonly name: string; readonly at: string }): ProjectConfig {
  return {
    format: PROJECT_CONFIG_FORMAT,
    formatVersion: PROJECT_CONFIG_VERSION,
    id: input.id,
    name: input.name,
    createdAt: input.at,
    behavior: {},
  };
}

function validateBehavior(
  raw: unknown,
  path: string,
  tier: 'user defaults' | 'project config',
): Record<string, unknown> {
  if (raw === undefined) return {};
  const record = expectRecord(raw, path, tier === 'project config' ? '"behavior"' : '"values"');
  refuseForbiddenKeys(record, path);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const spec = configKey(key);
    if (!spec) {
      throw new ProjectFileError(path, `unknown key "${key}"; allowed: ${CONFIG_KEY_NAMES.join(', ')}`);
    }
    if (!spec.settableBy.includes(tier)) {
      throw new ProjectFileError(path, `"${key}" cannot be set by ${tier}; it is set by ${spec.settableBy.join(' or ')}`);
    }
    out[key] = spec.parse(value, `${path} "${key}"`);
  }
  return out;
}

export function validateProjectConfig(raw: unknown, path: string): ProjectConfig {
  const record = expectRecord(raw, path);
  expectFormat(record, path, PROJECT_CONFIG_FORMAT, PROJECT_CONFIG_VERSION);
  refuseForbiddenKeys(record, path);
  const allowed = new Set(['format', 'formatVersion', 'id', 'name', 'createdAt', 'behavior']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new ProjectFileError(path, `unknown top-level key "${key}"`);
  }
  return {
    format: PROJECT_CONFIG_FORMAT,
    formatVersion: PROJECT_CONFIG_VERSION,
    id: expectString(record, 'id', path),
    name: expectString(record, 'name', path),
    createdAt: expectString(record, 'createdAt', path),
    behavior: validateBehavior(record.behavior, path, 'project config'),
  };
}

export interface UserDefaults {
  readonly format: typeof USER_DEFAULTS_FORMAT;
  readonly formatVersion: typeof USER_DEFAULTS_VERSION;
  readonly values: Readonly<Record<string, unknown>>;
}

export function userDefaultsPath(paths: Paths): string {
  return join(paths.configDir, USER_DEFAULTS_FILE_NAME);
}

export function validateUserDefaults(raw: unknown, path: string): UserDefaults {
  const record = expectRecord(raw, path);
  expectFormat(record, path, USER_DEFAULTS_FORMAT, USER_DEFAULTS_VERSION);
  return {
    format: USER_DEFAULTS_FORMAT,
    formatVersion: USER_DEFAULTS_VERSION,
    values: validateBehavior(record.values, path, 'user defaults'),
  };
}

export interface ResolvedConfigValue {
  readonly key: string;
  readonly value: unknown;
  readonly source: ConfigTier;
  /** Where exactly: a file path, an environment variable, a flag, or "built-in". */
  readonly origin: string;
  readonly description: string;
}

export interface ResolveConfigInput {
  readonly userDefaults?: { readonly path: string; readonly values: Readonly<Record<string, unknown>> } | null;
  readonly projectConfig?: { readonly path: string; readonly behavior: Readonly<Record<string, unknown>> } | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Flags already split into name → raw value, e.g. { '--locale': 'fr-FR' }. */
  readonly flags?: Readonly<Record<string, string>>;
}

export interface ConfigCandidate {
  readonly source: ConfigTier;
  readonly origin: string;
  readonly value: unknown;
  readonly applies: boolean;
}

/** Every tier's offer for one key, lowest first, and which one wins. */
export function explainConfig(input: ResolveConfigInput, key: string): {
  readonly effective: ResolvedConfigValue;
  readonly candidates: readonly ConfigCandidate[];
} {
  const spec = configKey(key);
  if (!spec) throw new Error(`unknown configuration key "${key}"; known keys: ${CONFIG_KEY_NAMES.join(', ')}`);
  const candidates: ConfigCandidate[] = [
    { source: 'built-in default', origin: 'built-in', value: spec.fallback, applies: true },
  ];
  const user = input.userDefaults;
  if (user && key in user.values && spec.settableBy.includes('user defaults')) {
    candidates.push({ source: 'user defaults', origin: user.path, value: user.values[key], applies: true });
  }
  const project = input.projectConfig;
  if (project && key in project.behavior && spec.settableBy.includes('project config')) {
    candidates.push({ source: 'project config', origin: project.path, value: project.behavior[key], applies: true });
  }
  const envRaw = spec.envVar ? input.env?.[spec.envVar] : undefined;
  if (spec.envVar && envRaw !== undefined && envRaw !== '' && spec.settableBy.includes('environment')) {
    candidates.push({ source: 'environment', origin: spec.envVar, value: spec.parse(envRaw, spec.envVar), applies: true });
  }
  const flagRaw = spec.flag ? input.flags?.[spec.flag] : undefined;
  if (spec.flag && flagRaw !== undefined && spec.settableBy.includes('flag')) {
    candidates.push({ source: 'flag', origin: spec.flag, value: spec.parse(flagRaw, spec.flag), applies: true });
  }
  const winner = candidates[candidates.length - 1]!;
  return {
    effective: { key, value: winner.value, source: winner.source, origin: winner.origin, description: spec.description },
    candidates,
  };
}

export function resolveConfig(input: ResolveConfigInput): ResolvedConfigValue[] {
  return CONFIG_KEYS.map((spec) => explainConfig(input, spec.key).effective);
}

export function resolveConfigValue(input: ResolveConfigInput, key: string): unknown {
  return explainConfig(input, key).effective.value;
}

/** Flags of the form --key=value or --key value, restricted to known config flags. */
export function configFlagsFrom(argv: readonly string[]): Record<string, string> {
  const known = new Set(CONFIG_KEYS.map((k) => k.flag).filter((f): f is string => typeof f === 'string'));
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!known.has(name)) continue;
    if (eq !== -1) {
      out[name] = arg.slice(eq + 1);
    } else if (typeof argv[i + 1] === 'string' && !argv[i + 1]!.startsWith('--')) {
      out[name] = argv[i + 1]!;
      i += 1;
    }
  }
  return out;
}

export function isConfigRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
