/**
 * cli/broker-context.ts — assemble everything a broker surface needs from a
 * bound project: registries, services, host capabilities, and identity.
 * This is the adapter edge: it reads env and cwd so the kernel need not.
 */

import { randomUUID } from 'node:crypto';
import { createSkillRegistry } from '../kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../kernel/registry/workflow-registry.ts';
import type { HostCapabilities } from '../kernel/registry/capability-registry.ts';
import { createWorkflowService } from '../kernel/workflow/service.ts';
import { createTriggerService } from '../kernel/workflow/triggers.ts';
import { createSourceService } from '../kernel/source/service.ts';
import { readDirectorySource } from '../hosts/sources/directory.ts';
import { emptyLock } from '../kernel/project/lock.ts';
import { explainConfig } from '../kernel/project/config.ts';
import type { BrokerContext } from '../kernel/broker/context.ts';
import { normalizeClient, type ClientId } from '../hosts/wiring/clients.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { configInputs, openProject, type CliContext, type OpenProject } from './context.ts';
import { UsageError } from './output.ts';
import { packageVersion } from './version.ts';

export interface BrokerBinding {
  readonly client: ClientId;
  readonly surface: 'interactive' | 'headless';
  /** The session id Construct minted for this process: the owner of its claims, leases, and grants. */
  readonly sessionId: string;
  readonly executorId: string;
  readonly actor: string;
}

/** What this session may do, described as capabilities rather than binaries. */
export function hostCapabilitiesFor(binding: BrokerBinding, sessionId: string | null): HostCapabilities {
  // A local Construct session always has the project checkout and the directory
  // reader. Interactivity adds a person. Neither invents an external writer.
  const declared = new Set<string>([
    'read_project_context',
    'write_project_context',
    'run_validator',
    'kernel',
    'read_project_files',
    'read_source:directory',
  ]);
  const permitted = new Set<string>(declared);
  if (binding.surface === 'interactive') {
    declared.add('ask_user');
    declared.add('model_review');
    permitted.add('ask_user');
    permitted.add('model_review');
    permitted.add('write_project_files');
    permitted.add('run_tests');
  }
  const unavailable = ['write_source', 'read_source (unscoped; directory reader is scoped)'];
  if (binding.surface === 'headless') unavailable.push('ask_user', 'model_review', 'write_project_files');
  return {
    hostId: binding.client,
    sessionId,
    executorId: binding.executorId,
    available: permitted,
    declared,
    reported: [],
    probed: [],
    permitted,
    unavailable,
    exercised: new Set(),
    maxTier: binding.surface === 'interactive' ? 'external_write' : 'project_write',
    restrictions: binding.surface === 'headless'
      ? ['no person is present: nothing that needs a decision proceeds']
      : ['write_source is not granted from interactivity alone; source reads are scoped to wired readers'],
    budgetCents: null,
  };
}

/** The prefix of an interactive session's executor id, which only `serve` itself mints. */
const SESSION_EXECUTOR_PREFIX = 'session:';

export function bindingFor(ctx: CliContext, flags: { readonly client?: string; readonly headless?: boolean; readonly executor?: string }): BrokerBinding {
  const client = normalizeClient(flags.client ?? detectAmbientHost(ctx.env)?.host);
  const surface = flags.headless ? 'headless' : 'interactive';
  // Grants name their executor. A runner that took a session's id would act
  // under the approvals the person gave that session.
  if (surface === 'headless' && flags.executor?.startsWith(SESSION_EXECUTOR_PREFIX)) {
    throw new UsageError(`--executor ${flags.executor} names an interactive session; a headless runner needs an id of its own (for example runner:nightly)`);
  }
  // Minted here, once per process, and never taken from anything a host or a
  // model supplies: a reused pid or a copied host id inherits nothing.
  const sessionId = `ses_${randomUUID()}`;
  const executorId = surface === 'headless' ? (flags.executor ?? `runner:${sessionId}`) : `${SESSION_EXECUTOR_PREFIX}${client}:${sessionId}`;
  // What a session does is the model's act on the person's behalf; only an
  // answer on a person channel is recorded as the person.
  return { client, surface, sessionId, executorId, actor: surface === 'headless' ? executorId : `model via ${client}` };
}

export function createBrokerContext(ctx: CliContext, project: OpenProject, binding: BrokerBinding): BrokerContext {
  const skills = createSkillRegistry({ projectDir: project.layout.skillsDir });
  const workflows = createWorkflowRegistry({ projectDir: project.layout.workflowsDir });
  const lock = project.files.lock ?? emptyLock();
  const sessionId = binding.surface === 'interactive' ? binding.executorId : null;
  const host = hostCapabilitiesFor(binding, sessionId);
  const sources = createSourceService(project.store, { readers: new Map([['directory', readDirectorySource]]) });
  const projectWritePolicy = explainConfig(configInputs(ctx, project, {}), 'policy.projectWrite').effective.value as 'managed' | 'never';
  const workflow = createWorkflowService({
    store: project.store,
    skills,
    workflows,
    lock,
    host,
    sources: () => sources.list().map((s) => {
      const st = sources.status(s.id, ctx.now());
      return { kind: s.kind, id: s.id, reachability: s.reachability, freshness: st.freshness };
    }),
    projectWritePolicy,
    now: ctx.now,
    nextId: ctx.nextId,
    targetSystemFor: (step) => step.sources[0]?.kind ?? (step.tier === 'project_write' ? 'project' : 'external'),
  });
  const triggers = createTriggerService({ store: project.store, workflows, workflowService: workflow, now: ctx.now, nextId: ctx.nextId, projectRoot: project.root });
  return { version: packageVersion(), root: project.root, lane: project.lane, sessionId: binding.sessionId, layout: project.layout, files: project.files, store: project.store, skills, workflows, host, workflow, triggers, sources, now: ctx.now, nextId: ctx.nextId, actor: binding.actor };
}

export function openBroker(ctx: CliContext, flags: { readonly client?: string; readonly headless?: boolean; readonly executor?: string }): { readonly project: OpenProject; readonly binding: BrokerBinding; readonly broker: BrokerContext } {
  const project = openProject(ctx);
  const binding = bindingFor(ctx, flags);
  return { project, binding, broker: createBrokerContext(ctx, project, binding) };
}
