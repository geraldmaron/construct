/**
 * lib/providers/credential-sources.mjs — non-1Password credential source reads.
 *
 * Reads alternate API-key locations (Construct creds store, OpenCode provider
 * settings) for the secret resolver and bootstrap without invoking op read.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCreds } from './creds.mjs';
import { API_KEY_CREDENTIALS } from './credential-catalog.mjs';

export function openCodeConfigPath(homeDir = os.homedir()) {
  return path.join(homeDir, '.config', 'opencode', 'opencode.json');
}

function isPlaceholder(value) {
  return !value || String(value).includes('__OPENROUTER_API_KEY__');
}

export function readRawFromOpenCodeProvider(providerName, configPath = openCodeConfigPath()) {
  try {
    if (!fs.existsSync(configPath)) return null;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const provider = config?.provider?.[providerName];
    if (!provider) return null;
    if (!isPlaceholder(provider.apiKey)) return String(provider.apiKey).trim();
    const auth = provider.options?.headers?.Authorization;
    if (typeof auth === 'string') {
      const value = auth.replace(/^Bearer\s+/i, '').trim();
      if (!isPlaceholder(value)) return value;
    }
    return null;
  } catch {
    return null;
  }
}

export function readRawFromCredsStore(credsKey) {
  if (!credsKey) return null;
  try {
    const key = readCreds()?.[credsKey]?.key;
    return key ? String(key).trim() : null;
  } catch {
    return null;
  }
}

export function discoverAlternateRawForCredential(entry, { home = os.homedir() } = {}) {
  if (!entry) return null;
  const fromCreds = readRawFromCredsStore(entry.credsKey);
  if (fromCreds) return fromCreds;
  if (entry.openCodeProvider) {
    return readRawFromOpenCodeProvider(entry.openCodeProvider, openCodeConfigPath(home));
  }
  return null;
}

export function discoverAlternateRawForVar(varName, opts = {}) {
  const entry = API_KEY_CREDENTIALS.find((item) => item.envVars.includes(varName));
  return entry ? discoverAlternateRawForCredential(entry, opts) : null;
}
