/**
 * lib/server/telemetry-login.mjs — magic-link bridge for a configured telemetry UI.
 *
 * CONSTRUCT_TELEMETRY_URL may point at a Langfuse-compatible deployment.
 * The dashboard link can use this bridge for one-click sign-in by fetching a
 * CSRF token and returning an HTML auto-submit form for NextAuth's callback.
 */

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

/**
 * Resolve the configured telemetry UI URL from env.
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
<html><head><meta charset="utf-8"><title>Signing in to telemetry UI…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#666;background:#fff}</style>
</head><body>
<p>Signing you in to telemetry UI…</p>
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
 * Returns an HTML page that immediately POSTs credentials to the configured
 * NextAuth callback. Returns 502 when the endpoint is unreachable.
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
    res.end(`<!doctype html><meta charset="utf-8"><title>Telemetry UI not configured</title>` +
      `<pre>CONSTRUCT_TELEMETRY_URL is not set. Configure a Langfuse-compatible telemetry UI to use this feature.</pre>`);
    return;
  }

  try {
    const csrfResponse = await fetchFn(`${resolvedBaseUrl}/api/auth/csrf`, {
      headers: { Accept: 'application/json' },
    });
    if (!csrfResponse.ok) {
      res.writeHead(502, HTML_HEADERS);
      res.end(`<!doctype html><meta charset="utf-8"><title>Telemetry UI unreachable</title>` +
        `<pre>Could not reach telemetry UI at ${escapeHtml(resolvedBaseUrl)}. Status: ${csrfResponse.status}. ` +
        `Check CONSTRUCT_TELEMETRY_URL and the configured service.</pre>`);
      return;
    }
    const { csrfToken } = await csrfResponse.json();
    const callbackUrl = `${resolvedBaseUrl}/api/auth/callback/credentials`;
    const redirectAfter = `${resolvedBaseUrl}/`;
    res.writeHead(200, HTML_HEADERS);
    res.end(renderAutoSubmitForm({ csrfToken, callbackUrl, redirectAfter, email, password }));
  } catch (err) {
    res.writeHead(502, HTML_HEADERS);
    res.end(`<!doctype html><meta charset="utf-8"><title>Telemetry UI unreachable</title>` +
      `<pre>Could not reach telemetry UI: ${escapeHtml(err?.message || 'unknown error')}. ` +
      `Check CONSTRUCT_TELEMETRY_URL and the configured service.</pre>`);
  }
}
