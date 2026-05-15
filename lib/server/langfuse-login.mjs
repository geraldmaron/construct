/**
 * lib/server/langfuse-login.mjs — magic-link bridge for local Langfuse.
 *
 * `construct up` seeds Langfuse with deterministic admin creds via the
 * LANGFUSE_INIT_* env vars in langfuse/docker-compose.yml. This bridge
 * turns the "Open Langfuse" link in the dashboard into a one-click
 * sign-in: the server fetches a CSRF token from local Langfuse, then
 * returns an HTML auto-submit form that POSTs the seeded credentials
 * to NextAuth's callback. The browser receives Langfuse's session
 * cookie on the local Langfuse origin directly, sidestepping
 * cross-origin restrictions.
 *
 * The seeded creds are NOT secret — they are deterministic local
 * defaults declared in the public compose file. Their only job is to
 * make local Langfuse zero-touch after `construct setup`.
 */

import {
  LANGFUSE_LOCAL_BASEURL,
  LANGFUSE_LOCAL_ADMIN_EMAIL,
  LANGFUSE_LOCAL_ADMIN_PASSWORD,
} from '../services/langfuse.mjs';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

export const LANGFUSE_LOGIN_DEFAULTS = Object.freeze({
  baseUrl: LANGFUSE_LOCAL_BASEURL,
  email: LANGFUSE_LOCAL_ADMIN_EMAIL,
  password: LANGFUSE_LOCAL_ADMIN_PASSWORD,
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/**
 * Render the auto-submit form HTML. Pure for testing — pass everything
 * the form needs and get back the string. The handler below does the
 * network work; this builds the page.
 */
export function renderAutoSubmitForm({ csrfToken, callbackUrl, redirectAfter, email, password }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in to Langfuse…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666;background:#fff}</style>
</head><body>
<p>Signing you in to Langfuse…</p>
<form id="lf" method="POST" action="${escapeHtml(callbackUrl)}">
<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
<input type="hidden" name="email" value="${escapeHtml(email)}">
<input type="hidden" name="password" value="${escapeHtml(password)}">
<input type="hidden" name="callbackUrl" value="${escapeHtml(redirectAfter)}">
<input type="hidden" name="json" value="false">
</form>
<script>document.getElementById('lf').submit();</script>
</body></html>`;
}

/**
 * HTTP handler: GET /api/services/langfuse/login. Returns an HTML page
 * that immediately POSTs the seeded credentials to local Langfuse's
 * NextAuth callback. The user lands logged in at the Langfuse origin.
 *
 * Returns a 502 with a human-readable explanation when Langfuse is down
 * or unreachable so the user knows to run `construct up` first.
 */
export async function handleLangfuseLogin(req, res, {
  baseUrl = LANGFUSE_LOGIN_DEFAULTS.baseUrl,
  email = LANGFUSE_LOGIN_DEFAULTS.email,
  password = LANGFUSE_LOGIN_DEFAULTS.password,
  fetchFn = globalThis.fetch,
} = {}) {
  try {
    const csrfResponse = await fetchFn(`${baseUrl}/api/auth/csrf`, {
      headers: { Accept: 'application/json' },
    });
    if (!csrfResponse.ok) {
      res.writeHead(502, HTML_HEADERS);
      res.end(`<!doctype html><meta charset="utf-8"><title>Langfuse unreachable</title>` +
        `<pre>Could not reach local Langfuse at ${escapeHtml(baseUrl)}. Status: ${csrfResponse.status}. ` +
        `Try \`construct up\` first.</pre>`);
      return;
    }
    const { csrfToken } = await csrfResponse.json();
    const callbackUrl = `${baseUrl}/api/auth/callback/credentials`;
    const redirectAfter = `${baseUrl}/`;
    res.writeHead(200, HTML_HEADERS);
    res.end(renderAutoSubmitForm({ csrfToken, callbackUrl, redirectAfter, email, password }));
  } catch (err) {
    res.writeHead(502, HTML_HEADERS);
    res.end(`<!doctype html><meta charset="utf-8"><title>Langfuse unreachable</title>` +
      `<pre>Could not reach local Langfuse: ${escapeHtml(err?.message || 'unknown error')}. ` +
      `Try \`construct up\` first.</pre>`);
  }
}
