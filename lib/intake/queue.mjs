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
import { GitIntakeQueue } from './git-queue.mjs';
import { getDeploymentMode, requireTeamCapabilityOrDegrade } from '../deployment-mode.mjs';

export { FilesystemIntakeQueue, GitIntakeQueue, queueRoot, pendingDir, processedDir, skippedDir };

export const INTAKE_QUEUE_BACKEND_ENV_KEY = 'CONSTRUCT_INTAKE_QUEUE_BACKEND';
export const INTAKE_PROJECT_ENV_KEY = 'CONSTRUCT_PROJECT_NAME';
export const INTAKE_TENANT_ENV_KEY = 'CONSTRUCT_TENANT_ID';

function resolveBackend(env, rootDir) {
  const override = env?.[INTAKE_QUEUE_BACKEND_ENV_KEY];
  if (override === 'filesystem' || override === 'git') return override;
  const mode = getDeploymentMode(env);
  if (mode !== 'solo') {
    // team/enterprise requires a postgres-backed queue; 'git' is the current
    // fallback implementation. Surface an explicit degradation check so the
    // caller cannot silently get solo-like behavior without opting in.
    requireTeamCapabilityOrDegrade('postgres-queue', false, env, { cwd: rootDir });
  }
  return mode === 'solo' ? 'filesystem' : 'git';
}

function resolveProject(rootDir, env) {
  const explicit = env?.[INTAKE_PROJECT_ENV_KEY];
  if (explicit && explicit.trim()) return explicit.trim();
  return path.basename(path.resolve(rootDir)).trim() || 'construct';
}

/**
 * Create an IntakeQueue instance for the given project root.
 * Backend selection: CONSTRUCT_INTAKE_QUEUE_BACKEND override wins; otherwise
 * solo mode → filesystem, team/enterprise → git (with explicit degradation
 * check — callers must set CONSTRUCT_DEGRADED_OK=postgres-queue to allow the
 * git fallback in team/enterprise mode). The git backend uses the filesystem
 * and git for state synchronization.
 */
export function createIntakeQueue(rootDir, env = process.env, opts = {}) {
  const backend = opts.backend || resolveBackend(env, rootDir);
  if (backend === 'filesystem') return new FilesystemIntakeQueue(rootDir);
  if (backend === 'git' || backend === 'postgres') {
    // 'postgres' aliases to 'git' so existing configs keep resolving

    const project = opts.project ?? resolveProject(rootDir, env);
    return new GitIntakeQueue({ project, rootDir });
  }
  throw new Error(`Unknown intake queue backend: ${backend}`);
}
