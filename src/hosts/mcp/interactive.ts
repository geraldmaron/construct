/**
 * hosts/mcp/interactive.ts — semantic interactive MCP over InteractiveRunService.
 *
 * Project-local state v1 path. No keyword routing, no host-pull flag, no
 * resource selection. The bound session is the executor unless an explicit
 * override is recorded on the tool call.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { StateStore } from '../../kernel/state-v1/open.ts';
import { openStateStore } from '../../kernel/state-v1/open.ts';
import { projectConfigPath, projectDbPath } from '../../kernel/project-v1/layout.ts';
import {
  createInteractiveRunService,
  type InteractiveRunService,
  type InteractiveSession,
} from '../../kernel/services/interactive-run.ts';
import { createDecisionService } from '../../kernel/services/decision.ts';
import { createStaffService } from '../../kernel/services/staff.ts';
import { createRoutineService } from '../../kernel/services/routine.ts';
import type { DecisionKind, DecisionSubject } from '../../kernel/state-v1/decisions.ts';
import { DECISION_KINDS } from '../../kernel/state-v1/decisions.ts';
import type { LeasedTask } from '../../kernel/state-v1/tasks.ts';
import { StaleLeaseError, listTasks, countTasksByState } from '../../kernel/state-v1/tasks.ts';
import { listActivity } from '../../kernel/state-v1/deliverables.ts';
import { getRun, listRunConcerns } from '../../kernel/state-v1/runs.ts';
import { STATE_FORMAT_ID, STATE_FORMAT_VERSION } from '../../kernel/state-v1/format.ts';
import { PROTOCOL_VERSION, response, failure, serveLines } from './jsonrpc.ts';
import type { JsonRpcRequest, JsonRpcResponse } from './jsonrpc.ts';

export const INTERACTIVE_LEASE_MS = 15 * 60 * 1000;

export interface InteractiveMcpCore {
  readonly store: StateStore;
  readonly session: InteractiveSession;
  readonly clock: () => string;
  readonly serverVersion: string;
  readonly projectRoot: string;
  readonly leaseMs?: number;
}

export const INTERACTIVE_TOOLS = [
  {
    name: 'project_status',
    description:
      'Project-local Construct status: format, client session, open decisions count, ' +
      'and whether this socket is the interactive control plane.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'start_run',
    description:
      'Start a run from the user\'s outcome text. Optional concerns are catalog ' +
      'domain ids with reasons - pass only what this outcome truly implicates. ' +
      'Empty concerns means none. Returns the run id.',
    inputSchema: {
      type: 'object',
      properties: {
        outcome: { type: 'string', description: 'What the user wants, in their words.' },
        concerns: {
          type: 'array',
          description: 'Optional implicated domains with reasons.',
          items: {
            type: 'object',
            properties: {
              domain: { type: 'string' },
              why: { type: 'string' },
            },
            required: ['domain', 'why'],
          },
        },
        tasks: {
          type: 'array',
          description: 'Optional tasks to enqueue with the run.',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              brief: {},
            },
            required: ['role'],
          },
        },
      },
      required: ['outcome'],
    },
  },
  {
    name: 'next_work',
    description:
      'Claim the next ready task for this interactive session. Returns claimed:false ' +
      'when the queue is empty. The lease is held server-side - submit_work needs only the task id.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Optional run id to claim within.' },
      },
    },
  },
  {
    name: 'submit_work',
    description:
      'Submit finished work for a task this session claimed via next_work. ' +
      'Task settles to done; the deliverable stays draft until later review. ' +
      'Pass deliverable and/or note.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task id from next_work.' },
        deliverable: { description: 'Finished work body.' },
        note: { type: 'string', description: 'Optional note; note-only leaves task leased unless settleNoteAsDone.' },
        settleNoteAsDone: { type: 'boolean' },
      },
      required: ['task'],
    },
  },
  {
    name: 'list_inbox',
    description:
      'Open decisions waiting on the user for this project. Show these; do not resolve them yourself.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'raise_decision',
    description:
      'Put a typed decision in the project inbox for the user. Kinds: requires_decision, ' +
      'requires_action_approval, requires_trust, requires_waiver, requires_revocation, ' +
      'requires_verdict, requires_consent, blocked.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: DECISION_KINDS.join(' | '),
        },
        question: { type: 'string', description: 'What the user must decide, in plain language.' },
        run: { type: 'string', description: 'Optional run id this decision belongs to.' },
        subject: {
          type: 'object',
          description:
            'Optional subject for working resolve paths (taskId, challengeId, workspace, …).',
        },
      },
      required: ['kind', 'question'],
    },
  },
  {
    name: 'decide',
    description:
      "Record the user's resolution of an inbox decision, in the user's own words. " +
      'Only relay a call the user explicitly made.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Decision id from list_inbox.' },
        resolution: { type: 'string', description: "The user's call, in the user's words." },
      },
      required: ['id', 'resolution'],
    },
  },
  {
    name: 'run_status',
    description:
      'Where a run\'s tasks stand: counts by state and the task list. Omit run for the whole project queue.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Optional run id to scope the read.' },
      },
    },
  },
  {
    name: 'recent_activity',
    description:
      'Recent project activity events (run starts, claims, submits, decisions). Newest last.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string', description: 'Optional run id to scope the read.' },
        limit: { type: 'number', description: 'Max events (default 50, max 200).' },
      },
    },
  },
  {
    name: 'list_staff',
    description:
      'StaffMembers for this project. Identity and mission only — never an executor pin.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_routines',
    description:
      'Routines for this project (enabled flag, trigger, expected output, last run).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_routine',
    description:
      'Start one headless run from a Routine. Requires executionPolicy.pin on the routine.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Routine id.' },
      },
      required: ['id'],
    },
  },
] as const;

function toolText(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * True when this project root has been initialized for format-v1 state.
 */
