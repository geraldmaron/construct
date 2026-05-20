/**
 * lib/intake/queue.mjs — IntakeQueue interface + backend factory.
 *
 * The IntakeQueue contract carries the R&D intake packets from the embed
 * daemon (writer) to the agent in the user's editor (reader/processor).
 * Solo mode is backed by the filesystem under `.cx/intake/`; team and
 * enterprise modes are backed by Postgres with row-locked worker claims.
 * Callers never branch on backend — they ask for a queue via
 * `createIntakeQueue(rootDir, env)` and use the same six methods.
 *
 * Queue entry shape:
 *   {
 *     id, createdAt, status: 'pending'|'processed'|'skipped',
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
import { PostgresIntakeQueue } from './postgres-queue.mjs';
import { getDeploymentMode } from '../deployment-mode.mjs';
import { createSqlClient } from '../storage/backend.mjs';

export { FilesystemIntakeQueue, PostgresIntakeQueue, queueRoot, pendingDir, processedDir, skippedDir };

export const INTAKE_QUEUE_BACKEND_ENV_KEY = 'CONSTRUCT_INTAKE_QUEUE_BACKEND';
export const INTAKE_PROJECT_ENV_KEY = 'CONSTRUCT_PROJECT_NAME';
export const INTAKE_TENANT_ENV_KEY = 'CONSTRUCT_TENANT_ID';

function resolveBackend(env) {
  const override = env?.[INTAKE_QUEUE_BACKEND_ENV_KEY];
  if (override === 'filesystem' || override === 'postgres') return override;
  const mode = getDeploymentMode(env);
  return mode === 'solo' ? 'filesystem' : 'postgres';
}

function resolveProject(rootDir, env) {
  const explicit = env?.[INTAKE_PROJECT_ENV_KEY];
  if (explicit && explicit.trim()) return explicit.trim();
  return path.basename(path.resolve(rootDir)).trim() || 'construct';
}

/**
 * Create an IntakeQueue instance for the given project root.
 * Backend selection: CONSTRUCT_INTAKE_QUEUE_BACKEND override wins; otherwise
 * solo mode → filesystem, team/enterprise → postgres. The postgres
 * backend pulls its connection from createSqlClient(env) and uses
 * CONSTRUCT_PROJECT_NAME / CONSTRUCT_TENANT_ID to scope queries; an
 * explicit `sql` and `project` in opts override both.
 */
export function createIntakeQueue(rootDir, env = process.env, opts = {}) {
  const backend = opts.backend || resolveBackend(env);
  if (backend === 'filesystem') return new FilesystemIntakeQueue(rootDir);
  if (backend === 'postgres') {
    const sql = opts.sql ?? createSqlClient(env);
    if (!sql) {
      throw new Error('Postgres intake queue requires a configured DATABASE_URL (or sql client). Run `construct init` or set CONSTRUCT_INTAKE_QUEUE_BACKEND=filesystem.');
    }
    const project = opts.project ?? resolveProject(rootDir, env);
    const tenantId = opts.tenantId ?? env?.[INTAKE_TENANT_ENV_KEY] ?? null;
    return new PostgresIntakeQueue({ sql, project, tenantId });
  }
  throw new Error(`Unknown intake queue backend: ${backend}`);
}
