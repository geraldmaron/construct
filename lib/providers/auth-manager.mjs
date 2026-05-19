// lib/providers/auth-manager.mjs
// OAuth refresh and token lifecycle management

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const AUTH_DIR = path.join(homedir(), '.construct', 'auth');

try {
  fs.mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 });
} catch { /* ignore */ }

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

export function loadAuthState(provider) {
  try {
    const file = path.join(AUTH_DIR, `${provider}.json`);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

export function saveAuthState(provider, state) {
  try {
    const file = path.join(AUTH_DIR, `${provider}.json`);
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
  
  // Provider-specific refresh logic would go here
  // For now, just indicate refresh is needed
  return {
    success: false,
    error: 'Token refresh required - reauthenticate manually',
  };
}
