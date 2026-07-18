/**
 * lib/workplace-loop/directive-executor.mjs — the E5 (sources/directives/
 * workplace-loop) home for directive execution (construct-b0nny.25,
 * requirement 5: "Provide the equivalence tests M3b [construct-b0nny.17]
 * needs to retire Oracle's directive-executor.mjs onto this loop").
 *
 * disposition-matrix.md Cluster B2 and target-model.md concept 4 (Directive)
 * both name this subsystem — not lib/oracle/ — as directive execution's
 * target owner: "Owner. The sources/directives/workplace-loop subsystem
 * (E5); execution via the existing directive-executor pattern." This module
 * reproduces lib/oracle/directive-executor.mjs's behavior contract exactly
 * (same budget-gating discipline via lib/policy/unattended-budget.mjs, same
 * lib/orchestration/worker.mjs runTaskViaProvider execution path, same
 * ApprovalQueue enqueue-only-never-execute boundary) at its new home, so
 * construct-b0nny.17 can cut lib/oracle/execute.mjs's `directive-due` case
 * over to this module and delete lib/oracle/directive-executor.mjs once
 * tests/workplace-loop/directive-executor-equivalence.test.mjs proves
 * identical behavior on identical inputs (the deletion criteria disposition-
 * matrix.md's B2 entry and construct-b0nny.17 itself both require).
 *
 * lib/oracle/directive-executor.mjs is intentionally left untouched and this
 * module intentionally duplicates its logic rather than importing it — this
 * bead's own instructions require reproducing, not deleting, Oracle's
 * existing capability (deletion is construct-b0nny.17's job, once the
 * equivalence tests below are green), and the disposition matrix's own
 * rollback plan for M3 names exactly this shape: "keep the Oracle
 * daemon-entry ... behind a feature seam ... so rollback re-selects the old
 * overseer without redeploying deleted code" — an additive, parallel-running
 * new home, not an in-place rewrite of the old one.
 *
 * The env var / config key names (`CONSTRUCT_ORACLE_EXECUTE_DIRECTIVES`,
 * `oracle.executeDirectives`) are kept identical to Oracle's own, not
 * renamed to a `workplaceLoop.*` equivalent — any user who already opted
 * into unattended directive execution keeps that opt-in working unchanged
 * across the eventual cutover; construct-b0nny.17 is the appropriate bead to
 * decide whether the config surface itself should be renamed, since it owns
 * the actual call-site migration and any accompanying config-migration note.
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
 * construct.config.json's `oracle.executeDirectives`, else off. Identical
 * precedence and config surface to lib/oracle/directive-executor.mjs's
 * oracleExecuteDirectivesEnabled (see file header for why the name is kept).
 */
export function workplaceLoopExecuteDirectivesEnabled({ env = process.env, cwd = process.cwd() } = {}) {
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
 * Budget actor id for a directive's execution spend — kept byte-identical to
 * lib/oracle/directive-executor.mjs's directiveBudgetId so a directive's
 * accumulated daily spend is the same ledger row regardless of which module
 * executed it (a directive cannot double its effective budget by having two
 * executors each think they are the first spender of the day).
 */
function directiveBudgetId(directiveId) {
  return `oracle-directive-${String(directiveId || 'unknown')}`;
}

/**
 * Execute one due directive: run its specialist against its instruction,
 * enqueue any recommended writes for governed approval. Never throws — a
 * failure at any stage (budget denial, provider error, queue write) returns
 * `{ ok: false, reason }` rather than propagating. Behavior contract is
 * identical to lib/oracle/directive-executor.mjs's executeDirective; see
 * tests/workplace-loop/directive-executor-equivalence.test.mjs for the proof.
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

  const task = { role: directive.specialist, reason: directive.instruction, handoffContract: null };
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
        surface: 'workplace-loop-directive',
        requestedBy: proposal.requestedBy,
      });
    }
  }

  return { ok: true, output: result.output, writeProposalsQueued: proposals.length };
}
