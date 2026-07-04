/**
 * lib/intake/queue.mjs — IntakeQueue interface + backend factory.
 *
 * The IntakeQueue contract carries the R&D intake packets from the embed
 * daemon (writer) to the agent in the user's editor (reader/processor).
 * Substrate owns the queue CONTRACT; git-queue is the zero-dependency default
 * kind:'queue' provider and Postgres is an optional kind:'queue' provider
 * selected through the extension registry (construct-9oi4.7.11). Solo mode
 * resolves to the filesystem provider under `.cx/intake/`; team and enterprise
 * default to the git provider. Callers never branch on backend — they ask for a
 * queue via `createIntakeQueue(rootDir, env)` and use the same six methods.
 * The returned instance also carries `.tenantId` (ADR-0057/A7: resolved once
 * from CONSTRUCT_TENANT_ID/config, 'local' default outside enterprise mode)
 * so a caller can stamp it onto entries without re-resolving it.
 *
 * Queue entry shape:
 *   {
 *     id, createdAt, status: 'pending'|'processed'|'skipped',
 *     tenantId?,
 *     intake: { sourcePath, outputPath, characters, knowledgeSubdir },
 *     triage: { intakeType, rdStage, primaryOwner, recommendedChain,
 *               recommendedAction, risk, requiresApproval, confidence,
 *               rationale },
 *     suggestion: { lane, source },
 *     related: [{ path, title, score, summary }],
 *     excerpt: string,
 *     query: string,
 *     processedAt?, processedBy?, notes?,
 *     skippedAt?, skippedBy?, reason?
 *   }
 *
 * Interface methods:
 *   enqueue(entry)                    → { id, filePath? } — writes a new pending packet
 *   listPending()                     → entry[] sorted oldest-first
 *   count()                           → number of pending entries
 *   read(id)                          → entry | null — checks all three statuses
 *   markProcessed(id, { processedBy, notes }) → { id, filePath? }
 *   markSkipped(id, { skippedBy, reason })    → { id, filePath? }
 *   reopen(id)                        → { id, from }
 */

import path from 'node:path';

import { FilesystemIntakeQueue, queueRoot, pendingDir, processedDir, skippedDir } from './filesystem-queue.mjs';
import { GitIntakeQueue } from './git-queue.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { createSqlClient } from '../storage/backend.mjs';
import { findQueueProvider, BUILTIN_QUEUE_BACKENDS } from './queue-registry.mjs';
import { resolveTenantContext, TENANT_ID_ENV_KEY, DEFAULT_TENANT_ID } from '../tenant/context.mjs';
import { PostgresIntakeQueue } from '../queue/pg-queue.mjs';

export { FilesystemIntakeQueue, GitIntakeQueue, queueRoot, pendingDir, processedDir, skippedDir };

export const INTAKE_QUEUE_BACKEND_ENV_KEY = 'CONSTRUCT_INTAKE_QUEUE_BACKEND';
export const INTAKE_PROJECT_ENV_KEY = 'CONSTRUCT_PROJECT_NAME';
export const INTAKE_TENANT_ENV_KEY = 'CONSTRUCT_TENANT_ID';
export const INTAKE_QUEUE_NAME_ENV_KEY = 'CONSTRUCT_INTAKE_QUEUE_NAME';
export const INTAKE_QUEUE_LEASE_SECONDS_ENV_KEY = 'CONSTRUCT_QUEUE_LEASE_SECONDS';

// Re-exported so a caller can resolve the same tenant value the factory
// stamps on the queue without importing lib/tenant/context.mjs directly.
export { TENANT_ID_ENV_KEY, DEFAULT_TENANT_ID } from '../tenant/context.mjs';

// Thrown when a caller names a queue backend that is neither a builtin provider
// (git/filesystem) nor a registered kind:'queue' extension. The reframing
// removed the silent postgres->git alias, so an unknown backend is a hard,
// explicit error rather than a swallowed downgrade.

export class UnregisteredQueueProviderError extends Error {
  constructor(backend) {
    super(
      `Queue backend '${backend}' has no registered kind:'queue' provider. ` +
      `Builtin providers: ${BUILTIN_QUEUE_BACKENDS.join(', ')}. ` +
      `Install a kind:'queue' extension (e.g. a Postgres provider) to select it.`,
    );
    this.name = 'UnregisteredQueueProviderError';
    this.backend = backend;
  }
}

// Selection resolves through the registry by kind. An explicit backend override
// wins; otherwise deployment mode picks the default provider (solo→filesystem,
// team/enterprise→git). A non-builtin backend must resolve to a registered
// kind:'queue' provider or the call fails explicitly.

