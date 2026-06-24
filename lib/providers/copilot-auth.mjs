/**
 * lib/providers/copilot-auth.mjs — GitHub Copilot OAuth device flow + token exchange.
 *
 * Copilot is authenticated the way the editor plugins and community CLIs do it:
 * an OAuth device flow against the public Copilot GitHub App
 * (client Iv1.b507a08c87ecfe98), which mints a user-to-server access token
 * (ghu_) plus a long-lived refresh token (ghr_). The access token is exchanged
 * at copilot_internal/v2/token for a short-lived Copilot session token used as
 * the bearer against api.githubcopilot.com. This deliberately replaces the
 * `gh auth token` path: the GitHub CLI's OAuth app is not Copilot-entitled and
 * its token is rejected by the exchange endpoint.
 *
 * Credentials persist to two places: Construct's own store
 * (github-copilot.json under the XDG config dir auth/) and the de-facto standard
 * ~/.config/github-copilot/apps.json that other tools read and write, so a login
 * here is reusable elsewhere and an existing login is reused here. The access
 * token is refreshed from the refresh token when it expires; the session token
 * is cached in-process until shortly before its own expiry. Network and clock
 * are injectable so the flow is exercised end to end without a live account.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { configDir } from '../config/xdg.mjs';

const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';

export const COPILOT_API_BASE = 'https://api.githubcopilot.com';
const SESSION_REFRESH_BUFFER_S = 300;

const EDITOR_HEADERS = {
  'Editor-Version': 'vscode/1.90.0',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'Copilot-Integration-Id': 'vscode-chat',
  'User-Agent': 'GitHubCopilotChat/0.26.7',
};

let sessionCache = null;

// Copilot tokens must be a single line — stray newlines from dotenv, JSON, or the
// exchange response trigger "invalid whitespace" from api.githubcopilot.com.

function normalizeToken(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, '');
}

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function constructStorePath() {
  return path.join(configDir(homeDir()), 'auth', 'github-copilot.json');
}

function appsStorePath() {
  return path.join(homeDir(), '.config', 'github-copilot', 'apps.json');
}

function hostsStorePath() {
  return path.join(homeDir(), '.config', 'github-copilot', 'hosts.json');
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode });
}

// Read a stored OAuth credential from Construct's store first, then the shared
// github-copilot store (apps.json/hosts.json) that editor plugins maintain. The
// oauth_token field carries the ghu_ access token in the shared format.

export function loadStoredOAuth() {
  const own = readJson(constructStorePath());
  if (own && own.oauth_token) {
    return {
      oauthToken: normalizeToken(own.oauth_token),
      refreshToken: normalizeToken(own.refresh_token) || null,
      oauthExpiresAt: own.oauth_expires_at || null,
      user: own.user || null,
    };
  }
  for (const file of [appsStorePath(), hostsStorePath()]) {
    const data = readJson(file);
    if (!data) continue;
    for (const entry of Object.values(data)) {
      const token = normalizeToken(entry?.oauth_token || entry?.token);
      if (token) return { oauthToken: token, refreshToken: null, oauthExpiresAt: null, user: entry?.user || null };
    }
  }
  return null;
}

export function hasStoredCredential() {
  return loadStoredOAuth() != null;
}

// Persist to both stores so a login made here is reusable by other tools and a
// login made elsewhere is honored here. The shared store is keyed by host and
// app id, matching the format opencode/Neovim copilot read.

export function persistOAuth({ accessToken, refreshToken, expiresAt, user }) {
  const cleanAccess = normalizeToken(accessToken);
  const cleanRefresh = normalizeToken(refreshToken) || null;
  const own = readJson(constructStorePath()) || {};
  writeJson(constructStorePath(), {
    ...own,
    type: 'oauth',
    oauth_token: cleanAccess,
    refresh_token: cleanRefresh || own.refresh_token || null,
    oauth_expires_at: expiresAt || null,
    user: user || own.user || null,
    rotated_at: new Date().toISOString(),
  }, 0o600);

  const apps = readJson(appsStorePath()) || {};
  apps[`github.com:${CLIENT_ID}`] = { user: user || apps[`github.com:${CLIENT_ID}`]?.user || 'unknown', oauth_token: cleanAccess, githubAppId: CLIENT_ID };
  writeJson(appsStorePath(), apps, 0o600);
}

async function postJson(url, body, fetchImpl) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...EDITOR_HEADERS },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, json, text };
}

// Step 1 of the device flow: request a device + user code the operator enters at
// the verification URL.

export async function requestDeviceCode({ fetchImpl = fetch } = {}) {
  const { ok, json, status, text } = await postJson(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: 'read:user' }, fetchImpl);
  if (!ok || !json?.device_code) {
    throw new Error(`Copilot device-code request failed (HTTP ${status}): ${(text || '').slice(0, 160)}`);
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    interval: json.interval || 5,
    expiresIn: json.expires_in || 900,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Step 2: poll until the operator authorizes, then capture the access token, the
// refresh token, and the access-token expiry (when the app enables expiration).

export async function pollForAccessToken({ deviceCode, interval = 5, expiresIn = 900, fetchImpl = fetch, now = Date.now, onPending } = {}) {
  const deadline = now() + expiresIn * 1000;
  let waitMs = interval * 1000;
  while (now() < deadline) {
    const { json } = await postJson(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }, fetchImpl);
    if (json?.access_token) {
      return {
        accessToken: normalizeToken(json.access_token),
        refreshToken: normalizeToken(json.refresh_token) || null,
        expiresAt: json.expires_in ? Math.floor(now() / 1000) + json.expires_in : null,
      };
    }
    if (json?.error === 'slow_down') waitMs += 5000;
    else if (json?.error && json.error !== 'authorization_pending') {
      throw new Error(`Copilot authorization failed: ${json.error_description || json.error}`);
    }
    if (typeof onPending === 'function') onPending();
    await sleep(waitMs);
  }
  throw new Error('Copilot authorization timed out — the device code expired before approval.');
}

async function refreshAccessToken(refreshToken, { fetchImpl, now }) {
  const { json } = await postJson(ACCESS_TOKEN_URL, {
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }, fetchImpl);
  if (!json?.access_token) throw new Error('Copilot token refresh failed — re-run `construct creds login copilot`.');
  return {
    accessToken: normalizeToken(json.access_token),
    refreshToken: normalizeToken(json.refresh_token) || refreshToken,
    expiresAt: json.expires_in ? Math.floor(now() / 1000) + json.expires_in : null,
  };
}

async function exchangeForSessionToken(accessToken, { fetchImpl }) {
  const res = await fetchImpl(COPILOT_TOKEN_URL, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...EDITOR_HEADERS },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Copilot token exchange failed (HTTP ${res.status}). Your GitHub account may lack an active Copilot subscription, or the login expired — re-run \`construct creds login copilot\`. ${(body || '').slice(0, 160)}`);
    err.code = 'COPILOT_EXCHANGE_FAILED';
    throw err;
  }
  return res.json();
}

// Return a valid short-lived Copilot session token, doing the minimum work:
// reuse the in-process cache, else exchange the stored access token, first
// refreshing that token from the refresh token when it has expired.

export async function getCopilotToken({ fetchImpl = fetch, now = Date.now } = {}) {
  const nowS = Math.floor(now() / 1000);
  if (sessionCache && sessionCache.expiresAt > nowS + SESSION_REFRESH_BUFFER_S) {
    return sessionCache.token;
  }

  const stored = loadStoredOAuth();
  if (!stored?.oauthToken) {
    const err = new Error('GitHub Copilot is not authenticated — run `construct creds login copilot`.');
    err.code = 'COPILOT_NOT_AUTHENTICATED';
    throw err;
  }

  let accessToken = stored.oauthToken;
  if (stored.oauthExpiresAt && stored.oauthExpiresAt <= nowS && stored.refreshToken) {
    const refreshed = await refreshAccessToken(stored.refreshToken, { fetchImpl, now });
    accessToken = refreshed.accessToken;
    persistOAuth({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt, user: stored.user });
  }

  const session = await exchangeForSessionToken(accessToken, { fetchImpl });
  if (!session?.token) {
    const err = new Error('Copilot token exchange returned no token.');
    err.code = 'COPILOT_EXCHANGE_EMPTY';
    throw err;
  }
  const sessionToken = normalizeToken(session.token);
  if (!sessionToken) {
    const err = new Error('Copilot token exchange returned an empty token.');
    err.code = 'COPILOT_EXCHANGE_EMPTY';
    throw err;
  }
  sessionCache = { token: sessionToken, expiresAt: session.expires_at || (nowS + 1500) };
  return sessionCache.token;
}

// Headers every api.githubcopilot.com call must carry. The integration id and
// editor version are what the endpoint checks to accept a session-scoped token.

export function copilotApiHeaders() {
  return { ...EDITOR_HEADERS, 'X-Github-Api-Version': '2023-07-07' };
}

// The model ids the account can actually use. Lets callers validate a configured
// id (for example github-copilot/gpt-5.4) instead of assuming a name is valid.

export async function listCopilotModels({ fetchImpl = fetch } = {}) {
  const token = await getCopilotToken({ fetchImpl });
  const res = await fetchImpl(`${COPILOT_API_BASE}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...copilotApiHeaders() },
  });
  if (!res.ok) throw new Error(`Copilot models request failed (HTTP ${res.status}).`);
  const data = await res.json();
  const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  return items.map((m) => m?.id || m?.model).filter(Boolean);
}

export function __resetCopilotCache() {
  sessionCache = null;
}

// Exchange probe used at chat launch — a configured Copilot pin is not enough if
// the session token cannot be minted (stale oauth, whitespace-corrupt store).

export async function preflightCopilotSession({ fetchImpl = fetch } = {}) {
  __resetCopilotCache();
  try {
    await getCopilotToken({ fetchImpl });
    return { ok: true };
  } catch (err) {
    __resetCopilotCache();
    return { ok: false, message: err.message || String(err) };
  }
}
