/**
 * lib/net-guard.mjs — shared SSRF / DNS-rebinding egress guard.
 *
 * Every outbound HTTP call Construct makes on behalf of a manifest, provider,
 * or url-type MCP entry is attacker-influenced in its destination: a malicious
 * manifest URL or a rebinding DNS record can point an otherwise-trusted call at
 * a loopback or private-range service and pivot into the host. This guard is
 * the single chokepoint that prevents that.
 *
 * Two properties, enforced together:
 *   1. Address policy — the destination hostname is resolved and EVERY returned
 *      address is classified; loopback, private, link-local (incl. cloud
 *      metadata 169.254.169.254), CGNAT, and unspecified ranges are denied by
 *      default. `allowPrivate: true` is the explicit, audited opt-out for
 *      on-host/dev use.
 *   2. Rebinding pinning — the address validated at check time is the exact
 *      address the socket connects to. `resolveGuardedTarget` resolves ONCE and
 *      returns a pinned IP; `guardedFetch` connects to that pinned IP with the
 *      original hostname preserved as TLS servername + Host header, so a DNS
 *      record that flips to a private address between check and connect can
 *      never move the connection — the socket never re-resolves.
 *
 * The security decision lives entirely in the pure, network-free
 * `classifyAddress` / `resolveGuardedTarget` (DNS is injectable), so the policy
 * is unit-testable without a socket; `guardedFetch` is the thin I/O shell.
 */

import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';

const dnsLookupAll = promisify(dnsLookup);

export const DEFAULT_ALLOWED_SCHEMES = Object.freeze(['https:', 'http:']);

/** Named egress-policy rejection; `.reason` is a stable machine tag. */
export class SsrfBlockedError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.reason = reason;
  }
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inCidr4(ipInt, baseIp, prefix) {
  const base = ipv4ToInt(baseIp);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8, 'unspecified'],
  ['10.0.0.0', 8, 'private-address'],
  ['100.64.0.0', 10, 'cgnat'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link-local'],
  ['172.16.0.0', 12, 'private-address'],
  ['192.0.0.0', 24, 'ietf-protocol'],
  ['192.168.0.0', 16, 'private-address'],
  ['198.18.0.0', 15, 'benchmark'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'],
];

/**
 * Classify a raw IP literal. Returns a stable reason tag when the address is in
 * a range that must not be reached from an attacker-influenced URL, or null
 * when the address is a routable public address.
 *
 * @param {string} ip
 * @returns {string|null}
 */
export function classifyAddress(ip) {
  const family = isIP(ip);
  if (family === 4) {
    const asInt = ipv4ToInt(ip);
    if (asInt === null) return 'unparseable';
    for (const [base, prefix, reason] of BLOCKED_V4) {
      if (inCidr4(asInt, base, prefix)) return reason;
    }
    return null;
  }
  if (family === 6) {
    const norm = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (norm === '::1') return 'loopback';
    if (norm === '::' ) return 'unspecified';
    if (norm.startsWith('fe80')) return 'link-local';
    if (norm.startsWith('fc') || norm.startsWith('fd')) return 'unique-local';
    // IPv4-mapped (::ffff:a.b.c.d) is classified on its embedded v4 address.
    const mapped = norm.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return classifyAddress(mapped[1]);
    return null;
  }
  return 'not-an-ip';
}

/**
 * Validate a URL's scheme + host and resolve its hostname to a single pinned,
 * policy-checked address. Pure with respect to the network: DNS is injected via
 * `lookup`. Throws SsrfBlockedError on any violation.
 *
 * @param {string} rawUrl
 * @param {object} [opts]
 * @param {(hostname: string) => Promise<Array<{address: string, family: number}>>} [opts.lookup]
 * @param {boolean} [opts.allowPrivate] - permit private/loopback ranges (audited opt-out)
 * @param {string[]} [opts.allowedSchemes]
 * @returns {Promise<{ url: URL, pinnedAddress: string, family: number, port: number, servername: string }>}
 */
export async function resolveGuardedTarget(rawUrl, opts = {}) {
  const { allowPrivate = false, allowedSchemes = DEFAULT_ALLOWED_SCHEMES } = opts;
  const lookup = opts.lookup ?? ((hostname) => dnsLookupAll(hostname, { all: true }));

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`net-guard: not a valid URL: ${String(rawUrl).slice(0, 120)}`, 'invalid-url');
  }

  if (!allowedSchemes.includes(url.protocol)) {
    throw new SsrfBlockedError(`net-guard: scheme '${url.protocol}' is not allowed`, 'blocked-scheme');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // A URL that already carries an IP literal skips DNS but is still classified —
  // http://127.0.0.1 must be blocked exactly like a hostname resolving to it.
  const literalFamily = isIP(hostname);
  let addresses;
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    addresses = await lookup(hostname);
    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new SsrfBlockedError(`net-guard: '${hostname}' did not resolve to any address`, 'no-address');
    }
  }

  // ALL resolved addresses must pass — a hostname that returns one public and
  // one private address is rejected, never partially trusted.
  for (const { address } of addresses) {
    if (allowPrivate) continue;
    const reason = classifyAddress(address);
    if (reason) {
      throw new SsrfBlockedError(`net-guard: '${hostname}' resolves to a blocked address (${address}: ${reason})`, reason);
    }
  }

  const pinned = addresses[0];
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  return { url, pinnedAddress: pinned.address, family: pinned.family, port, servername: hostname };
}

