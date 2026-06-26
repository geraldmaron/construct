/**
 * lib/mcp/tools/workflow.mjs — Workflow MCP tools: status, init, add/update tasks, validate, and import plan.
 *
 * All functions are synchronous. Wraps lib/workflow-state.mjs.
 * workflowStatus is located in project.mjs because it also builds publicHealth context.
 */
import { resolve } from 'node:path';
import {
  addTask,
  addTaskFromIntent,
  addTasksFromPlan,
  createNeedsMainInputPacket,
  initWorkflow,
  loadWorkflow,
  summarizeWorkflow,
  updateTask,
  validateWorkflowState,
} from '../../workflow-state.mjs';

export function workflowInit(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const title = args.title || 'Untitled workflow';
  const { workflow, created } = initWorkflow(cwd, title, args.spec_ref ?? null);
  return { cwd, created, workflow, summary: summarizeWorkflow(workflow) };
}

export function workflowAddTask(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  if (args.request) {
    const workflow = addTaskFromIntent(cwd, args.request, {
      key: args.key,
      title: args.title,
      phase: args.phase,
      owner: args.owner,
      files: args.files,
      readFirst: args.readFirst,
      doNotChange: args.doNotChange,
      acceptanceCriteria: args.acceptanceCriteria,
      verification: args.verification,
      overlays: args.overlays,
      challengeRequired: args.challengeRequired,
      challengeStatus: args.challengeStatus,
      tokenBudget: args.tokenBudget,
      status: args.status,
    });
    if (!workflow) return { ok: true, skipped: true, reason: 'immediate-track' };
    return { cwd, workflow, summary: summarizeWorkflow(workflow), source: 'intent' };
  }
  const workflow = addTask(cwd, {
    key: args.key,
    title: args.title,
    phase: args.phase,
    owner: args.owner,
    files: args.files,
    readFirst: args.readFirst,
    doNotChange: args.doNotChange,
    acceptanceCriteria: args.acceptanceCriteria,
    verification: args.verification,
    dependsOn: args.dependsOn,
    overlays: args.overlays,
    challengeRequired: args.challengeRequired,
    challengeStatus: args.challengeStatus,
  });
  return { cwd, workflow, summary: summarizeWorkflow(workflow), source: 'manual' };
}

export function workflowUpdateTask(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const workflow = updateTask(cwd, args.key, {
    status: args.status,
    owner: args.owner,
    phase: args.phase,
    note: args.note,
    verification: args.verification,
    overlays: args.overlays,
    challengeRequired: args.challengeRequired,
    challengeStatus: args.challengeStatus,
  });
  return { cwd, workflow, summary: summarizeWorkflow(workflow) };
}

export function workflowNeedsMainInput(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const packet = createNeedsMainInputPacket(args);
  const workflow = updateTask(cwd, args.taskKey, {
    status: 'blocked_needs_user',
    note: `${packet.worker}: ${packet.blocker} | question: ${packet.question}`,
  });
  return { cwd, packet, workflow, summary: summarizeWorkflow(workflow) };
}

export function workflowValidate(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const workflow = loadWorkflow(cwd);
  const result = validateWorkflowState(workflow);
  return { cwd, ...result };
}

/**
 * Validate a producer→consumer handoff against specialists/org.
 *
 * Args:
 *   producer    — agent or persona name producing the artifact
 *   consumer    — agent or persona name receiving it
 *   id          — optional contract id (overrides producer/consumer lookup)
 *   artifact    — the handoff payload to validate
 *   packet      — the producer's in-memory output packet. Required when the
 *                 producer has binary postconditions; omitting it is itself
 *                 a contract violation.
 *   enforcement — 'block' (default) or 'warn'; 'block' returns ok:false on
 *                 violation so the workflow can refuse to advance
 *
 * Returns { ok, status?, errors?, warnings?, contract } where status is set
 * to 'BLOCKED_CONTRACT' on enforced violations.
 */
export async function workflowContractValidate(args) {
  const { validateHandoff } = await import('../../contracts/validate.mjs');
  const { enrichConstructOrchestratorHandoff } = await import('../../contracts/construct-handoff.mjs');
  const contractId = args.id
    ?? (args.producer === 'construct' && args.consumer === 'cx-orchestrator' ? 'construct-to-orchestrator' : null);
  let artifact = args.artifact;
  if (contractId === 'construct-to-orchestrator' && artifact && typeof artifact === 'object') {
    artifact = enrichConstructOrchestratorHandoff(artifact, {
      request: args.request,
      fileCount: args.fileCount,
      moduleCount: args.moduleCount,
      introducesContract: args.introducesContract,
    });
  }
  return validateHandoff({
    producer: args.producer,
    consumer: args.consumer,
    id: args.id,
    artifact,
    packet: args.packet,
    enforcement: args.enforcement || 'block',
  });
}

export function workflowImportPlan(args) {
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();
  const markdown = args.markdown ?? '';
  const { workflow, count } = addTasksFromPlan(cwd, markdown, {
    phase: args.phase,
    owner: args.owner,
    readFirst: Array.isArray(args.readFirst) ? args.readFirst : undefined,
    doNotChange: Array.isArray(args.doNotChange) ? args.doNotChange : undefined,
    acceptanceCriteria: Array.isArray(args.acceptanceCriteria) ? args.acceptanceCriteria : undefined,
    workflowTitle: args.title,
    specRef: args.spec_ref,
  });
  return { cwd, count, workflow, summary: summarizeWorkflow(workflow) };
}
