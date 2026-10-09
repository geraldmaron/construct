/**
 * tests/kernel/workflow/support.ts — a workflow service over a fixture
 * registry and a fresh store, with a deterministic clock and ids.
 */

import { join } from 'node:path';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { emptyLock } from '../../../src/kernel/project/lock.ts';
import type { HostCapabilities } from '../../../src/kernel/registry/capability-registry.ts';
import type { SkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import type { ActionTier } from '../../../src/kernel/state/steps.ts';
import { openStateStore, type StateStore } from '../../../src/kernel/state/open.ts';
import type { SourceAvailability } from '../../../src/kernel/registry/resolver.ts';
import { createWorkflowService, type WorkflowService } from '../../../src/kernel/workflow/service.ts';
import { createTriggerService, type TriggerService } from '../../../src/kernel/workflow/triggers.ts';
import { freshStore } from '../state/support.ts';
import { tmp, writeSkill, writeWorkflow, workflowManifest, step } from '../registry/support.ts';

/** Another session on the same project: its own connection to the store file, and its own service. */
export interface Peer {
  readonly store: StateStore;
  readonly service: WorkflowService;
  close(): void;
}

export interface Fixture {
  readonly store: ReturnType<typeof freshStore>['store'];
  readonly service: WorkflowService;
  readonly triggers: TriggerService;
  readonly host: HostCapabilities;
  sources: SourceAvailability[];
  /** Called whenever a service looks a skill up; a test sets it to act at that moment. */
  onSkillLookup: (() => void) | null;
  tick(ms?: number): void;
  /** The fixture clock's instant. */
  now(): string;
  /** Open another session on this store, with a lock wait and host of its own. */
  peer(opts?: { readonly busyTimeoutMs?: number; readonly host?: Partial<HostCapabilities> }): Peer;
  cleanup(): void;
}

export const T0 = '2026-09-02T12:00:00.000Z';

export function fixture(opts: { readonly interactive?: boolean; readonly projectWritePolicy?: 'managed' | 'never'; readonly maxTier?: ActionTier } = {}): Fixture {
  const fx = freshStore();
  const dirs = tmp();
  writeSkill(join(dirs.root, 'skills'), 'reader', '1.0.0');
  writeWorkflow(join(dirs.root, 'workflows'), 'review', workflowManifest('review', '1.0.0', [
    step('gather', { skill: { id: 'reader', range: '^1.0.0' }, capabilities: ['read_project_context'], outputs: ['notes'], validators: ['citations_present'], loadBearing: true, retry: { maxAttempts: 2, backoffMs: 0 } }),
    step('write', { needs: ['gather'], tier: 'draft', capabilities: ['model_review'], inputs: { notes: 'steps.gather.notes' }, outputs: ['summary', 'findings'], validators: ['schema', 'deliverable_complete'], loadBearing: true, challenge: true, retry: { maxAttempts: 2, backoffMs: 0 } }),
    step('record', { needs: ['write'], tier: 'project_write', capabilities: ['write_project_context'], inputs: { summary: 'steps.write.summary' }, outputs: ['recorded'], validators: ['schema'] }),
  ], { triggers: ['manual', 'schedule'], concurrency: 'single', dedupeKey: ['target'], deliverable: { kind: 'review', schema: 'review/v1', challenge: true } }));
  writeWorkflow(join(dirs.root, 'workflows'), 'apply', workflowManifest('apply', '1.0.0', [
    step('draft', { tier: 'draft', capabilities: ['model_review'], outputs: ['change'] }),
    step('push', { needs: ['draft'], tier: 'external_write', capabilities: ['write_source:jira'], sources: [{ kind: 'jira', freshness: 'any', required: true }], inputs: { change: 'steps.draft.change' }, outputs: ['applied'] }),
  ], { triggers: ['manual', 'event'], concurrency: 'per_input', cancellation: 'immediate', onNoData: 'block', dedupeKey: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'direct', workflowManifest('direct', '1.0.0', [
    step('push', { tier: 'external_write', capabilities: ['write_source:jira'], sources: [{ kind: 'jira', freshness: 'any', required: true }], outputs: ['applied'] }),
  ], { triggers: ['manual'], concurrency: 'per_input', onNoData: 'block', dedupeKey: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'fork', workflowManifest('fork', '1.0.0', [
    step('a', { tier: 'draft', capabilities: ['model_review'], outputs: ['change'] }),
    step('b', { needs: ['a'], tier: 'external_write', capabilities: ['write_source:jira'], sources: [{ kind: 'jira', freshness: 'any', required: true }], inputs: { change: 'steps.a.change' }, outputs: ['applied'] }),
    step('c', { tier: 'draft', skill: { id: 'reader', range: '^1.0.0' }, capabilities: ['read_project_context'], outputs: ['notes'] }),
  ], { triggers: ['manual'], concurrency: 'per_input', onNoData: 'block', dedupeKey: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'twin', workflowManifest('twin', '1.0.0', [
    step('left', { tier: 'external_write', capabilities: ['write_source:jira'], sources: [{ kind: 'jira', freshness: 'any', required: true }], outputs: ['applied'] }),
    step('right', { tier: 'draft', capabilities: ['model_review'], outputs: ['notes'] }),
  ], { triggers: ['manual'], concurrency: 'per_input', onNoData: 'block', dedupeKey: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'raze', workflowManifest('raze', '1.0.0', [
    step('drop', { tier: 'destructive', capabilities: ['write_source:jira'], sources: [{ kind: 'jira', freshness: 'any', required: true }], outputs: ['dropped'] }),
  ], { triggers: ['manual'], concurrency: 'per_input', onNoData: 'block', dedupeKey: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'sweep', workflowManifest('sweep', '1.0.0', [
    step('read', { capabilities: ['read_project_context'], sources: [{ kind: 'directory', freshness: 'fresh', required: true }], outputs: ['seen'] }),
  ], { triggers: ['schedule', 'manual'], onNoData: 'succeed_empty', onStaleData: 'block', concurrency: 'single', interactionClass: 'maintain', inputSchema: {}, requiredInputs: [] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'ship', workflowManifest('ship', '1.0.0', [
    step('do', { outputs: ['summary', 'findings'], validators: ['schema', 'deliverable_complete'] }),
  ], { concurrency: 'per_input', dedupeKey: ['request'], deliverable: { kind: 'outcome', schema: 'outcome/v1', challenge: false }, inputSchema: { request: 'string' }, requiredInputs: ['request'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'brief', workflowManifest('brief', '1.0.0', [
    step('write', { tier: 'draft', capabilities: ['model_review'], outputs: ['summary'] }),
  ], { concurrency: 'per_input', dedupeKey: ['target'], inputSchema: { target: 'string', scope: 'string' }, requiredInputs: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'tally', workflowManifest('tally', '1.0.0', [
    step('count', { capabilities: ['read_project_context'], sources: [{ kind: 'jira', freshness: 'any', required: true }], outputs: ['count'] }),
  ], { concurrency: 'per_input', onStaleData: 'block', inputSchema: {}, requiredInputs: [] }));
  // A digest of what changed over a period, from the sources it names: the kernel-typed inputs.
  writeWorkflow(join(dirs.root, 'workflows'), 'digest', workflowManifest('digest', '1.0.0', [
    step('gather', { capabilities: ['read_project_context'], inputs: { target: 'input.target', period: 'input.period', sources: 'input.sources' }, outputs: ['notes'], validators: ['citations_present', 'within_period'], loadBearing: true, retry: { maxAttempts: 2, backoffMs: 0 } }),
    step('write', { needs: ['gather'], tier: 'draft', capabilities: ['model_review'], inputs: { notes: 'steps.gather.notes', period: 'input.period' }, outputs: ['summary', 'findings'], validators: ['schema', 'deliverable_complete'], loadBearing: true }),
  ], { triggers: ['manual', 'schedule'], concurrency: 'per_input', interactionClass: 'manage', inputSchema: { target: 'string', period: 'period', sources: 'source_ids' }, requiredInputs: ['period'], dedupeKey: ['target', 'period', 'sources'], deliverable: { kind: 'digest', schema: 'digest/v1', challenge: false } }));
  // Read, then run a check the host reports: the verification an acceptance question names.
  writeWorkflow(join(dirs.root, 'workflows'), 'check', workflowManifest('check', '1.0.0', [
    step('gather', { capabilities: ['read_project_context'], outputs: ['notes'], validators: ['citations_present'], loadBearing: true, retry: { maxAttempts: 2, backoffMs: 0 } }),
    step('verify', { needs: ['gather'], capabilities: ['run_tests'], inputs: { notes: 'steps.gather.notes' }, outputs: ['verification'], validators: ['verification_result'] }),
  ], { concurrency: 'per_input', dedupeKey: ['target'], deliverable: { kind: 'outcome', schema: 'outcome/v1', challenge: false } }));
  const registry = createSkillRegistry({ builtinDir: join(dirs.root, 'skills'), projectDir: null });
  const skills: SkillRegistry = { ...registry, get: (id) => (self.onSkillLookup?.(), registry.get(id)) };
  const workflows = createWorkflowRegistry({ builtinDir: join(dirs.root, 'workflows'), projectDir: null });
  const lock = updateLock(emptyLock(), skills.list(), workflows.list()).lock;
  const host: HostCapabilities = {
    hostId: 'claude',
    sessionId: opts.interactive === false ? null : 'sess-1',
    executorId: opts.interactive === false ? 'runner:cron' : 'session:claude',
    available: new Set(['read_project_context', 'read_project_files', 'write_project_context', 'model_review', 'ask_user', 'write_source:jira', 'run_validator', 'run_tests']),
    maxTier: opts.maxTier ?? 'external_write',
    restrictions: [],
    budgetCents: null,
  };
  let t = Date.parse(T0);
  let n = 0;
  const now = () => new Date(t).toISOString();
  const nextId = (p: string) => `${p}-${String(++n).padStart(3, '0')}`;
  const sources: SourceAvailability[] = [
    { kind: 'jira', id: 'jira', reachability: 'reachable', freshness: 'no_expectation' },
    { kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh' },
  ];
  const serviceOn = (store: StateStore, on: HostCapabilities): WorkflowService =>
    createWorkflowService({ store, skills, workflows, lock, host: on, sources: () => self.sources, projectWritePolicy: opts.projectWritePolicy ?? 'managed', now, nextId, targetSystemFor: (s) => s.sources[0]?.kind ?? 'project' });
  const peers: StateStore[] = [];
  const self: Fixture = {
    store: fx.store,
    service: serviceOn(fx.store, host),
    triggers: null as unknown as TriggerService,
    host,
    sources,
    onSkillLookup: null,
    tick: (ms = 1000) => { t += ms; },
    now,
    peer: (peerOpts = {}) => {
      const store = openStateStore(fx.dbPath, { busyTimeoutMs: peerOpts.busyTimeoutMs });
      peers.push(store);
      return { store, service: serviceOn(store, { ...host, ...peerOpts.host }), close: () => store.close() };
    },
    cleanup: () => {
      for (const p of peers) {
        try {
          p.close();
        } catch {
          // closed by the test
        }
      }
      fx.cleanup();
      dirs.cleanup();
    },
  };
  (self as { triggers: TriggerService }).triggers = createTriggerService({ store: fx.store, workflows, workflowService: self.service, sources: () => self.sources, now, nextId, projectRoot: '/repo' });
  return self;
}