function decodeBody(buffer, encoding) {
  if (!buffer.length) return buffer;
  try {
    if (encoding === 'gzip') return gunzipSync(buffer);
    if (encoding === 'deflate') return inflateSync(buffer);
    if (encoding === 'br') return brotliDecompressSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

function makeResponse({ statusCode, headers, bodyBuffer, url }) {
  const decoded = decodeBody(bodyBuffer, String(headers['content-encoding'] ?? '').toLowerCase());
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : v]));
  return {
    status: statusCode,
    ok: statusCode >= 200 && statusCode < 300,
    url,
    headers: { get: (name) => headerMap.get(String(name).toLowerCase()) ?? null },
    async text() { return decoded.toString('utf8'); },
    async json() { return JSON.parse(decoded.toString('utf8') || 'null'); },
  };
}

/**
 * fetch-compatible egress call that enforces the guard and connects to the
 * pinned, validated address (rebinding-proof). Follows redirects manually,
 * re-validating every hop through the same guard. Returns a minimal Response
 * ({ status, ok, headers.get, text, json }) covering what the provider
 * transports use.
 *
 * @param {string} rawUrl
 * @param {{ method?: string, headers?: Record<string,string>, body?: string }} [init]
 * @param {object} [opts] - forwarded to resolveGuardedTarget, plus maxRedirects
 * @returns {Promise<object>}
 */
export async function guardedFetch(rawUrl, init = {}, opts = {}) {
  const maxRedirects = opts.maxRedirects ?? 5;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const target = await resolveGuardedTarget(currentUrl, opts);
    const res = await requestPinned(target, init);

    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      currentUrl = new URL(res.headers.location, target.url).href;
      if (res.statusCode === 303) { init = { ...init, method: 'GET', body: undefined }; }
      continue;
    }
    return makeResponse({ statusCode: res.statusCode, headers: res.headers, bodyBuffer: res.bodyBuffer, url: target.url.href });
  }
  throw new SsrfBlockedError(`net-guard: exceeded ${maxRedirects} redirects for ${rawUrl}`, 'too-many-redirects');
}

function requestPinned(target, init) {
  const { url, pinnedAddress, family, port, servername } = target;
  const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest;

  // The socket connects to the pinned IP; the hostname survives only as TLS
  // servername + Host header. The custom lookup guarantees the pinned address
  // is the only one the agent can dial — DNS is never consulted again here.
  const pinnedLookup = (_hostname, _options, cb) => cb(null, pinnedAddress, family);

  const options = {
    method: init.method ?? 'GET',
    host: servername,
    port,
    path: `${url.pathname}${url.search}`,
    headers: { Host: url.host, ...(init.headers ?? {}) },
    servername,
    lookup: pinnedLookup,
  };

  return new Promise((resolve, reject) => {
    const req = doRequest(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, bodyBuffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
