/**
 * cli/config.ts — read, explain, and set configuration across its five tiers.
 * Setting writes to the tier that may hold the key: presentation keys to the
 * per-user file, project keys to .construct/project.json.
 */

import { existsSync } from 'node:fs';
import {
  CONFIG_KEYS, CONFIG_KEY_NAMES, configKey, explainConfig, resolveConfig, configFlagsFrom,
  validateProjectConfig, validateUserDefaults, userDefaultsPath, USER_DEFAULTS_FORMAT, USER_DEFAULTS_VERSION,
} from '../kernel/project/config.ts';
import { readJsonFile, writeJsonFile } from '../kernel/project/files.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import type { CommandSpec, ParsedArgs } from './commands.ts';
import { stringFlag } from './commands.ts';
import { bindProject, configInputs, createContext, type CliContext, type BoundProject } from './context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';
import { NoProjectError } from '../kernel/project/discover.ts';

const group = 'Configure';
const scopeFlag = { name: 'scope', gloss: 'which file to write: project or user (default: whichever may hold the key)', takesValue: true } as const;

export const CONFIG_SPECS: readonly CommandSpec[] = [
  { path: ['config', 'list'], gloss: 'every setting, its effective value, and where it came from', group, positionals: [], flags: [], readOnly: true },
  { path: ['config', 'get'], gloss: 'the effective value of one setting', group, positionals: ['<key>'], flags: [], readOnly: true },
  { path: ['config', 'explain'], gloss: 'every tier’s offer for one setting and the one that wins', group, positionals: ['<key>'], flags: [], readOnly: true },
  { path: ['config', 'path'], gloss: 'the files configuration is read from', group, positionals: [], flags: [], readOnly: true },
  { path: ['config', 'validate'], gloss: 'check the user and project configuration files', group, positionals: [], flags: [], readOnly: true },
  { path: ['config', 'set'], gloss: 'set one setting in the project or user file', group, positionals: ['<key>', '<value>'], flags: [scopeFlag], readOnly: false },
  { path: ['config', 'unset'], gloss: 'remove one setting from the project or user file', group, positionals: ['<key>'], flags: [scopeFlag], readOnly: false },
];

function tryBind(ctx: CliContext): BoundProject | null {
  try {
    return bindProject(ctx);
  } catch (error) {
    if (error instanceof NoProjectError) return null;
    throw error;
  }
}

function requireKey(key: string | undefined): string {
  if (!key) throw new UsageError('which setting? one of: ' + CONFIG_KEY_NAMES.join(', '));
  if (!configKey(key)) throw new UsageError(`unknown setting "${key}"; known: ${CONFIG_KEY_NAMES.join(', ')}`);
  return key;
}

