/**
 * lib/deployment-mode.mjs — Construct deployment mode (solo | team | enterprise).
 *
 * Encodes the deployment posture the rest of the system reads to choose
 * backends for the intake queue, memory, telemetry, and workers. The
 * mode resolves with env > construct.config.json > default precedence
 * (`getDeploymentMode(env, {cwd})`); the resource topology for each mode
 * is derived here, not stored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { projectConfigDir } from './config-dir.mjs';
import { loadProjectConfig } from './config/project-config.mjs';
import { resolveTenantContext, TenantResolutionError } from './tenant/context.mjs';

export const DEPLOYMENT_MODES = ['solo', 'team', 'enterprise'];
export const DEFAULT_DEPLOYMENT_MODE = 'solo';

export const DEPLOYMENT_MODE_ENV_KEY = 'CONSTRUCT_DEPLOYMENT_MODE';

// The queue dimension names the default kind:'queue' provider, not a hardcoded
// backend. Solo keeps the zero-dependency local provider; team/enterprise now
// default to Postgres so distributed claims are row-locked and lease-backed.

const RESOURCE_TOPOLOGY = {
  solo: {
    queue: 'filesystem',
    memory: 'local',
    database: 'optional',
    telemetry: 'optional',
    workers: 'local',
    policy: 'lightweight',
    mcp: 'direct',
  },
  team: {
    queue: 'postgres',
    memory: 'shared',
    database: 'postgres',
    telemetry: 'central',
    workers: 'docker',
    policy: 'server-side',
    mcp: 'brokered',
  },
  enterprise: {
    queue: 'postgres',
    memory: 'shared',
    database: 'postgres',
    telemetry: 'central',
    workers: 'isolated',
    policy: 'enforceable',
    mcp: 'brokered-signed',
  },
};

const MODE_DESCRIPTIONS = {
  solo: 'Individual usage. Filesystem intake queue, local repo state, optional Postgres/Docker/telemetry.',
  team: 'Shared usage. Postgres intake queue, shared memory, Docker worker pool, central telemetry, brokered MCP.',
  enterprise: 'Hardened usage. Adds tenant isolation, RBAC/ABAC scaffolding, isolated worker containers, signed MCP allowlists, mandatory audit on top of team.',
};

export function isValidDeploymentMode(value) {
  return typeof value === 'string' && DEPLOYMENT_MODES.includes(value);
}

export function describeDeploymentMode(mode) {
  return MODE_DESCRIPTIONS[mode] || '';
}

export function getDeploymentMode(env = process.env, { cwd } = {}) {
  const raw = env?.[DEPLOYMENT_MODE_ENV_KEY];
  if (raw) {
    const trimmed = String(raw).trim().toLowerCase();
    return isValidDeploymentMode(trimmed) ? trimmed : DEFAULT_DEPLOYMENT_MODE;
  }
  try {
    const { config } = loadProjectConfig(cwd, env);
    const fromConfig = config?.deployment?.mode;
    if (typeof fromConfig === 'string' && isValidDeploymentMode(fromConfig)) return fromConfig;
  } catch { /* loader is best-effort — fall through to default */ }
  return DEFAULT_DEPLOYMENT_MODE;
}

export function resolveResourceMode(mode = DEFAULT_DEPLOYMENT_MODE) {
  const topology = RESOURCE_TOPOLOGY[mode];
  if (!topology) {
    throw new Error(`Unknown deployment mode: ${mode}. Valid modes: ${DEPLOYMENT_MODES.join(', ')}`);
  }
  return { ...topology };
}

// Enterprise mode without a resolvable tenant id
// fails closed at startup rather than running unlabeled multi-tenant traffic.
// Solo/team resolve to the explicit default tenant 'local' and never throw
// here. Call once per process/runtime start (CLI entry, MCP server boot,
// orchestration runtime) — resolveTenantContext itself is cheap and pure, so
// re-validating per call is safe but redundant beyond the first.

export function validateTenantAtStartup(env = process.env, { cwd } = {}) {
  const mode = getDeploymentMode(env, { cwd });
  let config = null;
  try {
    ({ config } = loadProjectConfig(cwd, env));
  } catch { /* loader is best-effort — resolveTenantContext still sees env */ }
  return resolveTenantContext({ env, config, mode });
}

export { TenantResolutionError };

export function describeResourceLine(mode = DEFAULT_DEPLOYMENT_MODE) {
  const r = resolveResourceMode(mode);
  return `queue:${r.queue} · memory:${r.memory} · workers:${r.workers} · telemetry:${r.telemetry}`;
}

// Thrown when a team/enterprise mode requires a capability that is unavailable
// and the caller has not opted into degraded operation via CONSTRUCT_DEGRADED_OK.

export class DeploymentModeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeploymentModeError';
  }
}

/**
 * requireTeamCapabilityOrDegrade(subsystem, isAvailable, env, { cwd } = {})
 *
 * Enforces mode honesty: team/enterprise modes must not silently fall back to
 * solo behavior when a required subsystem is unavailable.
 *
 * - If mode is solo: no-op (solo degrades gracefully by design).
 * - If mode is team/enterprise AND isAvailable is true: no-op.
 * - If mode is team/enterprise AND isAvailable is false:
 *   - If CONSTRUCT_DEGRADED_OK includes `subsystem` → logs a durable degradation
 *     record to `.construct/degradation.jsonl` (if cwd is available) and returns normally.
 *   - Otherwise → throws DeploymentModeError.
 */
export function requireTeamCapabilityOrDegrade(subsystem, isAvailable, env = process.env, { cwd } = {}) {
  const mode = getDeploymentMode(env, { cwd });
  if (mode === 'solo') return; // solo is always best-effort
  if (isAvailable) return;

  const degradedOk = String(env?.CONSTRUCT_DEGRADED_OK || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!degradedOk.includes(subsystem)) {
    throw new DeploymentModeError(
      `team mode requires ${subsystem}; set CONSTRUCT_DEGRADED_OK=${subsystem} to allow degraded operation`,
    );
  }

  // Degraded operation is explicitly permitted — write a durable record and continue.
  const record = JSON.stringify({
    ts: new Date().toISOString(),
    mode,
    subsystem,
    degradedOk: true,
  });
  if (cwd) {
    try {
      const constructDir = projectConfigDir(cwd);
      fs.mkdirSync(constructDir, { recursive: true });
      fs.appendFileSync(path.join(constructDir, 'degradation.jsonl'), record + '\n', 'utf8');
    } catch { /* degradation log is best-effort */ }
  }
}
