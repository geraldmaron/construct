/**
 * lib/oracle/directive-executor.mjs — opt-in execution of a due directive
 * (construct-p4cba.6, WS-B5).
 *
 * Off by default (`oracleExecuteDirectivesEnabled`, mirroring
 * lib/embed/reasoning-executor.mjs's `reasoningExecutorEnabled`: env var
 * wins over construct.config.json's `oracle.executeDirectives`). When
 * disabled, lib/oracle/execute.mjs's `directive-due` case falls back to the
 * same toast-only dispatch every other Oracle action already uses — a
 * human sees the directive is due and runs it manually
 * (`construct directives run <id>`), nothing executes unattended.
 *
 * When enabled, a due directive still cannot spend without a second,
 * independent opt-in: lib/policy/unattended-budget.mjs's
 * resolveUnattendedBudget fails closed (`configured: false`, zero budget)
 * unless a per-actor token cap is explicitly configured, the same
 * defense-in-depth gate lib/embed/reasoning-executor.mjs and
 * lib/telemetry/llm-judge.mjs already rely on for their own unattended
 * spend — this module does not invent a parallel budget concept.
 *
 * Execution itself goes through lib/orchestration/worker.mjs's
 * runTaskViaProvider — the real specialist persona/prompt materialization
 * path (construct-p4cba.5's write-proposal parsing rides along for free,
 * since it is unconditional in that function), not a hand-rolled prompt.
 * Any writeProposals the specialist recommends are enqueued onto the same
 * governed ApprovalQueue lib/writes/control-plane.mjs drains — this module
 * only ever enqueues, never calls a governed-write adapter directly.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkUnattendedSpend, recordUnattendedSpend } from '../policy/unattended-budget.mjs';
import { runTaskViaProvider } from '../orchestration/worker.mjs';
import { ApprovalQueue } from '../embed/approval-queue.mjs';

const DEFAULT_MODEL = 'anthropic/claude-opus-4-8';
const DEFAULT_TOKEN_ESTIMATE = 1500;

function envFlag(env, name) {
  const raw = env?.[name];
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return undefined;
}

/**
 * True only when explicitly opted in — env var wins over
 * construct.config.json's `oracle.executeDirectives`, else off.
 */
export function oracleExecuteDirectivesEnabled({ env = process.env, cwd = process.cwd() } = {}) {
  const envVal = envFlag(env, 'CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES');
  if (envVal !== undefined) return envVal;

  try {
    const cfgPath = join(cwd, 'construct.config.json');
    if (!existsSync(cfgPath)) return false;
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    return cfg?.oracle?.executeDirectives === true;
  } catch {
    return false;
  }
}

/**
 * Budget actor id for a directive's execution spend — its own
 * `oracle-directive-` namespace, parallel to reasoning-executor's
 * `embed-reasoning-` prefix, so the two consumers never collide on one
 * capability id meaning two different things.
 */
function directiveBudgetId(directiveId) {
  return `oracle-directive-${String(directiveId || 'unknown')}`;
}

/**
 * Execute one due directive: run its specialist against its instruction,
 * enqueue any recommended writes for governed approval. Never throws — a
 * failure at any stage (budget denial, provider error, queue write) returns
 * `{ ok: false, reason }` rather than propagating, since a directive
 * execution failure must not take down the Oracle approval flow around it.
 *
 * @param {object} directive - {id, specialist, instruction}
 * @param {object} opts
 * @param {string} opts.projectDir - resolves the write ApprovalQueue's persist path
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.model]
 * @param {string} [opts.provider]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {typeof runTaskViaProvider} [opts.runTask] - injectable for tests
 * @param {ApprovalQueue} [opts.approvalQueue] - injectable for tests
 * @returns {Promise<{ok: boolean, output?: string, writeProposalsQueued?: number, reason?: string, error?: string}>}
 */
export async function executeDirective(directive, {
  projectDir,
  env = process.env,
  model = DEFAULT_MODEL,
  provider = 'anthropic',
  fetchImpl = globalThis.fetch,
  runTask = runTaskViaProvider,
  approvalQueue = null,
} = {}) {
  const budgetId = directiveBudgetId(directive.id);
  const budgetCheck = checkUnattendedSpend(projectDir, budgetId, DEFAULT_TOKEN_ESTIMATE, { env });
  if (!budgetCheck.allowed) {
    return { ok: false, reason: budgetCheck.reason };
  }

  const task = { role: directive.workerProfileId, reason: directive.instruction, handoffContract: null };
  const run = { request: { summary: directive.instruction } };

  let result;
  try {
    result = await runTask({ task, run, model, provider, env, fetchImpl });
  } catch (err) {
    return { ok: false, error: err.message ?? String(err) };
  }

  const tokensSpent = result.providerMeta?.usage?.total_tokens ?? DEFAULT_TOKEN_ESTIMATE;
  recordUnattendedSpend(projectDir, budgetId, tokensSpent, { env });

  const proposals = result.writeProposals ?? [];
  if (proposals.length) {
    const queue = approvalQueue ?? new ApprovalQueue({ persistPath: ApprovalQueue.resolvePersistPath(projectDir) });
    for (const proposal of proposals) {
      queue.enqueue({
        tool: proposal.tool,
        args: proposal.payload,
        surface: 'oracle-directive',
        requestedBy: proposal.requestedBy,
      });
    }
  }

  return { ok: true, output: result.output, writeProposalsQueued: proposals.length };
}
