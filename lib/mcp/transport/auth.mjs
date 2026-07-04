/**
 * lib/mcp/transport/auth.mjs — remote (HTTP) MCP authorization primitives.
 *
 * Pure, network-free functions the http entrypoint composes at request time.
 * Split out from the transport wiring so every rule is unit-testable without a
 * socket. Four responsibilities, in the order the http entrypoint applies them:
 *
 *   1. resolveHttpAuthConfig — reads the http-remote auth config and FAILS
 *      CLOSED. http mode has no default identity; a missing bearer secret,
 *      missing audience, or missing allowed-origin list is a startup error,
 *      never a warning. There is no skip/allow env var — the absence of config
 *      is the refusal.
 *   2. validateOrigin / validateHost — DNS-rebinding defense. A browser that
 *      resolves a trusted name to 127.0.0.1 still sends the attacker's Origin
 *      and the attacker's Host; both must be on the operator's allowlist or the
 *      request is rejected before any tool dispatch. Pairs with N7's SSRF work.
 *   3. verifyBearer — RFC 8707 shaped: the inbound token must carry the exact
 *      audience (resource indicator) this server was configured for. A token
 *      minted for a different audience is rejected even if otherwise valid, so a
 *      token stolen from an upstream service cannot be replayed here.
 *   4. mintScopedContext — the broker's internal actor context is derived from
 *      the VERIFIED claims and NEVER contains the inbound token. Token
 *      passthrough is structurally impossible: the raw bearer is consumed by
 *      verifyBearer and dropped; nothing downstream is handed the credential.
 */

import crypto from 'node:crypto';

export class HttpAuthConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HttpAuthConfigError';
  }
}

export class HttpAuthError extends Error {
  constructor(message, { status = 401 } = {}) {
    super(message);
    this.name = 'HttpAuthError';
    this.status = status;
  }
}

// The scoped context carries the token as a symbol-keyed, non-enumerable
// nothing: there is no field to hold it. mintScopedContext returns a frozen
// object with only the derived, non-secret identity. A downstream caller that
// tries to forward `ctx.token` finds `undefined`, and JSON.stringify(ctx) can
// never leak a credential because none was ever stored.

const CONTEXT_FIELDS = Object.freeze(['actor', 'audience', 'scopes', 'issuedAt', 'source']);

function parseList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

/**
 * Resolve the http-remote auth config from env, failing closed. Returns a
 * frozen config when every required field is present; throws
 * HttpAuthConfigError otherwise. The http entrypoint calls this BEFORE binding
 * a socket so a misconfigured server never accepts a single request.
 *
 * Required (no defaults, no skip path):
 *   CONSTRUCT_MCP_HTTP_BEARER_SECRET — HMAC secret the inbound token is signed with
 *   CONSTRUCT_MCP_HTTP_AUDIENCE      — this server's resource indicator (RFC 8707)
 *   CONSTRUCT_MCP_HTTP_ALLOWED_ORIGINS — comma list of allowed Origin header values
 * Optional:
 *   CONSTRUCT_MCP_HTTP_ALLOWED_HOSTS — comma list of allowed Host header values
 *                                      (defaults to localhost forms)
 *   CONSTRUCT_MCP_HTTP_HOST / _PORT   — bind address (defaults to 127.0.0.1)
 */
export function resolveHttpAuthConfig(env = process.env) {
  const missing = [];
  const bearerSecret = env.CONSTRUCT_MCP_HTTP_BEARER_SECRET;
  const audience = env.CONSTRUCT_MCP_HTTP_AUDIENCE;
  const allowedOrigins = parseList(env.CONSTRUCT_MCP_HTTP_ALLOWED_ORIGINS);

  if (!bearerSecret) missing.push('CONSTRUCT_MCP_HTTP_BEARER_SECRET');
  if (!audience) missing.push('CONSTRUCT_MCP_HTTP_AUDIENCE');
  if (allowedOrigins.length === 0) missing.push('CONSTRUCT_MCP_HTTP_ALLOWED_ORIGINS');

  if (missing.length > 0) {
    throw new HttpAuthConfigError(
      `http-remote MCP refuses to start: missing required auth config (${missing.join(', ')}). `
      + 'HTTP transport has no default identity; there is no skip flag — supply the config or run stdio-local.',
    );
  }

  const allowedHosts = parseList(env.CONSTRUCT_MCP_HTTP_ALLOWED_HOSTS);
  const bindHost = env.CONSTRUCT_MCP_HTTP_HOST || '127.0.0.1';
  const bindPort = Number(env.CONSTRUCT_MCP_HTTP_PORT) || 7391;

  return Object.freeze({
    bearerSecret,
    audience,
    allowedOrigins: Object.freeze(allowedOrigins),
    allowedHosts: Object.freeze(allowedHosts.length > 0 ? allowedHosts : defaultAllowedHosts(bindHost, bindPort)),
    bindHost,
    bindPort,
  });
}

