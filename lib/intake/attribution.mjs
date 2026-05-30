/**
 * lib/intake/attribution.mjs — provenance metadata for intake-archetype artifacts.
 *
 * Two-field attribution. Human identity comes from `git config user.name` +
 * `user.email`; agent identity comes from CONSTRUCT_AGENT_ID (set by hosts
 * like Claude Code, Codex, Copilot before they invoke the binary). Both are
 * captured because either can be the proximate cause of a write and the
 * audit reader needs to know which.
 *
 * Pure, side-effect free. No git/cli call when the env var
 * CONSTRUCT_ATTRIBUTION_DISABLE=1 — useful for deterministic tests and for
 * privacy-sensitive setups that prefer no identity capture.
 */

import { spawnSync } from 'node:child_process';

function gitConfigValue(key, cwd) {
  const result = spawnSync('git', ['config', '--get', key], {
    cwd,
    encoding: 'utf8',
    timeout: 2000,
  });
  if (result.status !== 0) return null;
  const value = (result.stdout || '').trim();
  return value || null;
}

function humanIdentity(cwd) {
  const name = gitConfigValue('user.name', cwd);
  const email = gitConfigValue('user.email', cwd);
  if (!name && !email) return null;
  if (name && email) return `${name} <${email}>`;
  return name || email;
}

function agentIdentity() {
  return (
    process.env.CONSTRUCT_AGENT_ID
    || process.env.CLAUDE_AGENT_ID
    || null
  );
}

export function gatherAttribution({ now = new Date(), cwd } = {}) {
  if (process.env.CONSTRUCT_ATTRIBUTION_DISABLE === '1') {
    return {
      createdBy: null,
      createdByAgent: null,
      createdAt: now.toISOString(),
    };
  }
  return {
    createdBy: humanIdentity(cwd),
    createdByAgent: agentIdentity(),
    createdAt: now.toISOString(),
  };
}

export function stampAttribution(record, attribution = gatherAttribution()) {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    createdBy: attribution.createdBy,
    createdByAgent: attribution.createdByAgent,
    createdAt: attribution.createdAt,
  };
}

export function touchAttribution(record, attribution = gatherAttribution()) {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    lastModifiedBy: attribution.createdBy,
    lastModifiedByAgent: attribution.createdByAgent,
    lastModifiedAt: attribution.createdAt,
  };
}
