/**
 * lib/boundary.mjs — Authenticated parent/child boundary registration.
 *
 * Verifies a parent Construct instance is reachable, validates an HMAC
 * signature over `childInstanceId|nonce` when a shared secret is configured,
 * and persists the binding to boundary.json in the XDG config dir (mode 0600). A
 * different parent rotates the registration only when explicitly allowed via
 * CONSTRUCT_BOUNDARY_ALLOW_OVERRIDE=1; prior configs are archived alongside
 * the active one. Exposed as a standalone module so the dashboard endpoint
 * and the functional tests share the same logic.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { configDir } from './config/xdg.mjs';

export const BOUNDARY_VERSION = '1.0';

function boundaryDir(home = homedir()) {
  return configDir(home);
}

export function boundaryConfigPath(home = homedir()) {
  return join(boundaryDir(home), 'boundary.json');
}

export async function registerBoundary({
  parentInstance,
  parentUrl,
  childInstanceId,
  nonce,
  signature,
  sharedSecret = null,
  home = homedir(),
  allowOverride = process.env.CONSTRUCT_BOUNDARY_ALLOW_OVERRIDE === '1',
  probe = probeParent,
}) {
  if (!parentInstance || !parentUrl) {
    return { ok: false, status: 400, error: 'parentInstance and parentUrl are required' };
  }
  if (!childInstanceId) {
    return { ok: false, status: 400, error: 'childInstanceId is required' };
  }

  if (sharedSecret) {
    if (!nonce || !signature) {
      return { ok: false, status: 401, error: 'nonce and signature are required when a shared secret is configured' };
    }
    const expected = createHmac('sha256', sharedSecret).update(`${childInstanceId}|${nonce}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    let b;
    try { b = Buffer.from(String(signature), 'hex'); } catch { return { ok: false, status: 401, error: 'invalid signature encoding' }; }
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, status: 401, error: 'signature mismatch' };
    }
  }

  const reachable = await probe(parentUrl);
  if (!reachable.ok) {
    return { ok: false, status: 502, error: `parent unreachable: ${reachable.error}` };
  }

  const dir = boundaryDir(home);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cfgPath = boundaryConfigPath(home);

  let prior = null;
  if (existsSync(cfgPath)) {
    try { prior = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { prior = null; }
  }

  if (prior && prior.parentInstance && prior.parentInstance !== parentInstance) {
    if (!allowOverride) {
      return {
        ok: false,
        status: 409,
        error: `child already bound to parent '${prior.parentInstance}'; set CONSTRUCT_BOUNDARY_ALLOW_OVERRIDE=1 to rotate`,
      };
    }
    const archivePath = join(dir, `boundary.${Date.now()}.json`);
    try { writeFileSync(archivePath, JSON.stringify(prior, null, 2)); } catch { /* archive is best effort */ }
  }

  const config = {
    parentInstance,
    parentUrl,
    childInstanceId,
    registeredAt: new Date().toISOString(),
    rotatedFrom: prior?.parentInstance || null,
    nonce: nonce || randomBytes(16).toString('hex'),
    boundaryVersion: BOUNDARY_VERSION,
  };

  writeFileSync(cfgPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { ok: true, config, path: cfgPath };
}

export function probeParent(parentUrl) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(parentUrl); } catch { return resolve({ ok: false, error: 'invalid URL' }); }
    if (!/^https?:$/.test(parsed.protocol)) return resolve({ ok: false, error: 'unsupported protocol' });
    const fn = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = fn({
      method: 'HEAD',
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname || '/',
      timeout: 3000,
    }, (response) => {
      resolve({ ok: response.statusCode < 500 });
      response.resume();
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.end();
  });
}

export function signBoundaryRequest({ childInstanceId, nonce, sharedSecret }) {
  return createHmac('sha256', sharedSecret).update(`${childInstanceId}|${nonce}`).digest('hex');
}