export function projectHasV1State(projectRoot: string): boolean {
  return existsSync(projectConfigPath(projectRoot)) && existsSync(projectDbPath(projectRoot));
}

export function openInteractiveProject(projectRoot: string): StateStore {
  return openStateStore(projectDbPath(projectRoot));
}

export function sessionFromBinding(input: {
  readonly client: string;
  readonly projectRoot: string;
  readonly host?: string;
  readonly executorOverride?: string;
}): InteractiveSession {
  return {
    client: input.client,
    host: input.host ?? input.client,
    owner: `session:${input.client}`,
    executorOverride: input.executorOverride,
    overrideSource: input.executorOverride ? 'explicit-user-request' : undefined,
  };
}

export function createInteractiveHandler(core: InteractiveMcpCore) {
  const runs: InteractiveRunService = createInteractiveRunService(core.store, core.session);
  const decisions = createDecisionService(core.store);
  const staff = createStaffService(core.store);
  const routines = createRoutineService(core.store);
  const leases = new Map<string, LeasedTask>();
  const leaseMs = core.leaseMs ?? INTERACTIVE_LEASE_MS;

  async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'project_status': {
        const open = decisions.inbox();
        return {
          interactive: true,
          client: core.session.client,
          host: core.session.host,
          executor: runs.effectiveExecutor(),
          projectRoot: core.projectRoot,
          state: {
            format: STATE_FORMAT_ID,
            formatVersion: STATE_FORMAT_VERSION,
            path: core.store.path,
          },
          openDecisions: open.length,
          serverVersion: core.serverVersion,
        };
      }
      case 'start_run': {
        const outcome = typeof args.outcome === 'string' ? args.outcome.trim() : '';
        if (!outcome) throw new RangeError('start_run requires a non-empty outcome');
        const at = core.clock();
        const id = `run-${at.replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
        const concernsRaw = Array.isArray(args.concerns) ? args.concerns : [];
        const concerns = concernsRaw
          .map((c) => {
            if (!c || typeof c !== 'object') return null;
            const row = c as { domain?: unknown; why?: unknown };
            if (typeof row.domain !== 'string' || typeof row.why !== 'string') return null;
            const domain = row.domain.trim();
            const why = row.why.trim();
            if (!domain || !why) return null;
            return { domain, why };
          })
          .filter((c): c is { domain: string; why: string } => c !== null);
        const tasksRaw = Array.isArray(args.tasks) ? args.tasks : [];
        const tasks = tasksRaw.map((t, i) => {
          const row = t as { role?: unknown; brief?: unknown };
          if (typeof row.role !== 'string' || !row.role.trim()) {
            throw new RangeError(`start_run tasks[${i}] requires a non-empty role`);
          }
          return {
            id: `task-${id}-${i + 1}`,
            role: row.role.trim(),
            brief: row.brief ?? { outcome },
          };
        });
        const run = runs.startRun({
          id,
          outcome,
          at,
          concerns,
          tasks,
        });
        return {
          run: run.id,
          outcome: run.outcome,
          tasksQueued: tasks.length,
          concerns: concerns.map((c) => c.domain),
          executor: runs.effectiveExecutor(),
        };
      }
      case 'next_work': {
        const now = core.clock();
        const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString();
        const runId = typeof args.run === 'string' && args.run.trim() ? args.run.trim() : undefined;
        const leased = runs.nextWork({ now, leaseUntil, runId });
        if (!leased) return { claimed: false };
        leases.set(leased.id, leased);
        return {
          claimed: true,
          task: leased.id,
          run: leased.runId,
          role: leased.role,
          brief: leased.brief,
          leaseUntil: leased.leaseUntil,
        };
      }
      case 'submit_work': {
        const taskId = typeof args.task === 'string' ? args.task.trim() : '';
        if (!taskId) throw new RangeError('submit_work requires task');
        const leased = leases.get(taskId);
        if (!leased) {
          throw new RangeError(
            `submit_work: no live claim for task ${taskId} on this connection — call next_work first`,
          );
        }
        const hasDeliverable = 'deliverable' in args;
        const note = typeof args.note === 'string' ? args.note : undefined;
        if (!hasDeliverable && (note === undefined || note.trim() === '')) {
          throw new RangeError('submit_work requires deliverable or a non-empty note');
        }
        try {
          const result = runs.submitWork({
            leased,
            at: core.clock(),
            ...(hasDeliverable ? { deliverable: args.deliverable } : {}),
            ...(note !== undefined ? { note } : {}),
            ...(args.settleNoteAsDone === true ? { settleNoteAsDone: true } : {}),
          });
          if (!result.noteOnly) leases.delete(taskId);
          return {
            ok: true,
            task: result.task.id,
            taskState: result.task.state,
            noteOnly: result.noteOnly,
            deliverable: result.deliverable
              ? { id: result.deliverable.id, trustState: result.deliverable.trustState }
              : null,
          };
        } catch (err) {
          if (err instanceof StaleLeaseError) {
            leases.delete(taskId);
            throw new RangeError(`submit_work: stale lease for ${taskId}`);
          }
          throw err;
        }
      }
      case 'list_inbox': {
        return {
          decisions: decisions.inbox().map((d) => ({
            id: d.id,
            kind: d.kind,
            question: d.question,
            subject: d.subject,
            run: d.runId,
            raisedAt: d.raisedAt,
          })),
        };
      }
      case 'raise_decision': {
        const kindRaw = typeof args.kind === 'string' ? args.kind.trim() : '';
        const kinds = new Set<string>(DECISION_KINDS);
        if (!kinds.has(kindRaw)) {
          throw new RangeError(
            `raise_decision kind must be ${DECISION_KINDS.join(' | ')}`,
          );
        }
        const question = typeof args.question === 'string' ? args.question.trim() : '';
        if (!question) throw new RangeError('raise_decision requires a non-empty question');
        const at = core.clock();
        const id = `dec-${at.replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
        const runId = typeof args.run === 'string' && args.run.trim() ? args.run.trim() : undefined;
        let subject: DecisionSubject | undefined;
        if (args.subject !== null && typeof args.subject === 'object' && !Array.isArray(args.subject)) {
          subject = args.subject as DecisionSubject;
        }
        const raised = decisions.raise({
          id,
          kind: kindRaw as DecisionKind,
          question,
          at,
          ...(runId ? { runId } : {}),
          ...(subject ? { subject } : {}),
        });
        return {
          id: raised.id,
          kind: raised.kind,
          question: raised.question,
          subject: raised.subject,
          run: raised.runId,
          state: raised.state,
        };
      }
      case 'decide': {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) throw new RangeError('decide requires id');
        const resolutionRaw = args.resolution;
        let resolution: unknown = resolutionRaw;
        if (typeof resolutionRaw === 'string') {
          const trimmed = resolutionRaw.trim();
          if (!trimmed) throw new RangeError('decide requires a non-empty resolution');
          try {
            resolution = JSON.parse(trimmed) as unknown;
          } catch {
            resolution = trimmed;
          }
        } else if (resolutionRaw === undefined || resolutionRaw === null) {
          throw new RangeError('decide requires a non-empty resolution');
        }
        const resolved = decisions.resolve({
          id,
          resolution,
          resolvedBy: `session:${core.session.client}`,
          at: core.clock(),
        });
        return {
          decided: resolved.id,
          kind: resolved.kind,
          resolution: resolved.resolution,
          state: resolved.state,
          resolvedBy: resolved.resolvedBy,
        };
      }
      case 'run_status': {
        const runId = typeof args.run === 'string' && args.run.trim() ? args.run.trim() : undefined;
        const run = runId ? getRun(core.store, runId) : null;
        if (runId && !run) throw new RangeError(`no run "${runId}"`);
        const tasks = listTasks(core.store, runId);
        return {
          ...(run
            ? {
                run: {
                  id: run.id,
                  outcome: run.outcome,
                  status: run.status,
                  concerns: listRunConcerns(core.store, run.id),
                },
              }
            : {}),
          counts: countTasksByState(core.store, runId),
          tasks: tasks.map((t) => ({
            id: t.id,
            run: t.runId,
            role: t.role,
            state: t.state,
            ...(t.leaseUntil ? { leaseUntil: t.leaseUntil } : {}),
          })),
        };
      }
      case 'recent_activity': {
        const runId = typeof args.run === 'string' && args.run.trim() ? args.run.trim() : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.floor(args.limit)
            : undefined;
        return {
          events: listActivity(core.store, { runId, limit }).map((e) => ({
            id: e.id,
            at: e.at,
            kind: e.kind,
            run: e.runId,
            task: e.taskId,
            payload: e.payload,
          })),
        };
      }
      case 'list_staff': {
        return {
          staff: staff.list().map((m) => ({
            id: m.id,
            name: m.name,
            title: m.title,
            mission: m.mission,
            status: m.status,
            concerns: m.concerns,
          })),
        };
      }
      case 'list_routines': {
        return {
          routines: routines.list().map((r) => ({
            id: r.id,
            enabled: r.enabled,
            triggerKind: r.triggerKind,
            expectedOutput: r.expectedOutput,
            lastRunAt: r.lastRunAt,
            executionPolicy: r.executionPolicy,
          })),
        };
      }
      case 'run_routine': {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) throw new RangeError('run_routine requires id');
        const result = routines.runOnce(id, core.clock());
        return {
          routine: result.routine.id,
          run: result.run.id,
          executorPin: result.executorPin,
          outcome: result.routine.expectedOutput,
        };
      }
      default:
        throw new RangeError(`unknown tool: ${name}`);
    }
  }

  return async (message: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize':
        return response(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: {
            name: 'construct-interactive',
            version: core.serverVersion,
            session: {
              interactive: true,
              client: core.session.client,
              host: core.session.host,
              projectRoot: core.projectRoot,
            },
          },
        });
      case 'notifications/initialized':
        return null;
      case 'tools/list':
        return response(id, { tools: [...INTERACTIVE_TOOLS] });
      case 'tools/call': {
        const p =
          params && typeof params === 'object' && !Array.isArray(params)
            ? (params as { name?: unknown; arguments?: unknown })
            : {};
        const name = typeof p.name === 'string' ? p.name : '';
        const args =
          p.arguments && typeof p.arguments === 'object' && !Array.isArray(p.arguments)
            ? (p.arguments as Record<string, unknown>)
            : {};
        try {
          const result = await callTool(name, args);
          return response(id, toolText(result));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return failure(id, -32602, msg);
        }
      }
      default:
        if (isNotification) return null;
        return failure(id, -32601, `method not found: ${method}`);
    }
  };
}

export async function serveInteractive(
  core: InteractiveMcpCore,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  const handle = createInteractiveHandler(core);
  const pending = new Set<Promise<void>>();
  const syncAdapter = (message: JsonRpcRequest) => {
    const settled = handle(message).then((reply) => {
      if (reply) stdout.write(`${JSON.stringify(reply)}\n`);
    });
    pending.add(settled);
    void settled.finally(() => pending.delete(settled));
    return null;
  };
  await serveLines(syncAdapter, stdin, stdout);
  await Promise.all([...pending]);
}
