/**
 * lib/config/alias.mjs — resolves the user-facing Construct alias.
 *
 * Lookup precedence:
 *   1. CONSTRUCT_ALIAS env var (per-session override)
 *   2. config.json.aliasOverride in the XDG config dir (user-level, lets each
 *      user on the same project see their own branding without
 *      committing it)
 *   3. construct.config.json.alias (project-level, committed)
 *   4. "Construct" (the default)
 *
 * Pure resolution — no fs writes. The alias flows to the dashboard
 * wordmark (via /api/alias), persona prompts ({{alias}} template at
 * sync time), and CLI banner output.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProjectConfig } from './project-config.mjs';
import { configDir } from './xdg.mjs';

export const DEFAULT_ALIAS = 'Construct';
export const ALIAS_ENV_KEY = 'CONSTRUCT_ALIAS';
export const ALIAS_TEMPLATE_TOKEN = /\{\{alias\}\}/g;

export function resolveAlias({ cwd = process.cwd(), env = process.env, homeDir = os.homedir() } = {}) {
  const envAlias = env?.[ALIAS_ENV_KEY];
  if (typeof envAlias === 'string' && envAlias.trim()) {
    return { value: envAlias.trim(), source: 'env' };
  }

  try {
    const userCfgPath = path.join(configDir(homeDir), 'config.json');
    if (fs.existsSync(userCfgPath)) {
      const userCfg = JSON.parse(fs.readFileSync(userCfgPath, 'utf8'));
      const userAlias = userCfg?.aliasOverride;
      if (typeof userAlias === 'string' && userAlias.trim()) {
        return { value: userAlias.trim(), source: 'user' };
      }
    }
  } catch { /* user file is best-effort */ }

  try {
    const { config, source } = loadProjectConfig(cwd, env);
    if (source === 'file' && typeof config?.alias === 'string' && config.alias.trim()) {
      return { value: config.alias.trim(), source: 'project' };
    }
  } catch { /* project config is best-effort */ }

  return { value: DEFAULT_ALIAS, source: 'default' };
}

export function applyAliasToTemplate(text, alias) {
  if (typeof text !== 'string') return text;
  const safe = String(alias ?? DEFAULT_ALIAS).trim() || DEFAULT_ALIAS;
  return text.replace(ALIAS_TEMPLATE_TOKEN, safe);
}
