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
