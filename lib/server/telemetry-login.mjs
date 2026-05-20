/**
 * lib/server/telemetry-login.mjs — magic-link bridge for a local telemetry backend.
 *
 * When a self-hosted telemetry backend (e.g. a self-hosted or cloud telemetry backend)
 * is running locally, this bridge turns the "Open Telemetry" link in the
 * dashboard into a one-click sign-in. The server fetches a CSRF token from
 * the backend, then returns an HTML auto-submit form that POSTs the seeded
 * credentials to NextAuth's callback.
 *
 * The seeded creds are NOT secret — they are deterministic local defaults
 * for zero-touch local development. Not used when CONSTRUCT_TELEMETRY_URL
 * points at a remote backend.
 */

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

/**
 * Resolve the telemetry backend URL from env with backward compat.
 */
function resolveTelemetryUrl(env = process.env) {
  return (
    env.CONSTRUCT_TELEMETRY_URL ?? ''
  ).replace(/\/$/, '');
}

export const TELEMETRY_LOGIN_DEFAULTS = Object.freeze({
  baseUrl: '',
  email: '',
  password: '',
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
 * the form needs and get back the string.
 */
export function renderAutoSubmitForm({ csrfToken, callbackUrl, redirectAfter, email, password }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Signing in to telemetry backend…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666;background:#fff}</style>
</head><body>
<p>Signing you in to telemetry backend…</p>
<form id="tf" method="POST" action="${escapeHtml(callbackUrl)}">
<input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
<input type="hidden" name="email" value="${escapeHtml(email)}">
<input type="hidden" name="password" value="${escapeHtml(password)}">
<input type="hidden" name="callbackUrl" value="${escapeHtml(redirectAfter)}">
<input type="hidden" name="json" value="false">
</form>
<script>document.getElementById('tf').submit();</script>
</body></html>`;
}

/**
 * HTTP handler: GET /api/services/telemetry/login
 *
 * Returns an HTML page that immediately POSTs credentials to the backend's
 * NextAuth callback. Returns 502 when the backend is unreachable.
 */
export async function handleTelemetryLogin(req, res, {
  baseUrl,
  email = '',
  password = '',
  fetchFn = globalThis.fetch,
} = {}) {
  const resolvedBaseUrl = baseUrl ?? resolveTelemetryUrl();

  if (!resolvedBaseUrl) {
    res.writeHead(503, HTML_HEADERS);
    res.end(`<!doctype html><meta charset="utf-8"><title>Telemetry backend not configured</title>` +
      `<pre>CONSTRUCT_TELEMETRY_URL is not set. Configure a telemetry backend to use this feature.</pre>`);
    return;
  }

  try {
    const csrfResponse = await fetchFn(`${resolvedBaseUrl}/api/auth/csrf`, {
      headers: { Accept: 'application/json' },
    });
    if (!csrfResponse.ok) {
      res.writeHead(502, HTML_HEADERS);
      res.end(`<!doctype html><meta charset="utf-8"><title>Telemetry backend unreachable</title>` +
        `<pre>Could not reach telemetry backend at ${escapeHtml(resolvedBaseUrl)}. Status: ${csrfResponse.status}. ` +
        `Try \`construct up\` first.</pre>`);
      return;
    }
    const { csrfToken } = await csrfResponse.json();
    const callbackUrl = `${resolvedBaseUrl}/api/auth/callback/credentials`;
    const redirectAfter = `${resolvedBaseUrl}/`;
    res.writeHead(200, HTML_HEADERS);
    res.end(renderAutoSubmitForm({ csrfToken, callbackUrl, redirectAfter, email, password }));
  } catch (err) {
    res.writeHead(502, HTML_HEADERS);
    res.end(`<!doctype html><meta charset="utf-8"><title>Telemetry backend unreachable</title>` +
      `<pre>Could not reach telemetry backend: ${escapeHtml(err?.message || 'unknown error')}. ` +
      `Try \`construct up\` first.</pre>`);
  }
}