function resolveBackend(env, rootDir) {
  const override = env?.[INTAKE_QUEUE_BACKEND_ENV_KEY];
  const requested = override && String(override).trim()
    ? String(override).trim()
    : (getDeploymentMode(env) === 'solo' ? 'filesystem' : 'git');

  if (BUILTIN_QUEUE_BACKENDS.includes(requested)) return { backend: requested, provider: null };

  const provider = findQueueProvider(requested, { rootDir, env });
  if (!provider) throw new UnregisteredQueueProviderError(requested);
  return { backend: requested, provider };
}

function resolveProject(rootDir, env) {
  const explicit = env?.[INTAKE_PROJECT_ENV_KEY];
  if (explicit && explicit.trim()) return explicit.trim();
  return path.basename(path.resolve(rootDir)).trim() || 'construct';
}

// Resolves the tenant context (config + env, validated) for queue scoping.
// Reads CONSTRUCT_TENANT_ID directly here — the factory is a plumbing
// boundary, so it does not load construct.config.json itself and passes no
// config, which mirrors solo/team's config-optional path. Enterprise callers
// that need config-sourced tenantId should resolve it once at startup via
// lib/deployment-mode.mjs#validateTenantAtStartup and pass the result through
// opts.tenantId instead of relying on this fallback.

export function resolveIntakeTenantId(env = process.env, mode = getDeploymentMode(env)) {
  return resolveTenantContext({ env, mode }).tenantId;
}

/**
 * Create an IntakeQueue instance for the given project root.
 * Backend selection: CONSTRUCT_INTAKE_QUEUE_BACKEND override wins; otherwise
 * solo mode → filesystem, team/enterprise → git (the zero-dependency default
 * kind:'queue' provider). A backend that is neither builtin nor a registered
 * kind:'queue' provider throws UnregisteredQueueProviderError — there is no
 * silent postgres->git alias.
 *
 * The returned instance carries a `.tenantId` (opts.tenantId wins, otherwise
 * resolved from CONSTRUCT_TENANT_ID/config via resolveIntakeTenantId) so a
 * caller building a queue entry can stamp tenantId without re-deriving it —
 * the queue classes themselves stay tenant-agnostic (LMCP-H1; tenant-scoped
 * storage is LMCP-H4, not this bead).
 */
export function createIntakeQueue(rootDir, env = process.env, opts = {}) {
  const resolved = opts.backend
    ? (BUILTIN_QUEUE_BACKENDS.includes(opts.backend)
        ? { backend: opts.backend, provider: null }
        : (findQueueProvider(opts.backend, { rootDir, env })
            ? { backend: opts.backend, provider: findQueueProvider(opts.backend, { rootDir, env }) }
            : (() => { throw new UnregisteredQueueProviderError(opts.backend); })()))
    : resolveBackend(env, rootDir);

  const tenantId = opts.tenantId ?? resolveIntakeTenantId(env, getDeploymentMode(env));

  if (resolved.backend === 'filesystem') {
    const queue = new FilesystemIntakeQueue(rootDir);
    queue.tenantId = tenantId;
    return queue;
  }
  if (resolved.backend === 'git') {
    const project = opts.project ?? resolveProject(rootDir, env);
    const queue = new GitIntakeQueue({ project, rootDir });
    queue.tenantId = tenantId;
    return queue;
  }

  if (resolved.backend === 'postgres' || resolved.provider?.id === 'postgres') {
    const sql = opts.sql ?? createSqlClient(env);
    if (!sql) {
      throw new Error(
        `Queue backend '${resolved.backend}' requires DATABASE_URL or CONSTRUCT_DATABASE_URL; ` +
        `no Postgres SQL client is configured.`,
      );
    }
    return new PostgresIntakeQueue({
      sql,
      project: opts.project ?? resolveProject(rootDir, env),
      tenantId,
      queueName: opts.queueName ?? env?.[INTAKE_QUEUE_NAME_ENV_KEY] ?? 'intake',
      leaseSeconds: opts.leaseSeconds ?? env?.[INTAKE_QUEUE_LEASE_SECONDS_ENV_KEY],
    });
  }

  // A registered kind:'queue' provider was selected but no in-tree instantiation
  // path exists yet. The selection is honest — it names the resolved provider
  // rather than silently downgrading to git.

  throw new Error(
    `Queue backend '${resolved.backend}' resolves to registered kind:'queue' provider ` +
    `'${resolved.provider?.id}' but no in-tree instantiation path is wired yet.`,
  );
}
