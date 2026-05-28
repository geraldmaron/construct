/**
 * lib/scheduler/index.mjs — deployment-topology-aware background job scheduler.
 *
 * Three modes:
 *   solo        — native platform triggers (launchd/systemd/Task Scheduler) via lib/scheduler/solo.mjs
 *   team/enterprise — Postgres advisory lock runner via lib/scheduler/postgres.mjs
 *   one-shot    — run handler synchronously and exit (for CI)
 *
 * Jobs registered here: 'tag-candidate-mining', 'skill-usage-rollup', 'doc-hygiene-scan'
 *
 * Deployment mode is determined by getDeploymentMode(env), which inspects env vars.
 * Registration is in-memory: no persistence across process restarts beyond the
 * native trigger files written by solo.mjs or the DB rows in 009_scheduler.sql.
 */

// ---------------------------------------------------------------------------
// In-memory job registry
// ---------------------------------------------------------------------------

const jobRegistry = new Map();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers a job definition in memory. Overwrites any prior registration
 * with the same id.
 *
 * @param {object} opts
 *   id            {string}   - Unique job identifier
 *   schedule      {string}   - Cron expression or interval string
 *   mode          {string}   - 'solo' | 'team' | 'enterprise' | 'one-shot'
 *   handler       {Function} - Async function ({ cwd, env }) => result
 *   leaderLockKey {string}   - Postgres advisory lock key (team/enterprise only)
 */
export function registerJob({ id, schedule, mode, handler, leaderLockKey = null }) {
  jobRegistry.set(id, { id, schedule, mode, handler, leaderLockKey, registeredAt: new Date().toISOString() });
}

/**
 * Runs the handler for the given job id synchronously in the current process.
 * Returns the handler's result. Throws if the job id is not registered.
 */
export async function runJobOnce(id, { cwd = process.cwd(), env = process.env } = {}) {
  const job = jobRegistry.get(id);
  if (!job) throw new Error(`job not registered: ${id}`);
  return job.handler({ cwd, env });
}

/**
 * Returns an array of all registered job definitions (handler excluded for safety).
 */
export function listJobs() {
  return Array.from(jobRegistry.values()).map(({ id, schedule, mode, leaderLockKey, registeredAt }) => ({
    id, schedule, mode, leaderLockKey, registeredAt,
  }));
}

/**
 * Derives the deployment mode from environment variables.
 * Returns 'enterprise' | 'team' | 'solo'.
 *
 * CONSTRUCT_DEPLOYMENT=enterprise or CONSTRUCT_ENTERPRISE=1 => enterprise
 * CONSTRUCT_DEPLOYMENT=team or CONSTRUCT_TEAM=1             => team
 * Otherwise                                                  => solo
 */
export function getDeploymentMode(env = process.env) {
  const explicit = env.CONSTRUCT_DEPLOYMENT;
  if (explicit === 'enterprise' || env.CONSTRUCT_ENTERPRISE === '1') return 'enterprise';
  if (explicit === 'team' || env.CONSTRUCT_TEAM === '1') return 'team';
  if (explicit === 'solo') return 'solo';
  return 'solo';
}

// ---------------------------------------------------------------------------
// Built-in job registrations
// ---------------------------------------------------------------------------

registerJob({
  id: 'tag-candidate-mining',
  schedule: '0 3 * * *',
  mode: 'solo',
  handler: async ({ cwd, env }) => {
    const { default: run } = await import('../../scripts/tag-candidate-mining.mjs');
    return run({ cwd, env });
  },
});

registerJob({
  id: 'skill-usage-rollup',
  schedule: '0 4 * * 1',
  mode: 'solo',
  handler: async () => ({ status: 'noop', reason: 'not yet implemented' }),
});

registerJob({
  id: 'doc-hygiene-scan',
  schedule: '0 2 * * *',
  mode: 'solo',
  handler: async ({ cwd, env }) => {
    const { findHygieneCandidates } = await import('../hygiene/scan.mjs');
    const mode = getDeploymentMode(env);
    const limit = mode === 'solo' ? 25 : 50;
    const candidates = findHygieneCandidates({ cwd, limit });
    return {
      status: 'ok',
      candidates: candidates.length,
      items: candidates.map((c) => ({ rel: c.rel, reason: c.reason, ageDays: c.ageDays })),
    };
  },
});
