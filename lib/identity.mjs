/**
 * lib/identity.mjs — actor and service identity for the control plane.
 *
 * Resolves human vs service identity from request headers (X-Construct-Actor-Id,
 * -Tenant-Id, -Session-Id) or env fallback, and validates it per deployment mode
 * (team/enterprise reject implicit-solo identity). Feeds policy, approval, and audit.
 */

import { getDeploymentMode } from './deployment-mode.mjs';
import os from 'node:os';

export class IdentityError extends Error {
  constructor(message) { super(message); this.name = 'IdentityError'; }
}

export function serviceIdentity({ serviceId, deploymentMode, role, source } = {}) {
  return {
    type: 'service',
    serviceId: serviceId || 'construct-mcp',
    deploymentMode: deploymentMode || 'solo',
    pid: process.pid,
    role: role || null,
    source: source || 'implicit-solo',
  };
}

export function humanIdentity({ userId, tenantId, sessionId, role, source } = {}) {
  return {
    type: 'human',
    userId: userId || null,
    tenantId: tenantId || null,
    sessionId: sessionId || null,
    role: role || null,
    source: source || 'headers',
  };
}

export function resolveIdentity(params = {}, { env = process.env, cwd } = {}) {
  const mode = getDeploymentMode(env, { cwd });
  const meta = params?._meta || {};

  const actorId = meta['X-Construct-Actor-Id'] || '';
  const tenantId = meta['X-Construct-Tenant-Id'] || '';
  const sessionId = meta['X-Construct-Session-Id'] || '';
  const hasHeaders = Boolean(actorId);

  if ((mode === 'team' || mode === 'enterprise') && !hasHeaders) {
    const role = env.CONSTRUCT_ROLE;
    if (role) {
      return serviceIdentity({ serviceId: `role:${role}`, deploymentMode: mode, role, source: 'env-fallback' });
    }
    throw new IdentityError(`Missing actor identity in ${mode} mode. Set X-Construct-Actor-Id header or CONSTRUCT_ROLE env var.`);
  }

  if (hasHeaders) {
    const isHuman = actorId.includes('@');
    if (isHuman) {
      return humanIdentity({ userId: actorId, tenantId: tenantId || null, sessionId: sessionId || null, role: env.CONSTRUCT_ROLE || null, source: 'headers' });
    }
    return serviceIdentity({ serviceId: actorId, deploymentMode: mode, role: env.CONSTRUCT_ROLE || null, source: 'headers' });
  }

  return serviceIdentity({ serviceId: `local-${os.hostname()}`, deploymentMode: mode, role: env.CONSTRUCT_ROLE || null, source: 'implicit-solo' });
}

export function identityRole(identity) {
  return identity?.role || null;
}

export function validateIdentity(identity, mode) {
  if (!identity) return 'Identity is required';
  if (!identity.type) return 'Identity type is required';
  if (identity.type === 'human' && !identity.userId) return 'Human identity requires userId';
  if (identity.type === 'service' && !identity.serviceId) return 'Service identity requires serviceId';
  if ((mode === 'team' || mode === 'enterprise') && identity.source === 'implicit-solo') {
    return `Implicit identity not allowed in ${mode} mode`;
  }
  return null;
}

export function identityToRecord(identity) {
  if (!identity) return {};
  return {
    type: identity.type,
    userId: identity.userId || null,
    serviceId: identity.serviceId || null,
    tenantId: identity.tenantId || null,
    sessionId: identity.sessionId || null,
    role: identity.role || null,
    deploymentMode: identity.deploymentMode || null,
  };
}