// Localhost-bind is the default; the default host allowlist is exactly the
// loopback forms for the bind address so a request whose Host names a public
// interface is rejected unless the operator explicitly widens allowedHosts.

function defaultAllowedHosts(bindHost, bindPort) {
  const names = ['localhost', '127.0.0.1', '[::1]', bindHost];
  const out = [];
  for (const n of names) {
    out.push(n);
    out.push(`${n}:${bindPort}`);
  }
  return [...new Set(out)];
}

/**
 * Validate the inbound Origin against the allowlist. A missing Origin is
 * allowed only for non-browser clients (no Origin header at all); a present
 * Origin that is not on the allowlist is a DNS-rebinding attempt and is
 * rejected. Returns true when the request may proceed.
 */
export function validateOrigin(origin, config) {
  if (origin == null || origin === '') return true;
  return config.allowedOrigins.includes(origin);
}

/**
 * Validate the inbound Host header against the allowlist. A rebinding attack
 * resolves a trusted name to a loopback IP but still carries the attacker's
 * Host value; requiring an exact allowlist match closes that path. A missing
 * Host is rejected — a well-formed HTTP/1.1 request always carries one.
 */
export function validateHost(host, config) {
  if (host == null || host === '') return false;
  return config.allowedHosts.includes(host);
}

// Constant-time compare so a token-signature check cannot be turned into a
// timing oracle. Both operands are hex/base64url strings of the same length
// when the request is well-formed; a length mismatch short-circuits to false
// without leaking where the difference is.

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function b64urlDecode(seg) {
  return Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint an internal HMAC bearer for tests and local tooling: a compact
 * `<payloadB64url>.<sigB64url>` token whose payload is a JSON claims object —
 * the token shape verifyBearer accepts. Not a full JWT — deliberately minimal
 * so the audience/expiry/signature semantics are auditable in one file.
 */
export function mintInternalBearer(claims, secret) {
  const payload = b64urlEncode(JSON.stringify(claims));
  const sig = b64urlEncode(crypto.createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/**
 * Verify an inbound bearer against the configured secret AND audience. Order:
 * shape → signature → expiry → audience. Returns the verified claims on
 * success; throws HttpAuthError (401) otherwise. The audience check is the
 * resource-indicator binding: a token minted for a different resource is
 * rejected here, which is what makes a stolen upstream token un-replayable.
 *
 * The returned claims are DATA ONLY. The caller passes them to
 * mintScopedContext; the raw token string is never returned and never stored.
 */
export function verifyBearer(rawAuthHeader, config, { now = () => Date.now() } = {}) {
  if (typeof rawAuthHeader !== 'string' || !rawAuthHeader.startsWith('Bearer ')) {
    throw new HttpAuthError('missing or malformed Authorization: Bearer header');
  }
  const token = rawAuthHeader.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 2) throw new HttpAuthError('malformed bearer token');

  const [payloadB64, sigB64] = parts;
  const expectedSig = b64urlEncode(crypto.createHmac('sha256', config.bearerSecret).update(payloadB64).digest());
  if (!timingSafeEqualStr(sigB64, expectedSig)) {
    throw new HttpAuthError('bearer signature does not verify');
  }

  let claims;
  try {
    claims = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    throw new HttpAuthError('bearer payload is not valid JSON');
  }

  if (typeof claims.exp === 'number' && now() >= claims.exp * 1000) {
    throw new HttpAuthError('bearer token expired');
  }

  const aud = Array.isArray(claims.aud) ? claims.aud : (claims.aud == null ? [] : [claims.aud]);
  if (!aud.includes(config.audience)) {
    throw new HttpAuthError(
      `bearer audience mismatch: token is for ${JSON.stringify(claims.aud)} but this server is ${JSON.stringify(config.audience)}`,
      { status: 403 },
    );
  }

  return claims;
}

/**
 * Mint the broker's internal actor context from VERIFIED claims. Token
 * passthrough is structurally impossible: the inbound token never reaches this
 * function — only the already-verified claims do — and the returned object has
 * no field capable of holding a credential.
 *
 * The result is frozen and carries exactly CONTEXT_FIELDS. A read of a token
 * off it (ctx.token, ctx.bearer, ctx.authorization) yields undefined.
 */
export function mintScopedContext(claims, config, { now = () => Date.now() } = {}) {
  const ctx = {
    actor: claims.sub || claims.actor || 'http-remote-unknown',
    audience: config.audience,
    scopes: Array.isArray(claims.scopes) ? [...claims.scopes] : parseList(claims.scope),
    issuedAt: new Date(now()).toISOString(),
    source: 'http-remote',
  };
  return Object.freeze(ctx);
}

export { CONTEXT_FIELDS };
