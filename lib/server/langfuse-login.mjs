/**
 * lib/server/langfuse-login.mjs — Magic-link bridge for local Langfuse.
 *
 * `construct up` seeds Langfuse with deterministic admin creds via the
 * LANGFUSE_INIT_* env vars in langfuse/docker-compose.yml. This bridge turns
 * the "Open Langfuse" link in the dashboard into a one-click sign-in: the
 * server fetches a CSRF token from local Langfuse, then returns an HTML
 * auto-submit form that POSTs the seeded credentials to NextAuth's callback.
 * The browser receives Langfuse's session cookie on localhost:3000 directly,
 * sidestepping cross-origin restrictions.
 *
 * The seeded creds are NOT secret — they are deterministic local defaults
 * declared in the public compose file. Their only job is to make local
 * Langfuse zero-touch.
 */
import { LANGFUSE_LOCAL } from '../service-manager.mjs';

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export async function handleLangfuseLogin(req, res, { baseUrl = LANGFUSE_LOCAL.baseUrl, email = LANGFUSE_LOCAL.email, pwd = LANGFUSE_LOCAL.pwd } = {}) {
  try {
    const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Accept: 'application/json' } });
    if (!csrfResponse.ok) {
      res.writeHead(502, HTML_HEADERS);
      res.end(`<!doctype html><meta charset="utf-8"><title>Langfuse unreachable</title><pre>Could not reach local Langfuse at ${escapeHtml(baseUrl)}. Status: ${csrfResponse.status}. Try \`construct up\` first.</pre>`);
      return;
    }
    const { csrfToken } = await csrfResponse.json();

    const callbackUrl = `${baseUrl}/api/auth/callback/credentials`;
    const redirectAfter = `${baseUrl}/`;

    res.writeHead(200, HTML_HEADERS);
    res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in to Langfuse…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666;background:#fff}</style>
</head><body>
<p>Signing you in to Langfuse…</p>
<form id="lf" method="POST" action="${escapeHtml(callbackUrl)}">
<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
<input type="hidden" name="email" value="${escapeHtml(email)}">
<input type="hidden" name="password" value="${escapeHtml(pwd)}">
<input type="hidden" name="callbackUrl" value="${escapeHtml(redirectAfter)}">
<input type="hidden" name="json" value="false">
</form>
<script>document.getElementById('lf').submit();</script>
</body></html>`);
  } catch (err) {
    res.writeHead(502, HTML_HEADERS);
    res.end(`<!doctype html><meta charset="utf-8"><title>Langfuse unreachable</title><pre>Could not reach local Langfuse: ${escapeHtml(err?.message || 'unknown error')}. Try \`construct up\` first.</pre>`);
  }
}
