/**
 * kernel/broker/tools.ts — every tool Construct offers a host, declared once.
 *
 * Interactive tools serve the person's own session. Headless tools serve an
 * explicitly configured runner and are limited to pre-resolved steps,
 * leases, output, and status; nothing on that surface can change project
 * configuration, grant itself anything, resolve a decision, or finalize its
 * own output. Descriptions speak plainly; plumbing stays out of them.
 */

import { delegate } from './tools/delegate.ts';
import { type Tool } from './tools/shared.ts';
import { bootstrap } from './tools/bootstrap.ts';
import { classify } from './tools/classify-request.ts';
import { projectContext } from './tools/project-context.ts';
import { contextSearch } from './tools/context-search.ts';
import { contextIndex } from './tools/context-index.ts';
import { remember } from './tools/remember.ts';
import { workflows } from './tools/workflows.ts';
import { skills } from './tools/skills.ts';
import { startOutcome } from './tools/start-outcome.ts';
import { claimWork } from './tools/claim-work.ts';
import { submitWork } from './tools/submit-work.ts';
import { checkpointWork } from './tools/checkpoint-work.ts';
import { runStatus } from './tools/run-status.ts';
import { inbox } from './tools/inbox.ts';
import { decide } from './tools/decide.ts';
import { sources } from './tools/sources.ts';
import { checkAnswer } from './tools/check-answer.ts';
import { staff } from './tools/staff.ts';
import { promote } from './tools/promote-deliverable.ts';
import { work } from './tools/work.ts';
import { claimStep } from './tools/claim-step.ts';
import { heartbeat } from './tools/heartbeat.ts';

/** Every tool, in the order a host sees them. */
export const TOOLS: readonly Tool<unknown, unknown>[] = [
  bootstrap,
  classify,
  projectContext,
  contextSearch,
  contextIndex,
  remember,
  workflows,
  skills,
  startOutcome,
  claimWork,
  submitWork,
  checkpointWork,
  runStatus,
  inbox,
  decide,
  sources,
  checkAnswer,
  staff,
  promote,
  work,
  delegate,
  claimStep,
  heartbeat,
] as unknown as readonly Tool<unknown, unknown>[];

export function toolsFor(surface: 'interactive' | 'headless'): readonly Tool<unknown, unknown>[] {
  return TOOLS.filter((t) => t.surface === 'both' || t.surface === surface);
}

/** What the headless surface must never be able to do, by tool name. */
export const HEADLESS_FORBIDDEN: readonly string[] = [
  'remember',
  'start_outcome',
  'decide',
  'promote_deliverable',
  'sources',
  'workflows',
  'project_context',
  'context_search',
  'context_index',
  'staff',
  'claim_work',
  'classify_request',
  'work',
  'delegate',
];

export { projectResolver } from './tools/shared.ts';
export { PERSON_ASKED_ONLY } from './tools/shared.ts';
export { waitingOn } from './tools/shared.ts';
export { ownerFor } from './tools/shared.ts';
export { ANSWER_CHECKS } from './tools/check-answer.ts';
export { AGENT_NAME } from './tools/work.ts';
