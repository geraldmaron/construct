/**
 * lib/providers/credential-bootstrap.mjs — lazy credential linking for Construct.
 *
 * Before any LLM surface runs, missing API keys can be satisfied from existing
 * stores or a one-time 1Password link into the XDG config.env. Runs at
 * the construct CLI entrypoint in presence-check mode; op item list runs only
 * when autoLink:true (scripts/setup-credentials.mjs).
 */

import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { hasAnySecret } from './secret-resolver.mjs';
import { API_KEY_CREDENTIALS, primaryEnvVar } from './credential-catalog.mjs';
import {
  discoverAlternateRawForCredential,
  discoverAlternateRawForVar,
  readRawFromOpenCodeProvider,
  readRawFromCredsStore,
  openCodeConfigPath,
} from './credential-sources.mjs';
import { writeEnvValues, getUserEnvPath, ensureUserConfigDir } from '../env-config.mjs';

export {
  discoverAlternateRawForVar,
  readRawFromOpenCodeProvider,
  readRawFromCredsStore,
  openCodeConfigPath,
} from './credential-sources.mjs';

export function commandExists(command) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32'
    ? [command]
    : ['-lc', `command -v ${command}`], { encoding: 'utf8', timeout: 3000 });
  return r.status === 0;
}

function defaultOpRun(args) {
  return spawnSync('op', args, { encoding: 'utf8', timeout: 12_000 });
}

export function listOpItems({ opRun = defaultOpRun } = {}) {
  const result = opRun(['item', 'list', '--format', 'json']);
  if (result.status !== 0 || !result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function titleMatches(item, titles = []) {
  const title = String(item?.title || '').trim().toLowerCase();
  return titles.some((candidate) => title === candidate || title.includes(candidate));
}

export function pickOpItem(items = [], { titles = [] } = {}) {
  const normalized = items.filter((item) => item?.id && item?.vault?.name);
  const exact = normalized.filter((item) => {
    const title = String(item.title || '').trim().toLowerCase();
    return titles.some((candidate) => title === candidate);
  });
  const pool = exact.length
    ? exact
    : normalized.filter((item) => titleMatches(item, titles));
  if (!pool.length) return null;
  const dev = pool.find((item) => String(item.vault.name).toLowerCase().includes('development'));
  return dev || pool[0];
}

export function opRefFromItem(item, field = 'credential') {
  if (!item?.id || !item?.vault?.name) return null;
  const resolvedField = item.fields?.find((f) => f.label === field || f.purpose === 'API_KEY')?.label || field;
  return `op://${item.vault.name}/${item.id}/${resolvedField}`;
}

function credentialPresent(entry, { env, cwd, home }) {
  if (hasAnySecret(entry.envVars, { env, cwd })) return true;
  return Boolean(discoverAlternateRawForCredential(entry, { home }));
}

function linkCredentialFromOnePassword(entry, { home, persist, opItems }) {
  const item = pickOpItem(opItems, { titles: entry.opTitles });
  const ref = item ? opRefFromItem(item, entry.opField) : null;
  if (!ref) return null;
  if (persist) {
    ensureUserConfigDir(home);
    const file = getUserEnvPath(home);
    writeEnvValues(file, { [primaryEnvVar(entry)]: ref });
    try { fs.chmodSync(file, 0o600); } catch { /* best-effort */ }
  }
  return { id: entry.id, envVar: primaryEnvVar(entry), ref };
}

let lastBootstrapResult = null;

function bootstrapSkipped(env) {
  if (env.NODE_ENV === 'test' || env.CI === 'true') return true;
  return false;
}

function missingCredentials({ env, cwd, home }) {
  return API_KEY_CREDENTIALS.filter((entry) => !credentialPresent(entry, { env, cwd, home }));
}

export function ensureConstructCredentials({
  env = process.env,
  cwd = process.cwd(),
  home = os.homedir(),
  persist = true,
  opRun = defaultOpRun,
  force = false,
  autoLink = false,
} = {}) {
  if (lastBootstrapResult && !force) return lastBootstrapResult;

  if (bootstrapSkipped(env)) {
    lastBootstrapResult = { linked: [], opAvailable: false, skipped: 'hermetic' };
    return lastBootstrapResult;
  }

  const missing = missingCredentials({ env, cwd, home });
  if (missing.length === 0) {
    lastBootstrapResult = { linked: [], opAvailable: commandExists('op') };
    return lastBootstrapResult;
  }

  if (!autoLink) {
    lastBootstrapResult = { linked: [], opAvailable: commandExists('op'), pending: missing.map((e) => e.id) };
    return lastBootstrapResult;
  }

  const linked = [];
  const opAvailable = opRun !== defaultOpRun || commandExists('op');
  if (!opAvailable) {
    lastBootstrapResult = { linked, opAvailable: false };
    return lastBootstrapResult;
  }

  const opItems = listOpItems({ opRun });
  for (const entry of missing) {
    const link = linkCredentialFromOnePassword(entry, { home, persist, opItems });
    if (link) linked.push(link);
  }

  lastBootstrapResult = { linked, opAvailable: true };
  return lastBootstrapResult;
}

export function __resetCredentialBootstrapCache() {
  lastBootstrapResult = null;
}

export function formatCredentialBootstrapNotice(result) {
  if (!result?.linked?.length) return null;
  const names = result.linked.map((entry) => entry.id).join(', ');
  return `Credentials linked from 1Password: ${names}`;
}

export const readOpenRouterRawFromOpenCode = (configPath) => readRawFromOpenCodeProvider('openrouter', configPath);
export const readOpenRouterRawFromCreds = () => readRawFromCredsStore('openrouter');
export const discoverOpenRouterAlternateRaw = (opts) => discoverAlternateRawForCredential(
  API_KEY_CREDENTIALS.find((e) => e.id === 'openrouter'),
  opts,
);
export const pickOpenRouterOpItem = (items) => pickOpItem(items, { titles: ['openrouter', 'openrouter api key'] });
export const openRouterOpRefFromItem = (item) => opRefFromItem(item, 'credential');

export function ensureOpenRouterCredential(opts = {}) {
  const result = ensureConstructCredentials(opts);
  const link = result.linked.find((entry) => entry.id === 'openrouter') || null;
  return { linked: Boolean(link), source: link ? '1password' : null, ref: link?.ref || null };
}

export function needsOpenRouterForModel(modelId) {
  return typeof modelId === 'string' && /^openrouter\//.test(modelId);
}
