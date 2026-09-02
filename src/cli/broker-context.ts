/**
 * cli/broker-context.ts — assemble everything a broker surface needs from a
 * bound project: registries, services, host capabilities, and identity.
 * This is the adapter edge: it reads env and cwd so the kernel need not.
 */

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
import { packageVersion } from './version.ts';

export interface BrokerBinding {
  readonly client: ClientId;
  readonly surface: 'interactive' | 'headless';
  readonly executorId: string;
  readonly actor: string;
}

/** What this session may do, described as capabilities rather than binaries. */
export function hostCapabilitiesFor(binding: BrokerBinding, sessionId: string | null): HostCapabilities {
  const available = new Set<string>(['read_project_files', 'read_project_context', 'write_project_context', 'run_validator', 'read_source:directory', 'run_tests']);
  if (binding.surface === 'interactive') {
    available.add('model_review');
    available.add('ask_user');
    available.add('write_project_files');
  }
  return {
    hostId: binding.client,
    sessionId,
    executorId: binding.executorId,
    available,
    maxTier: binding.surface === 'interactive' ? 'external_write' : 'project_write',
    restrictions: binding.surface === 'headless' ? ['no person is present: nothing that needs a decision proceeds'] : [],
    budgetCents: null,
  };
}

export function bindingFor(ctx: CliContext, flags: { readonly client?: string; readonly headless?: boolean; readonly executor?: string }): BrokerBinding {
  const client = normalizeClient(flags.client ?? detectAmbientHost(ctx.env)?.host);
  const surface = flags.headless ? 'headless' : 'interactive';
  const executorId = surface === 'headless' ? (flags.executor ?? 'runner') : `session:${client}`;
  return { client, surface, executorId, actor: surface === 'headless' ? executorId : `person via ${client}` };
}

export function createBrokerContext(ctx: CliContext, project: OpenProject, binding: BrokerBinding): BrokerContext {
  const skills = createSkillRegistry({ projectDir: project.layout.skillsDir });
  const workflows = createWorkflowRegistry({ projectDir: project.layout.workflowsDir });
  const lock = project.files.lock ?? emptyLock();
  const sessionId = binding.surface === 'interactive' ? `${binding.client}:${String(process.pid)}` : null;
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
  return { version: packageVersion(), root: project.root, layout: project.layout, files: project.files, store: project.store, skills, workflows, host, workflow, triggers, sources, now: ctx.now, nextId: ctx.nextId, actor: binding.actor };
}

export function openBroker(ctx: CliContext, flags: { readonly client?: string; readonly headless?: boolean; readonly executor?: string }): { readonly project: OpenProject; readonly binding: BrokerBinding; readonly broker: BrokerContext } {
  const project = openProject(ctx);
  const binding = bindingFor(ctx, flags);
  return { project, binding, broker: createBrokerContext(ctx, project, binding) };
}
