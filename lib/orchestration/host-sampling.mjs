/**
 * lib/orchestration/host-sampling.mjs — Phase 2 of host-subscription execution:
 * construct-mcp drives the awaiting-host loop itself via MCP sampling
 * (`sampling/createMessage`), instead of leaving each materialized prompt for
 * the calling agent to execute and submit back through orchestration_task_result
 * (the Phase 1 pickup loop, lib/orchestration/runtime.mjs submitHostTaskResult).
 *
 * Both phases share the exact same materialization (worker.mjs
 * materializeTaskPrompt) and the exact same recording path
 * (submitHostTaskResult) — sampling only changes WHO executes each prompt: the
 * client's own model via the MCP sampling capability, called by this server,
 * rather than the calling agent's own reasoning turn. A sampling-executed
 * task is still host-reported (provenanceSource 'host-reported'), since the
 * client, not Construct, ran the model — Construct only relayed the call.
 *
 * Verified against the installed SDK (@modelcontextprotocol/sdk@1.29.0,
 * package.json declares ^1.12.0): Server#createMessage and
 * Server#getClientCapabilities both exist (node_modules/@modelcontextprotocol/
 * sdk/dist/esm/server/index.js) and are the accessors this module depends on.
 * If a future SDK removes or renames either, resolveHostExecutionMode still
 * degrades to 'pickup' (Phase 1) rather than a hard failure — sampling is
 * additive, pickup is the primary path by design (Claude Code's own sampling
 * support is unconfirmed at the time of writing; VS Code is the surface
 * expected to exercise this path).
 */

import { submitHostTaskResult } from './runtime.mjs';

// A specialist answer is a single turn, same ceiling the provider worker uses
// for a non-reasoning call (worker.mjs MAX_OUTPUT_TOKENS) — kept independent
// here since a client's sampling budget is negotiated per-request, not a
// process-wide constant shared with the provider path.

export const SAMPLING_MAX_TOKENS = 2048;

/**
 * Decide which loop drives an awaiting-host run's remaining tasks: the
 * client-driven MCP sampling loop, or the Phase 1 pickup loop (the calling
 * agent executes and submits manually). `auto` (the config default) prefers
 * sampling only when the connected client actually declared the capability at
 * initialize time; an explicit `sampling` request against a client that never
 * declared it still falls back to pickup rather than issuing a request the
 * client would reject.
 *
 * @param {object} opts
 * @param {object} [opts.config]              loaded project config (orchestration.hostExecution)
 * @param {object} [opts.clientCapabilities]   server.getClientCapabilities() result
 * @returns {'sampling'|'pickup'}
 */
export function resolveHostExecutionMode({ config, clientCapabilities } = {}) {
  const configured = config?.orchestration?.hostExecution || 'auto';
  const samplingDeclared = Boolean(clientCapabilities?.sampling);
  if (configured === 'pickup') return 'pickup';
  if (configured === 'sampling' || configured === 'auto') return samplingDeclared ? 'sampling' : 'pickup';
  return 'pickup';
}

function extractSamplingText(sampled) {
  const content = sampled?.content;
  if (Array.isArray(content)) {
    return content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('');
  }
  if (content?.type === 'text') return content.text || '';
  return '';
}

/**
 * Drive every `awaiting-host` task on a run through the client's MCP sampling
 * capability, recording each result through submitHostTaskResult (the same
 * path the Phase 1 pickup loop uses) so the run finalizes through the one
 * honest terminal-status computation regardless of which phase closed it out.
 *
 * A sampling call that throws (client rejects, network drop, malformed
 * response) stops the loop early rather than fabricating a result — the
 * remaining tasks stay `awaiting-host` exactly as Phase 1 leaves them, so the
 * run is still honestly resumable by a manual pickup loop or a later retry,
 * never silently marked done with invented output.
 *
 * @param {object} opts
 * @param {object} opts.server   the MCP Server instance (server.createMessage)
 * @param {object} opts.run      the awaiting-host run (or any run with awaiting-host tasks)
 * @param {string} opts.cwd
 * @param {Record<string,string>} [opts.env]
 * @returns {Promise<object>} the run after every reachable task was sampled and recorded
 */
export async function driveHostSamplingLoop({ server, run, cwd, env = process.env } = {}) {
  let latestRun = run;
  let task = (latestRun.tasks || []).find((t) => t.status === 'awaiting-host');

  while (task) {
    const { system = '', user = '' } = task.hostPrompt || {};
    let sampled;
    try {
      sampled = await server.createMessage({
        messages: [{ role: 'user', content: { type: 'text', text: user } }],
        systemPrompt: system,
        maxTokens: SAMPLING_MAX_TOKENS,
        modelPreferences: { intelligencePriority: 0.6, speedPriority: 0.4, costPriority: 0.4 },
      });
    } catch (err) {
      console.error(`[construct-mcp] sampling/createMessage failed for task ${task.id} on run ${latestRun.runId}: ${err.message}`);
      break;
    }

    const output = extractSamplingText(sampled);
    if (!output.trim()) {
      console.error(`[construct-mcp] sampling/createMessage returned empty content for task ${task.id} on run ${latestRun.runId}; leaving it awaiting-host.`);
      break;
    }

    const { run: updated, nextTask } = await submitHostTaskResult(
      cwd, latestRun.runId, task.id,
      { output, model: sampled.model || null, provider: 'mcp-sampling' },
      { env },
    );
    latestRun = updated;
    task = nextTask ? (updated.tasks || []).find((t) => t.id === nextTask.id) : null;
  }

  return latestRun;
}
