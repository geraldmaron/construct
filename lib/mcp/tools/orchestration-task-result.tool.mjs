/**
 * lib/mcp/tools/orchestration-task-result.tool.mjs — self-registered MCP tool
 * (LMCP-B5, lib/mcp/tool-registry.mjs) that ingests one host-executed
 * specialist task result for a run planned with worker_backend=host.
 *
 * orchestration_run materializes each specialist's prompt (system + user turn)
 * and stands the run at 'awaiting-host' without ever calling a model itself —
 * the calling host executes each prompt in its own session (the model/
 * subscription it is already running under) and reports the result back here.
 * submitHostTaskResult (lib/orchestration/runtime.mjs) is the single place that
 * validates and records the result and finalizes the run once every task is
 * terminal; this file only shapes that call as an MCP tool and echoes back the
 * next materialized prompt so a host can drive the whole run in a simple loop:
 * call orchestration_run once, then call this tool per task until next_task
 * is null.
 */

import { submitHostTaskResult } from '../../orchestration/runtime.mjs';
import { shapeRun } from './orchestration-run.mjs';

// The real return shape of orchestrationTaskResult below: {accepted:true,
// run_status, next_task} on success, {accepted:false, error, code} on
// rejection — a caller must branch on `accepted`, not assume success from a
// 200-shaped response.

const TASK_RESULT_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['accepted'],
  properties: {
    accepted: { type: 'boolean' },
    run_status: { type: 'string', description: 'Present when accepted:true — the run\'s shaped status after recording this result.' },
    next_task: {
      type: ['object', 'null'],
      description: 'The next awaiting-host task to execute, or null once the run is terminal — loop until null.',
      properties: {
        task_id: { type: 'string' },
        role: { type: 'string' },
        system: { type: ['string', 'null'] },
        user: { type: ['string', 'null'] },
      },
    },
    error: { type: 'string', description: 'Present when accepted:false.' },
    code: { type: 'string', description: 'Present when accepted:false, e.g. HOST_RESULT_REJECTED.' },
  },
  additionalProperties: true,
};

export const TOOL_DEFS = [
  {
    name: 'orchestration_task_result',
    description:
      'Submit one host-executed specialist task result for an orchestration run planned with '
      + 'worker_backend=host (the MCP default). orchestration_run returns each task\'s materialized '
      + 'prompt (system/user) without executing it; execute that prompt yourself as the named '
      + 'specialist role, then call this tool with the run_id, task_id, and your output. The '
      + 'response carries next_task (the next awaiting prompt) or null once the run is terminal — '
      + 'loop until null. model/provider/reasoning are optional, self-reported fields (never '
      + 'independently verified), recorded with provenanceSource "host-reported".',
    inputSchema: {
      type: 'object',
      required: ['run_id', 'task_id', 'output'],
      properties: {
        run_id: { type: 'string', description: 'The run id returned by orchestration_run.' },
        task_id: { type: 'string', description: 'The task id this result answers (e.g. "t1"), from orchestration_run\'s task list or a prior call\'s next_task.' },
        output: { type: 'string', description: 'The specialist output you produced for this task. Must be non-empty.' },
        model: { type: 'string', description: 'Optional: the model you used to execute this task (self-reported).' },
        provider: { type: 'string', description: 'Optional: the provider/vendor family you used (self-reported).' },
        reasoning: { type: 'string', description: 'Optional: your reasoning/thinking for this task, if you want it disclosed.' },
      },
    },
    outputSchema: TASK_RESULT_OUTPUT_SCHEMA,
    safety: { class: 'write', filesystem: 'write', network: 'none', process: 'none' },
  },
];

/**
 * @param {object} args   { run_id, task_id, output, model?, provider?, reasoning? }
 * @param {object} [opts]  { env, cwd } — defaulted so this behaves identically whether called
 *   directly (tests, CLI) or dispatched by the MCP server (which does not inject opts today,
 *   matching orchestration_run/orchestration_status's own convention).
 */
export async function orchestrationTaskResult(args = {}, { env = process.env, cwd = process.cwd() } = {}) {
  const { run_id, task_id, output, model, provider, reasoning } = args;
  if (!run_id || typeof run_id !== 'string') return { error: 'Missing "run_id" — the run id from orchestration_run.' };
  if (!task_id || typeof task_id !== 'string') return { error: 'Missing "task_id".' };

  try {
    const { run, nextTask } = await submitHostTaskResult(cwd, run_id, task_id, { output, model, provider, reasoning }, { env });
    const shaped = shapeRun(run);
    return {
      accepted: true,
      run_status: shaped.status,
      next_task: nextTask
        ? { task_id: nextTask.id, role: nextTask.role, system: nextTask.hostPrompt?.system ?? null, user: nextTask.hostPrompt?.user ?? null }
        : null,
    };
  } catch (err) {
    return { accepted: false, error: err.message, code: err.code || 'HOST_RESULT_REJECTED' };
  }
}

export const TOOL_HANDLERS = {
  orchestration_task_result: orchestrationTaskResult,
};
