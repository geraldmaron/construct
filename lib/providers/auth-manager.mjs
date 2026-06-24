/**
 * lib/providers/auth-manager.mjs — Token lifecycle and refresh dispatch.
 *
 * Provider-agnostic store and contract for credential rotation. The actual
 * refresh flow (OAuth, JWT, vendor-specific) lives in a registered adapter;
 * dispatch goes to the adapter's `refresh(state)` and the result is persisted
 * back to the auth store. Adapters lacking a refresh implementation leave the
 * operator on a reauthenticate-manually path — the safe agnostic default.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { configDir } from '../config/xdg.mjs';

function authDir() {
  const home = process.env.HOME || homedir();
  const dir = path.join(configDir(home), 'auth');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* ignore */ }
  return dir;
}

const PROVIDER_CONFIGS = {
  github: {
    name: 'GitHub',
    tokenExpiry: null,
    refreshable: false,
    envVar: 'GITHUB_TOKEN',
  },
  salesforce: {
    name: 'Salesforce',
    tokenExpiry: 7200,
    refreshable: true,
    refreshBuffer: 300,
    envVar: 'SALESFORCE_ACCESS_TOKEN',
    refreshEnvVar: 'SALESFORCE_REFRESH_TOKEN',
  },
};

const refreshAdapters = new Map();

/**
 * Register a refresh adapter for a provider. Contract:
 *   adapter(state) -> Promise<{ success, token, refreshToken?, expiresAt? }>
 * If no adapter is registered, refresh returns a manual-reauth instruction.
 */
export function registerRefreshAdapter(provider, adapter) {
  if (typeof adapter === 'function') refreshAdapters.set(provider, adapter);
}

export function loadAuthState(provider) {
  try {
    const file = path.join(authDir(), `${provider}.json`);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

export function saveAuthState(provider, state) {
  try {
    const file = path.join(authDir(), `${provider}.json`);
    fs.writeFileSync(file, JSON.stringify(state, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function getTokenStatus(provider) {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) return { valid: false, error: 'Unknown provider' };
  
  const state = loadAuthState(provider);
  if (!state) {
    // Fall back to env var
    const envToken = process.env[config.envVar];
    if (!envToken) {
      return { valid: false, error: 'No token configured' };
    }
    return { valid: true, source: 'env', expiresAt: null };
  }
  
  if (!state.expiresAt) {
    return { valid: true, source: 'auth-store' };
  }
  
  const expiresAt = new Date(state.expiresAt);
  const now = new Date();
  const bufferMs = (config.refreshBuffer || 0) * 1000;
  
  if (expiresAt - now < bufferMs) {
    return {
      valid: false,
      error: 'Token expired or expiring soon',
      needsRefresh: config.refreshable,
    };
  }
  
  return {
    valid: true,
    source: 'auth-store',
    expiresAt: state.expiresAt,
    expiresIn: Math.floor((expiresAt - now) / 1000),
  };
}

export async function withValidToken(provider, fn) {
  const status = getTokenStatus(provider);
  
  if (!status.valid) {
    if (status.needsRefresh) {
      const refreshed = await refreshToken(provider);
      if (!refreshed.success) {
        throw new Error(`Token refresh failed: ${refreshed.error}`);
      }
    } else {
      throw new Error(`Invalid token: ${status.error}`);
    }
  }
  
  const state = loadAuthState(provider);
  const token = state?.token || process.env[PROVIDER_CONFIGS[provider].envVar];
  
  return await fn(token);
}

async function refreshToken(provider) {
  const config = PROVIDER_CONFIGS[provider];
  if (!config?.refreshable) {
    return { success: false, error: 'Provider does not support refresh' };
  }

  const state = loadAuthState(provider);
  if (!state?.refreshToken) {
    return { success: false, error: 'No refresh token available' };
  }

  const adapter = refreshAdapters.get(provider);
  if (!adapter) {
    return {
      success: false,
      error: 'Token refresh required - reauthenticate manually',
    };
  }

  try {
    const result = await adapter(state);
    if (result?.success && result.token) {
      const next = {
        ...state,
        token: result.token,
        refreshToken: result.refreshToken || state.refreshToken,
        expiresAt: result.expiresAt || null,
        rotatedAt: new Date().toISOString(),
      };
      saveAuthState(provider, next);
      return { success: true, expiresAt: next.expiresAt };
    }
    return {
      success: false,
      error: result?.error || 'Refresh adapter returned no token',
    };
  } catch (err) {
    return { success: false, error: `Refresh adapter threw: ${err.message}` };
  }
}
