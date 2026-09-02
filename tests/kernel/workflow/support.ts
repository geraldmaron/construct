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
import type { SourceAvailability } from '../../../src/kernel/registry/resolver.ts';
import { createWorkflowService, type WorkflowService } from '../../../src/kernel/workflow/service.ts';
import { createTriggerService, type TriggerService } from '../../../src/kernel/workflow/triggers.ts';
import { freshStore } from '../state/support.ts';
import { tmp, writeSkill, writeWorkflow, workflowManifest, step } from '../registry/support.ts';

export interface Fixture {
  readonly store: ReturnType<typeof freshStore>['store'];
  readonly service: WorkflowService;
  readonly triggers: TriggerService;
  readonly host: HostCapabilities;
  sources: SourceAvailability[];
  tick(ms?: number): void;
  cleanup(): void;
}

export const T0 = '2026-09-02T12:00:00.000Z';

export function fixture(opts: { readonly interactive?: boolean; readonly projectWritePolicy?: 'managed' | 'never' } = {}): Fixture {
  const fx = freshStore();
  const dirs = tmp();
  writeSkill(join(dirs.root, 'skills'), 'reader', '1.0.0');
  writeWorkflow(join(dirs.root, 'workflows'), 'review', workflowManifest('review', '1.0.0', [
    step('gather', { skill: { id: 'reader', range: '^1.0.0' }, capabilities: ['read_project_context'], outputs: ['notes'], validators: ['citations_present'], loadBearing: true, retry: { maxAttempts: 2, backoffMs: 0 } }),
    step('write', { needs: ['gather'], tier: 'draft', capabilities: ['model_review'], inputs: { notes: 'steps.gather.notes' }, outputs: ['summary', 'findings'], validators: ['schema', 'deliverable_complete'], loadBearing: true, challenge: true }),
    step('record', { needs: ['write'], tier: 'project_write', capabilities: ['write_project_context'], inputs: { summary: 'steps.write.summary' }, outputs: ['recorded'], validators: ['schema'] }),
  ], { triggers: ['manual', 'schedule'], concurrency: 'single', dedupeKey: ['target'], deliverable: { kind: 'review', schema: 'review/v1', challenge: true } }));
  writeWorkflow(join(dirs.root, 'workflows'), 'apply', workflowManifest('apply', '1.0.0', [
    step('draft', { tier: 'draft', capabilities: ['model_review'], outputs: ['change'] }),
    step('push', { needs: ['draft'], tier: 'external_write', capabilities: ['write_source:jira'], sources: [{ kind: 'jira', freshness: 'any', required: true }], inputs: { change: 'steps.draft.change' }, outputs: ['applied'] }),
  ], { triggers: ['manual', 'event'], concurrency: 'per_input', cancellation: 'immediate', onNoData: 'block', dedupeKey: ['target'] }));
  writeWorkflow(join(dirs.root, 'workflows'), 'sweep', workflowManifest('sweep', '1.0.0', [
    step('read', { capabilities: ['read_project_context'], sources: [{ kind: 'directory', freshness: 'fresh', required: true }], outputs: ['seen'] }),
  ], { triggers: ['schedule', 'manual'], onNoData: 'succeed_empty', onStaleData: 'block', concurrency: 'single', interactionClass: 'maintain', inputSchema: {}, requiredInputs: [] }));
  const skills = createSkillRegistry({ builtinDir: join(dirs.root, 'skills'), projectDir: null });
  const workflows = createWorkflowRegistry({ builtinDir: join(dirs.root, 'workflows'), projectDir: null });
  const lock = updateLock(emptyLock(), skills.list(), workflows.list()).lock;
  const host: HostCapabilities = {
    hostId: 'claude',
    sessionId: opts.interactive === false ? null : 'sess-1',
    executorId: opts.interactive === false ? 'runner:cron' : 'session:claude',
    available: new Set(['read_project_context', 'read_project_files', 'write_project_context', 'model_review', 'ask_user', 'write_source:jira', 'run_validator', 'run_tests']),
    maxTier: 'external_write',
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
  const self: Fixture = {
    store: fx.store,
    service: createWorkflowService({ store: fx.store, skills, workflows, lock, host, sources: () => self.sources, projectWritePolicy: opts.projectWritePolicy ?? 'managed', now, nextId, targetSystemFor: (s) => s.sources[0]?.kind ?? 'project' }),
    triggers: null as unknown as TriggerService,
    host,
    sources,
    tick: (ms = 1000) => { t += ms; },
    cleanup: () => { fx.cleanup(); dirs.cleanup(); },
  };
  (self as { triggers: TriggerService }).triggers = createTriggerService({ store: fx.store, workflows, workflowService: self.service, now, nextId, projectRoot: '/repo' });
  return self;
}
