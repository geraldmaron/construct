/**
 * lib/chat/command-suggest.mjs — Tab completion for in-session slash commands.
 *
 * Completes command names and visible argument options (/set keys, /export scopes,
 * squad ids, configured model ids) from the live HELP catalog and project registry.
 */

import fs from 'node:fs';
import path from 'node:path';

import { HELP } from './commands.mjs';
import { LAYER_KEYS, PERMISSION_MODES, SANDBOX_LEVELS, INSPECTOR_MODES } from './config.mjs';
import { assembleRegistry, listTeamsFromRegistry } from '../registry/assemble.mjs';
import { findConstructRoot } from '../artifact-manifest.mjs';
import { listChatModels } from '../../apps/chat/engine/models.mjs';

export const SLASH_COMMANDS = [...new Set(HELP.map(([name]) => name.split(/\s+/)[0]))];

const SET_KEYS = [...new Set([
  ...LAYER_KEYS,
  'thinking',
  'permission',
  'sandbox',
  'model',
  'ascii',
  'inspector',
  'banner',
  'theme',
])];
const ON_OFF = ['on', 'off'];
const EXPORT_SCOPES = ['last', 'session'];
const DEMO_SUBCOMMANDS = ['next', 'steps', 'reset'];

function prefixMatch(candidates, prefix) {
  const p = String(prefix || '').toLowerCase();
  if (!p) return [...candidates];
  return candidates.filter((c) => c.toLowerCase().startsWith(p));
}

function splitInput(line) {
  const trimmed = line.trimStart();
  const parts = trimmed.split(/\s+/);
  return {
    trimmed,
    parts,
    cmd: (parts[0] || '').toLowerCase(),
    argPrefix: parts[parts.length - 1] || '',
    completingFirstArg: parts.length === 2,
  };
}

export function buildSlashCompletionContext({ cwd = process.cwd(), env = process.env } = {}) {
  const teamIds = [];
  const demoIds = [];
  try {
    const root = findConstructRoot(cwd) || cwd;
    const reg = assembleRegistry(root);
    teamIds.push(...listTeamsFromRegistry(reg, { kind: 'squad' }).map((t) => t.id));
    const demoDir = path.join(root, 'templates', 'demos', 'scripts');
    if (fs.existsSync(demoDir)) {
      for (const name of fs.readdirSync(demoDir)) {
        if (name.endsWith('.json')) demoIds.push(name.replace(/\.json$/, ''));
      }
    }
  } catch { /* registry optional outside construct root */ }

  const modelIds = listChatModels({ env, cwd })
    .filter((m) => m.configured)
    .map((m) => m.id);

  return { teamIds, modelIds, demoIds };
}

export function resolveSlashCompletions(line, ctx = {}) {
  const { trimmed, parts, cmd, argPrefix, completingFirstArg } = splitInput(line);
  if (!trimmed.startsWith('/')) return [];

  if (parts.length <= 1) return prefixMatch(SLASH_COMMANDS, cmd);

  const sub = (parts[1] || '').toLowerCase();

  switch (cmd) {
    case '/set':
      if (parts.length === 2) return prefixMatch(SET_KEYS, sub);
      if (parts.length >= 3) {
        const key = parts[1]?.toLowerCase();
        if (key === 'permission') return prefixMatch(PERMISSION_MODES, argPrefix);
        if (key === 'sandbox') return prefixMatch(SANDBOX_LEVELS, argPrefix);
        if (key === 'inspector') return prefixMatch(INSPECTOR_MODES, argPrefix);
        if (key === 'theme') return prefixMatch(['auto', 'light', 'dark'], argPrefix);
        return prefixMatch(ON_OFF, argPrefix);
      }
      break;
    case '/export':
      return prefixMatch(EXPORT_SCOPES, completingFirstArg ? sub : argPrefix);
    case '/inspect':
      return prefixMatch(INSPECTOR_MODES, completingFirstArg ? sub : argPrefix);
    case '/skills':
      if (parts.length === 2) return prefixMatch(['suggest'], sub);
      break;
    case '/team':
      return prefixMatch(ctx.teamIds || [], completingFirstArg ? sub : argPrefix);
    case '/model':
      return prefixMatch(ctx.modelIds || [], completingFirstArg ? sub : argPrefix);
    case '/demo':
      return prefixMatch(DEMO_SUBCOMMANDS, completingFirstArg ? sub : argPrefix);
    case '/loop':
      return [];
    default:
      break;
  }
  return [];
}

export function filterSlashCommands(line, ctx = {}) {
  return resolveSlashCompletions(line, ctx);
}

export function createSlashCompleter(ctx = {}) {
  return (line) => {
    const hits = resolveSlashCompletions(line, ctx);
    const { trimmed, parts } = splitInput(line);
    const display = parts[0] || trimmed;
    if (hits.length) return [hits, display];
    if (parts.length <= 1 && trimmed.startsWith('/')) {
      return [prefixMatch(SLASH_COMMANDS, display), display];
    }
    return [[], display];
  };
}
