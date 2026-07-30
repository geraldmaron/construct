/**
 * tests/mcp/transport-separation.test.mjs — transport separation.
 *
 * Pins the security contract of stdio/http mode separation:
 *   - transport mode resolves to stdio-local by default; http only on explicit opt-in
 *   - http mode without auth config REFUSES to start (fail-closed)
 *   - Host/Origin allowlists reject DNS-rebinding attempts
 *   - bearer audience mismatch is rejected (RFC 8707 resource indicator)
 *   - the scoped context minted for the broker NEVER carries the inbound token
 *     (token passthrough is structurally impossible)
 *   - authorizeHttpRequest strips the credential and yields a token-free context
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTransportMode, TRANSPORT_STDIO, TRANSPORT_HTTP } from '../../lib/mcp/transport/mode.mjs';
import {
  resolveHttpAuthConfig,
  HttpAuthConfigError,
  HttpAuthError,
  validateOrigin,
  validateHost,
  verifyBearer,
  mintScopedContext,
  mintInternalBearer,
  CONTEXT_FIELDS,
} from '../../lib/mcp/transport/auth.mjs';
import { authorizeHttpRequest, constructHttpServer } from '../../lib/mcp/transport/http.mjs';

const AUDIENCE = 'https://mcp.construct.local/resource';
const SIGNING_MATERIAL = 'fixture-hmac-material-not-real';

function fullHttpEnv(overrides = {}) {
  return {
    CONSTRUCT_MCP_TRANSPORT: 'http',
    CONSTRUCT_MCP_HTTP_BEARER_SECRET: SIGNING_MATERIAL,
    CONSTRUCT_MCP_HTTP_AUDIENCE: AUDIENCE,
    CONSTRUCT_MCP_HTTP_ALLOWED_ORIGINS: 'https://trusted.example',
    ...overrides,
  };
}

function goodClaims(overrides = {}) {
  return { sub: 'user-42', aud: AUDIENCE, scopes: ['tools:call'], ...overrides };
}

describe('transport mode resolution', () => {
  it('defaults to stdio-local when no transport env is set', () => {
    assert.equal(resolveTransportMode({}), TRANSPORT_STDIO);
  });

  it('resolves http-remote only on explicit opt-in', () => {
    assert.equal(resolveTransportMode({ CONSTRUCT_MCP_TRANSPORT: 'http' }), TRANSPORT_HTTP);
    assert.equal(resolveTransportMode({ CONSTRUCT_MCP_TRANSPORT: 'http-remote' }), TRANSPORT_HTTP);
  });

  it('degrades an unknown transport value to stdio-local, never silently to http', () => {
    assert.equal(resolveTransportMode({ CONSTRUCT_MCP_TRANSPORT: 'nonsense' }), TRANSPORT_STDIO);
    assert.equal(resolveTransportMode({ CONSTRUCT_MCP_TRANSPORT: '' }), TRANSPORT_STDIO);
  });
});

describe('http mode fails closed without auth config', () => {
  it('refuses to resolve config when the bearer secret is missing', () => {
    const env = fullHttpEnv();
    delete env.CONSTRUCT_MCP_HTTP_BEARER_SECRET;
    assert.throws(() => resolveHttpAuthConfig(env), HttpAuthConfigError);
  });

  it('refuses to resolve config when the audience is missing', () => {
    const env = fullHttpEnv();
    delete env.CONSTRUCT_MCP_HTTP_AUDIENCE;
    assert.throws(() => resolveHttpAuthConfig(env), HttpAuthConfigError);
  });

  it('refuses to resolve config when the allowed-origins list is missing', () => {
    const env = fullHttpEnv();
    delete env.CONSTRUCT_MCP_HTTP_ALLOWED_ORIGINS;
    assert.throws(() => resolveHttpAuthConfig(env), HttpAuthConfigError);
  });

  it('constructHttpServer throws on empty env — startup cannot proceed unauthenticated', () => {
    assert.throws(() => constructHttpServer({}), HttpAuthConfigError);
  });

  it('the refusal names every missing field and offers no skip flag', () => {
    let caught;
    try { resolveHttpAuthConfig({}); } catch (err) { caught = err; }
    assert.ok(caught instanceof HttpAuthConfigError);
    assert.match(caught.message, /CONSTRUCT_MCP_HTTP_BEARER_SECRET/);
    assert.match(caught.message, /CONSTRUCT_MCP_HTTP_AUDIENCE/);
    assert.match(caught.message, /CONSTRUCT_MCP_HTTP_ALLOWED_ORIGINS/);
    assert.match(caught.message, /no skip flag/i);
  });

  it('resolves a frozen config with localhost bind default when fully configured', () => {
    const config = resolveHttpAuthConfig(fullHttpEnv());
    assert.equal(config.bindHost, '127.0.0.1');
    assert.ok(Object.isFrozen(config));
    assert.ok(config.allowedHosts.includes('localhost'));
    assert.ok(config.allowedHosts.includes('127.0.0.1'));
  });
});

describe('DNS-rebinding defense: Host and Origin allowlists', () => {
  const config = resolveHttpAuthConfig(fullHttpEnv());

  it('rejects a Host header not on the allowlist', () => {
    assert.equal(validateHost('attacker.example.com', config), false);
    assert.equal(validateHost('', config), false);
    assert.equal(validateHost(undefined, config), false);
  });

  it('accepts a loopback Host', () => {
    assert.equal(validateHost('localhost', config), true);
    assert.equal(validateHost('127.0.0.1', config), true);
  });

  it('rejects an Origin not on the allowlist', () => {
    assert.equal(validateOrigin('https://evil.example', config), false);
  });

  it('accepts the configured Origin and a header-less non-browser client', () => {
    assert.equal(validateOrigin('https://trusted.example', config), true);
    assert.equal(validateOrigin(undefined, config), true);
  });

  it('authorizeHttpRequest rejects a rebinding request (allowlisted Origin, foreign Host)', () => {
    const bearer = mintInternalBearer(goodClaims(), SIGNING_MATERIAL);
    assert.throws(
      () => authorizeHttpRequest(
        { host: 'attacker.example.com', origin: 'https://trusted.example', authorization: `Bearer ${bearer}` },
        config,
      ),
      (err) => err instanceof HttpAuthError && err.status === 421,
    );
  });

  it('authorizeHttpRequest rejects a foreign Origin even with a valid Host and token', () => {
    const bearer = mintInternalBearer(goodClaims(), SIGNING_MATERIAL);
    assert.throws(
      () => authorizeHttpRequest(
        { host: 'localhost', origin: 'https://evil.example', authorization: `Bearer ${bearer}` },
        config,
      ),
      (err) => err instanceof HttpAuthError && err.status === 403,
    );
  });
});

describe('bearer verification and audience binding', () => {
  const config = resolveHttpAuthConfig(fullHttpEnv());

  it('rejects a missing Authorization header', () => {
    assert.throws(() => verifyBearer(undefined, config), HttpAuthError);
  });

  it('rejects a token signed with the wrong secret', () => {
    const forged = mintInternalBearer(goodClaims(), 'wrong-secret');
    assert.throws(() => verifyBearer(`Bearer ${forged}`, config), HttpAuthError);
  });

  it('rejects a token minted for a different audience (RFC 8707)', () => {
    const wrongAud = mintInternalBearer(goodClaims({ aud: 'https://other-service/resource' }), SIGNING_MATERIAL);
    assert.throws(
      () => verifyBearer(`Bearer ${wrongAud}`, config),
      (err) => err instanceof HttpAuthError && err.status === 403,
    );
  });

  it('rejects an expired token', () => {
    const expired = mintInternalBearer(goodClaims({ exp: 1000 }), SIGNING_MATERIAL);
    assert.throws(() => verifyBearer(`Bearer ${expired}`, config), HttpAuthError);
  });

  it('accepts a correctly-signed, correctly-audienced token', () => {
    const good = mintInternalBearer(goodClaims(), SIGNING_MATERIAL);
    const claims = verifyBearer(`Bearer ${good}`, config);
    assert.equal(claims.sub, 'user-42');
    assert.equal(claims.aud, AUDIENCE);
  });
});

describe('token passthrough is structurally impossible', () => {
  const config = resolveHttpAuthConfig(fullHttpEnv());

  it('the scoped context carries exactly the derived fields and no token', () => {
    const ctx = mintScopedContext(goodClaims(), config);
    assert.deepEqual(Object.keys(ctx).sort(), [...CONTEXT_FIELDS].sort());
    assert.equal(ctx.token, undefined);
    assert.equal(ctx.bearer, undefined);
    assert.equal(ctx.authorization, undefined);
  });

  it('the raw token never appears anywhere in the serialized context', () => {
    const bearer = mintInternalBearer(goodClaims(), SIGNING_MATERIAL);
    const claims = verifyBearer(`Bearer ${bearer}`, config);
    const ctx = mintScopedContext(claims, config);
    const serialized = JSON.stringify(ctx);
    assert.equal(serialized.includes(bearer), false);
  });

  it('the scoped context is frozen — a downstream caller cannot bolt a token on', () => {
    const ctx = mintScopedContext(goodClaims(), config);
    assert.throws(() => { 'use strict'; ctx.token = 'sneaky'; }, TypeError);
  });

  it('authorizeHttpRequest yields a token-free scoped context on success', () => {
    const bearer = mintInternalBearer(goodClaims(), SIGNING_MATERIAL);
    const { context } = authorizeHttpRequest(
      { host: 'localhost', origin: 'https://trusted.example', authorization: `Bearer ${bearer}` },
      config,
    );
    assert.equal(context.actor, 'user-42');
    assert.equal(context.source, 'http-remote');
    assert.equal(context.token, undefined);
    assert.equal(JSON.stringify(context).includes(bearer), false);
  });
});