export function configCommand(sub: string, args: ParsedArgs, argv: readonly string[], ctx: CliContext = createContext()): number {
  const bound = tryBind(ctx);
  const inputs = configInputs(ctx, bound, configFlagsFrom(argv));
  switch (sub) {
    case 'list': {
      const rows = resolveConfig(inputs);
      if (args.json) {
        writeJson(rows);
        return 0;
      }
      const width = Math.max(...rows.map((r) => r.key.length));
      for (const r of rows) say(`${r.key.padEnd(width)}  ${esc(JSON.stringify(r.value))}  (${r.source}${r.origin !== 'built-in' ? `: ${esc(r.origin)}` : ''})`);
      return 0;
    }
    case 'get': {
      const key = requireKey(args.positionals[0]);
      const { effective } = explainConfig(inputs, key);
      if (args.json) writeJson(effective);
      else say(esc(typeof effective.value === 'string' ? effective.value : JSON.stringify(effective.value)));
      return 0;
    }
    case 'explain': {
      const key = requireKey(args.positionals[0]);
      const explained = explainConfig(inputs, key);
      if (args.json) {
        writeJson(explained);
        return 0;
      }
      say(`${key}: ${esc(JSON.stringify(explained.effective.value))} from ${explained.effective.source}${explained.effective.origin !== 'built-in' ? ` (${esc(explained.effective.origin)})` : ''}`);
      say(`  ${esc(explained.effective.description)}`);
      say('  tiers, lowest first:');
      for (const c of explained.candidates) say(`    ${c.source.padEnd(16)} ${esc(JSON.stringify(c.value))}${c.origin !== 'built-in' ? `  ${esc(c.origin)}` : ''}`);
      const spec = configKey(key)!;
      say(`  settable by: ${spec.settableBy.join(', ')}${spec.envVar ? `; env ${spec.envVar}` : ''}${spec.flag ? `; flag ${spec.flag}` : ''}`);
      return 0;
    }
    case 'path': {
      const record = { user: userDefaultsPath(ctx.paths), project: bound?.layout.projectFile ?? null };
      if (args.json) writeJson(record);
      else {
        say(`user defaults: ${esc(record.user)}${existsSync(record.user) ? '' : ' (absent)'}`);
        say(`project config: ${record.project ? esc(record.project) : 'no project bound here'}`);
      }
      return 0;
    }
    case 'validate': {
      const problems: string[] = [];
      const userPath = userDefaultsPath(ctx.paths);
      try {
        readJsonFile(ctx.paths.configDir, userPath, validateUserDefaults);
      } catch (error) {
        problems.push((error as Error).message);
      }
      if (bound) {
        try {
          readProjectFiles(bound.root);
        } catch (error) {
          problems.push((error as Error).message);
        }
      }
      if (args.json) writeJson({ ok: problems.length === 0, problems });
      else if (problems.length === 0) say('configuration files validate');
      else for (const p of problems) say(`problem: ${esc(p)}`);
      return problems.length === 0 ? 0 : 1;
    }
    case 'set':
    case 'unset': {
      const key = requireKey(args.positionals[0]);
      const spec = configKey(key)!;
      const value = args.positionals[1];
      if (sub === 'set' && value === undefined) throw new UsageError(`a value for ${key}`);
      const requested = stringFlag(args, 'scope');
      const scope = requested ?? (spec.settableBy.includes('project config') ? 'project' : 'user');
      if (scope !== 'project' && scope !== 'user') throw new UsageError('--scope must be project or user');
      const tier = scope === 'project' ? 'project config' : 'user defaults';
      if (!spec.settableBy.includes(tier)) {
        throw new OperationError(`${key} cannot be set by ${tier}; it is set by ${spec.settableBy.join(' or ')}`);
      }
      const parsed = sub === 'set' ? spec.parse(value, `--${key}`) : undefined;
      if (scope === 'project') {
        if (!bound?.files.config) throw new NoProjectError(ctx.cwd);
        const behavior = { ...bound.files.config.behavior };
        if (sub === 'set') behavior[key] = parsed;
        else delete behavior[key];
        const next = validateProjectConfig({ ...bound.files.config, behavior }, bound.layout.projectFile);
        writeJsonFile(bound.layout.projectFile, next);
      } else {
        const userPath = userDefaultsPath(ctx.paths);
        const current = readJsonFile(ctx.paths.configDir, userPath, validateUserDefaults);
        const values = { ...(current?.values ?? {}) };
        if (sub === 'set') values[key] = parsed;
        else delete values[key];
        writeJsonFile(userPath, validateUserDefaults({ format: USER_DEFAULTS_FORMAT, formatVersion: USER_DEFAULTS_VERSION, values }, userPath));
      }
      const after = explainConfig(configInputs(ctx, tryBind(ctx), {}), key).effective;
      if (args.json) writeJson({ key, scope, value: sub === 'set' ? parsed : null, effective: after });
      else say(`${sub === 'set' ? 'set' : 'unset'} ${key} in ${scope} config; effective value is now ${esc(JSON.stringify(after.value))} (${after.source})`);
      return 0;
    }
    default:
      throw new UsageError(`config has no subcommand "${sub}"`);
  }
}

export const CONFIG_KEY_COUNT = CONFIG_KEYS.length;
