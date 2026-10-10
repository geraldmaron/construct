/**
 * cli/broker-context.ts — assemble everything a broker surface needs from a
 * bound project: registries, services, host capabilities, and identity.
 * This is the adapter edge: it reads env and cwd so the kernel need not.
 */

import { pinSemanticReviewer } from '../hosts/semantic-review.ts';
import { runnerCapabilities } from '../hosts/executors.ts';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createDelegationService } from '../kernel/delegation/service.ts';
import { createDelegationDriver } from '../hosts/delegation/runtime.ts';
import { createSkillRegistry } from '../kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../kernel/registry/workflow-registry.ts';
import type { HostCapabilities } from '../kernel/registry/capability-registry.ts';
import { createWorkflowService } from '../kernel/workflow/service.ts';
import { createTriggerService } from '../kernel/workflow/triggers.ts';
import { projectResolver } from '../kernel/source/resolver.ts';
import { createSourceService } from '../kernel/source/service.ts';
import { hostReaders } from '../hosts/sources/readers.ts';
import { emptyLock } from '../kernel/project/lock.ts';
import { explainConfig } from '../kernel/project/config.ts';
import type { BrokerContext } from '../kernel/broker/context.ts';
import { normalizeClient, type ClientId } from '../hosts/wiring/clients.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { configInputs, openProject, projectWorktrees, type CliContext, type OpenProject } from './context.ts';
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
export function hostCapabilitiesFor(binding: BrokerBinding, sessionId: string | null, readerKinds: readonly string[] = ['directory']): HostCapabilities {
  // A local session always has the project checkout and the readers wired here. Interactivity adds a person and
  // the host's own tools for the systems the person already has open: what they read is recorded as evidence, and
  // every write to them is an external write that only the person approves, one action at a time.
  const declared = new Set<string>(['read_project_context', 'write_project_context', 'run_validator', 'kernel', 'read_project_files']);
  for (const kind of readerKinds) declared.add(`read_source:${kind}`);
  const permitted = new Set<string>(declared);
  if (binding.surface === 'interactive') {
    for (const c of ['ask_user', 'model_review', 'read_source', 'write_source', 'run_tests']) {
      declared.add(c);
      permitted.add(c);
    }
    permitted.add('write_project_files');
  }
  if (binding.surface === 'headless') for (const capability of runnerCapabilities(binding.executorId)) { declared.add(capability); permitted.add(capability); }
  const unavailable = binding.surface === 'headless' ? ['ask_user', 'model_review', 'write_project_files', 'read_source', 'write_source', 'run_tests'].filter((c) => !permitted.has(c)) : [];
  return {
    hostId: binding.client,
    sessionId,
    executorId: binding.executorId,
    available: new Set(permitted),
    declared,
    reported: [],
    probed: [],
    permitted,
    unavailable,
    exercised: new Set(),
    maxTier: binding.surface === 'interactive' ? 'external_write' : 'project_write',
    restrictions: binding.surface === 'headless'
      ? ['no person is present: nothing that needs a decision proceeds', runnerCapabilities(binding.executorId).length ? 'explicit host adapter declares local model, file and command capabilities; external connectors are not provisioned, and execution is verified separately' : 'no model or test executor is supplied by this broker; a clock firing alone does not perform model work']
      : ['host-mediated capabilities are declarations, not proof that a connector, test executable, or sandbox permission is available; discover and report actual access', 'writes to the person\'s systems go through the host\'s own tools and are external writes the person approves per action'],
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
  // runner:ses_… is what Construct mints for a runner given no id; taking one
  // would inherit the approvals given to that runner.
  if (surface === 'headless' && flags.executor?.startsWith('runner:ses_')) {
    throw new UsageError(`--executor ${flags.executor} is an id Construct mints for a runner started without one; choose a name of your own (for example runner:nightly)`);
  }
  // Minted here, once per process, and never taken from anything a host or a
  // model supplies: a reused pid or a copied host id inherits nothing.
  const sessionId = `ses_${randomUUID()}`;
  const executorId = surface === 'headless' ? (flags.executor ?? `runner:${sessionId}`) : `${SESSION_EXECUTOR_PREFIX}${client}:${sessionId}`;
  // What a session does is the model's act on the person's behalf; only an
  // answer on a person channel is recorded as the person.
  return { client, surface, sessionId, executorId, actor: surface === 'headless' ? executorId : `model via ${client}` };
}

/** Whether `pid` still runs, answerable only for this machine. */
export function processAlive(pid: number, machine: string): boolean | null {
  if (machine !== hostname()) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function createBrokerContext(ctx: CliContext, project: OpenProject, binding: BrokerBinding): BrokerContext {
  const skills = createSkillRegistry({ projectDir: project.layout.skillsDir });
  const workflows = createWorkflowRegistry({ projectDir: project.layout.workflowsDir });
  const lock = project.files.lock ?? emptyLock();
  const sessionId = binding.surface === 'interactive' ? binding.executorId : null;
  const readers = hostReaders(ctx.env);
  const host = hostCapabilitiesFor(binding, sessionId, [...readers.keys()]);
  const sources = createSourceService(project.store, { readers, root: project.root });
  const projectWritePolicy = explainConfig(configInputs(ctx, project, {}), 'policy.projectWrite').effective.value as 'managed' | 'never';
  const policy = {
    hostReads: explainConfig(configInputs(ctx, project, {}), 'policy.hostReads').effective.value as 'require' | 'accept',
    answerCheck: explainConfig(configInputs(ctx, project, {}), 'policy.answerCheck').effective.value as 'nudge' | 'off',
  };
  const available = () => sources.list().map((s) => {
    const st = sources.status(s.id, ctx.now());
    return { kind: s.kind, id: s.id, reachability: s.canRead ? s.reachability : 'unreachable' as const, freshness: st.freshness, lastReadAt: st.lastSnapshot?.takenAt ?? null };
  });
  const workflow = createWorkflowService({
    store: project.store,
    skills,
    workflows,
    lock,
    host,
    sources: available,
    projectWritePolicy,
    semanticReviewer: pinSemanticReviewer(binding.client, ctx.env, project.root),
    resolveEvidence: (ref) => projectResolver(project.store, project.root, null, { hostReads: policy.hostReads })(ref),
    now: ctx.now,
    nextId: ctx.nextId,
    targetSystemFor: (step) => step.sources[0]?.kind ?? (step.tier === 'project_write' ? 'project' : 'external'),
  });
  const triggers = createTriggerService({ store: project.store, workflows, workflowService: workflow, sources: available, now: ctx.now, nextId: ctx.nextId, projectRoot: project.root });
  const delegation = binding.surface === 'interactive' && projectWritePolicy !== 'never' ? createDelegationService({
    store: project.store, sessionId: binding.sessionId, target: project.lane?.root ?? project.root, now: ctx.now,
    driver: createDelegationDriver({ configDir: ctx.paths.configDir, artifactsDir: join(project.layout.stateDir, 'delegation'), env: ctx.env, machine: hostname(), processAlive }),
  }) : undefined;
  return { surface: binding.surface, version: packageVersion(), root: project.root, lane: project.lane, worktrees: () => projectWorktrees(project.root), sessionId: binding.sessionId, layout: project.layout, files: project.files, store: project.store, skills, workflows, host, workflow, triggers, sources, now: ctx.now, nextId: ctx.nextId, actor: binding.actor, processAlive, delegation, policy };
}

export function openBroker(ctx: CliContext, flags: { readonly client?: string; readonly headless?: boolean; readonly executor?: string }): { readonly project: OpenProject; readonly binding: BrokerBinding; readonly broker: BrokerContext } {
  if (ctx.env.CONSTRUCT_DELEGATED_WORKER) throw new UsageError('delegated workers receive only their supplied context, not another Construct surface');
  const project = openProject(ctx);
  const binding = bindingFor(ctx, flags);
  return { project, binding, broker: createBrokerContext(ctx, project, binding) };
}
