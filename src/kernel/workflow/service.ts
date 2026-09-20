/**
 * kernel/workflow/service.ts — one service runs a workflow from binding to
 * handback.
 *
 * It binds to the project and the host, classifies the ask, resolves the
 * workflow through the registry, creates one idempotent run, leases ready
 * steps to whoever executes them (this session, or a pinned headless
 * runner), gates every step through the policy engine, records outputs,
 * evidence, attempts, and audit events transactionally, pauses for decisions,
 * resumes without repeating finished work, validates load-bearing outputs,
 * and promotes the deliverable only through the kernel's own transitions.
 * Nothing here can enqueue a step the registry did not resolve.
 */

import { createHash } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import { appendActivity, listActivity } from '../state/activity.ts';
import { createRun, findActiveByWorkIdentity, getRun, getRunByKey, listActiveRuns, setCancelRequested, transitionRun, type WorkflowRun } from '../state/runs.ts';
import { addStep, claimStep, completeStep, expireDeadLeases, failStep, getStep, listSteps, transitionStep, type LeasedStep, type StepRun } from '../state/steps.ts';
import { getDeliverable, listDeliverables, setTrustState, upsertDraft, type Deliverable, type TrustState } from '../state/deliverables.ts';
import { getDecision, listOpenDecisions, raiseDecision, resolveDecision, withdrawDecision, type Decision } from '../state/decisions.ts';
import { addStatement, getProfile, getStatement, type Statement, type StatementKind } from '../state/profile.ts';
import { addClaim, getEntity, listRelations } from '../state/graph.ts';
import { bindGoverningStatement, isGoverningKind, supersedeGoverning } from '../state/admission.ts';
import { approveAction, evaluateAction, type ActionRequest, type PolicyContext } from '../policy/engine.ts';
import type { HostCapabilities } from '../registry/capability-registry.ts';
import { readySteps } from '../registry/dependency-graph.ts';
import type { RegisteredWorkflow, WorkflowStep } from '../registry/models.ts';
import { resolveWorkflow, type Resolution, type SourceAvailability } from '../registry/resolver.ts';
import type { SkillRegistry } from '../registry/skill-registry.ts';
import type { WorkflowRegistry } from '../registry/workflow-registry.ts';
import type { RegistryLock } from '../project/lock.ts';
import { classifyInteraction, type Classification } from './classify.ts';
import { assessConsequence, judgmentRequired, type ConsequenceSignals, type Judgment } from './consequence.ts';
import { detectDrift, recordDrift } from '../drift/detect.ts';
import { runValidators, type ValidatorResult } from './validators.ts';
import { createRouter } from '../skills/routing.ts';

function activeContradictionCount(store: StateStore): number {
  return listRelations(store, { kind: 'contradicts' }).filter((r) => {
    if (r.status === 'retired') return false;
    const target = getEntity(store, r.toId);
    return !!target && (target.kind === 'decision' || target.kind === 'requirement') && target.status === 'active';
  }).length;
}

export interface WorkflowServiceDeps {
  readonly store: StateStore;
  readonly skills: SkillRegistry;
  readonly workflows: WorkflowRegistry;
  readonly lock: RegistryLock;
  readonly host: HostCapabilities;
  readonly sources: () => readonly SourceAvailability[];
  readonly projectWritePolicy: 'managed' | 'never';
  readonly now: () => string;
  readonly nextId: (prefix: string) => string;
  readonly targetSystemFor?: (step: WorkflowStep) => string;
  readonly defaultLeaseMs?: number;
}

export interface StartInput {
  readonly workflowId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly trigger: 'manual' | 'schedule' | 'event';
  /** Overrides the derived key; a scheduler passes its firing key. */
  readonly idempotencyKey?: string;
  readonly executorId?: string;
  readonly executorKind?: 'interactive' | 'headless';
}

export interface StartResult {
  readonly run: WorkflowRun;
  readonly created: boolean;
  readonly resolution: Resolution;
  readonly preflight: Preflight;
}

export interface Preflight {
  readonly status: Resolution['status'];
  readonly summary: string;
  readonly approvalsAhead: readonly string[];
  readonly reasons: readonly { readonly code: string; readonly stepId: string | null; readonly message: string; readonly remedy: string }[];
  readonly flags: readonly string[];
  readonly judgment: Judgment;
}

export interface WorkPacket {
  readonly leased: LeasedStep;
  readonly run: WorkflowRun;
  readonly step: WorkflowStep;
  readonly skill: { readonly id: string; readonly version: string; readonly digest: string; readonly body: () => string | null; readonly file: (relativePath: string) => Uint8Array | null } | null;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly instructions: readonly string[];
  readonly judgment: Judgment;
}

export interface ClaimOutcome {
  readonly packet: WorkPacket | null;
  /** Why nothing was handed out: a decision is open, the run is finished, or nothing is ready. */
  readonly waitingOn: { readonly kind: 'decision'; readonly decision: Decision } | { readonly kind: 'finished'; readonly state: WorkflowRun['state'] } | { readonly kind: 'nothing_ready' } | { readonly kind: 're_resolve'; readonly reason: string } | null;
}

export interface SubmitInput {
  readonly leased: LeasedStep;
  readonly output: Readonly<Record<string, unknown>>;
  readonly evidence?: readonly { readonly ref: string; readonly excerpt?: string }[];
  readonly noData?: boolean;
  readonly resolvableRefs?: ReadonlySet<string>;
}

export interface SubmitResult {
  readonly step: StepRun;
  readonly validation: readonly ValidatorResult[];
  readonly run: WorkflowRun;
  readonly deliverable: Deliverable | null;
}

export interface RunView {
  readonly run: WorkflowRun;
  readonly steps: readonly StepRun[];
  readonly deliverables: readonly Deliverable[];
  readonly openDecisions: readonly Decision[];
  readonly activity: number;
}

export interface WorkflowService {
  classify(text: string): Classification;
  remember(input: {
    readonly kind: StatementKind;
    readonly text: string;
    readonly by: string;
    readonly assumptions?: readonly string[];
    readonly replaces?: string;
  }): Statement;
  preflight(workflowId: string, input: Readonly<Record<string, unknown>>): { readonly resolution: Resolution; readonly preflight: Preflight };
  start(input: StartInput): StartResult;
  claimNext(input: { readonly runId?: string; readonly owner?: string; readonly leaseMs?: number }): ClaimOutcome;
  submit(input: SubmitInput): SubmitResult;
  fail(input: { readonly leased: LeasedStep; readonly error: unknown; readonly reason: string }): StepRun;
  decide(input: { readonly decisionId: string; readonly resolution: unknown; readonly by: string }): { readonly decision: Decision; readonly run: WorkflowRun | null };
  cancel(input: { readonly runId: string; readonly by: string; readonly reason: string }): WorkflowRun;
  resume(runId: string): WorkflowRun;
  status(runId: string): RunView | null;
  /** Trust promotions a person or a challenge performs; steps never do. */
  promote(input: { readonly deliverableId: string; readonly to: TrustState; readonly by: string; readonly verification?: unknown; readonly reason?: string }): Deliverable;
}

function idempotencyKeyFor(workflow: RegisteredWorkflow, input: Readonly<Record<string, unknown>>, trigger: string): string {
  const m = workflow.manifest;
  const keys = m.dedupeKey.length ? m.dedupeKey : Object.keys(m.inputSchema);
  const material = keys.map((k) => `${k}=${JSON.stringify(input[k] ?? null)}`).join('&');
  const hash = createHash('sha256').update(`${m.id}@${m.version}|${trigger}|${material}`).digest('hex').slice(0, 24);
  return `${m.id}:${hash}`;
}

export function createWorkflowService(deps: WorkflowServiceDeps): WorkflowService {
  const { store } = deps;
  const leaseMs = deps.defaultLeaseMs ?? 30 * 60_000;
  const policyContext = (interactionClass: PolicyContext['interactionClass'], at: string): PolicyContext => ({
    at,
    interactionClass,
    projectWritePolicy: deps.projectWritePolicy,
    explicitRememberRequest: interactionClass === 'remember',
  });

  function resolutionFor(workflowId: string, input: Readonly<Record<string, unknown>>, executorId: string): Resolution {
    return resolveWorkflow({
      workflowId,
      input,
      skills: deps.skills,
      workflows: deps.workflows,
      lock: deps.lock,
      host: { ...deps.host, executorId },
      sources: deps.sources(),
      store,
      at: deps.now(),
      targetSystemFor: deps.targetSystemFor,
    });
  }

  function likelySkillsFor(input: Readonly<Record<string, unknown>>): string[] {
    const text = [input.request, input.target, input.scope, input.purpose, input.text]
      .filter((x): x is string => typeof x === 'string')
      .join(' ');
    if (!text.trim()) return [];
    const router = createRouter(
      deps.skills.list().map((s) => ({
        id: s.manifest.id,
        description: s.description,
        activation: s.manifest.activation,
        standDown: s.manifest.standDown,
        examples: s.examples,
      })),
    );
    return router.route(text).filter((r) => r.band === 'likely').map((r) => r.id);
  }

  function judgmentFor(input: Readonly<Record<string, unknown>>, extra: ConsequenceSignals = {}): Judgment {
    return assessConsequence(input, getProfile(store)?.scale ?? null, {
      likelySkills: extra.likelySkills ?? likelySkillsFor(input),
      workflowChallenge: extra.workflowChallenge,
      stepTiers: extra.stepTiers,
      activeContradictions: extra.activeContradictions ?? activeContradictionCount(store),
    });
  }

  function judgmentOf(run: WorkflowRun): Judgment {
    const p = run.preflight as Preflight | null;
    if (p?.judgment) return p.judgment;
    return judgmentFor((run.input ?? {}) as Record<string, unknown>);
  }

  function preflightOf(resolution: Resolution, input: Readonly<Record<string, unknown>> = {}): Preflight {
    const flags: string[] = [];
    if (resolution.workflow?.manifest.onStaleData === 'proceed_flagged') {
      const stale = deps.sources().filter((s) => s.freshness === 'stale');
      if (stale.length) flags.push(`proceeding with stale sources: ${stale.map((s) => s.id).join(', ')}`);
    }
    const judgment = judgmentFor(input, {
      workflowChallenge: resolution.workflow?.manifest.deliverable.challenge ?? false,
      stepTiers: resolution.plan.map((p) => p.step.tier),
    });
    if (judgment.challenge) flags.push(`challenge required: ${judgment.why}`);
    return {
      status: resolution.status,
      summary: resolution.summary,
      approvalsAhead: resolution.plan.filter((p) => p.needsApproval).map((p) => p.step.id),
      reasons: resolution.reasons.map((r) => ({ code: r.code, stepId: r.stepId, message: r.message, remedy: r.remedy })),
      flags,
      judgment,
    };
  }

  function stepsOf(run: WorkflowRun): readonly WorkflowStep[] {
    const frozen = run.bindings as { steps?: readonly WorkflowStep[] } | null;
    if (frozen && Array.isArray(frozen.steps) && frozen.steps.length > 0) return frozen.steps;
    return deps.workflows.get(run.workflowId)?.manifest.steps ?? [];
  }

  /** Mark every pending step whose needs are done as ready, and settle the run when everything is terminal. */
  function advance(runId: string, at: string): WorkflowRun {
    return store.transaction(() => {
      const run = getRun(store, runId)!;
      if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
      if (run.cancelRequested) {
        const stepRuns = listSteps(store, runId);
        const leased = stepRuns.filter((s) => s.state === 'leased');
        for (const s of stepRuns) {
          if (s.state === 'pending' || s.state === 'ready' || s.state === 'waiting_for_decision') {
            transitionStep(store, { id: s.id, to: 'cancelled', at, reason: run.stateReason ?? 'cancelled' });
          }
        }
        if (leased.length === 0) {
          return transitionRun(store, { id: runId, to: 'cancelled', at, reason: run.stateReason ?? 'cancelled' });
        }
        return run;
      }
      const manifestSteps = stepsOf(run);
      const stepRuns = listSteps(store, runId);
      const done = new Set(stepRuns.filter((s) => s.state === 'succeeded' || s.state === 'skipped').map((s) => s.stepId));
      for (const ready of readySteps(manifestSteps, done)) {
        const sr = stepRuns.find((s) => s.stepId === ready.id);
        if (sr && sr.state === 'pending') transitionStep(store, { id: sr.id, to: 'ready', at });
      }
      const after = listSteps(store, runId);
      const failed = after.find((s) => s.state === 'failed');
      if (failed) {
        for (const s of after) if (s.state === 'pending' || s.state === 'ready') transitionStep(store, { id: s.id, to: 'cancelled', at, reason: `step ${failed.stepId} failed` });
        return transitionRun(store, { id: runId, to: 'failed', at, reason: `step ${failed.stepId} failed: ${failed.stateReason ?? 'no reason recorded'}` });
      }
      const cancelled = after.find((s) => s.state === 'cancelled');
      if (cancelled && after.every((s) => ['succeeded', 'skipped', 'cancelled', 'failed'].includes(s.state))) {
        return transitionRun(store, { id: runId, to: 'cancelled', at, reason: cancelled.stateReason ?? `step ${cancelled.stepId} cancelled` });
      }
      if (after.every((s) => s.state === 'succeeded' || s.state === 'skipped')) {
        return transitionRun(store, { id: runId, to: 'succeeded', at });
      }
      if (run.state === 'ready' && after.some((s) => s.state === 'leased')) return transitionRun(store, { id: runId, to: 'running', at });
      return getRun(store, runId)!;
    });
  }

  function inputsFor(run: WorkflowRun, step: WorkflowStep): Record<string, unknown> {
    const runInput = (run.input ?? {}) as Record<string, unknown>;
    const stepRuns = listSteps(store, run.id);
    const out: Record<string, unknown> = {};
    for (const [key, ref] of Object.entries(step.inputs)) {
      if (ref.startsWith('input.')) {
        out[key] = runInput[ref.slice('input.'.length)];
      } else {
        const [, upstreamId, output] = ref.split('.') as [string, string, string];
        const upstream = stepRuns.find((s) => s.stepId === upstreamId);
        out[key] = upstream && upstream.output && typeof upstream.output === 'object' ? (upstream.output as Record<string, unknown>)[output] : undefined;
      }
    }
    const answers = runInput.answers;
    if (answers && typeof answers === 'object') out.answers = answers;
    return out;
  }

  function gateStep(run: WorkflowRun, stepRun: StepRun, step: WorkflowStep, at: string): Decision | null {
    if (step.tier === 'observe' || step.tier === 'draft') return null;
    const request: ActionRequest = {
      tier: step.tier,
      targetSystem: deps.targetSystemFor ? deps.targetSystemFor(step) : (step.sources[0]?.kind ?? (step.tier === 'project_write' ? 'project' : 'external')),
      targetResource: step.tier === 'project_write' ? run.id : ((run.input as Record<string, unknown> | null)?.target as string | undefined) ?? `${run.workflowId}:${step.id}`,
      operation: `${step.title} (${run.workflowId}/${step.id})`,
      workflowId: run.workflowId,
      executorId: run.executorId,
      runId: run.id,
    };
    const decision = evaluateAction(store, request, policyContext(run.interactionClass, at));
    if (decision.allowed) return null;
    const open = listOpenDecisions(store, run.id).find((d) => d.stepRunId === stepRun.id);
    if (open) return open;
    const raised = raiseDecision(store, {
      id: deps.nextId('decision'),
      kind: decision.denial.stepUp.kind === 'approval' ? 'approval' : 'blocked',
      question: decision.denial.stepUp.kind === 'approval' ? decision.denial.stepUp.description : `${decision.denial.missing}. ${decision.denial.stepUp.description}`,
      runId: run.id,
      stepRunId: stepRun.id,
      options: decision.denial.stepUp.kind === 'approval' ? ['approve', 'decline'] : undefined,
      subject: { request, stepUp: decision.denial.stepUp, attempted: decision.denial.attempted, safeNow: decision.denial.safeNow },
      at,
    });
    if (stepRun.state === 'ready') transitionStep(store, { id: stepRun.id, to: 'waiting_for_decision', at, reason: 'awaiting approval' });
    if (run.state === 'ready' || run.state === 'running') transitionRun(store, { id: run.id, to: 'waiting_for_decision', at, reason: `step ${step.id} needs a decision` });
    return raised;
  }

  return {
    classify: classifyInteraction,

    remember({ kind, text, by, assumptions = [], replaces }) {
      const at = deps.now();
      const decision = evaluateAction(store, { tier: 'project_write', targetSystem: 'construct-state', targetResource: 'statements', operation: `remember: ${text}`, executorId: deps.host.executorId }, policyContext('remember', at));
      if (!decision.allowed) throw new Error(decision.denial.missing);
      return store.transaction(() => {
        const statement = addStatement(store, { id: deps.nextId('st'), kind, text, provenance: 'user', at });
        const entity = isGoverningKind(kind) ? bindGoverningStatement(store, statement, at, deps.nextId) : null;
        if (replaces) {
          if (!getStatement(store, replaces)) throw new Error(`no statement ${replaces} to replace`);
          supersedeGoverning(store, { olderId: replaces, successor: statement, at, nextId: deps.nextId });
        }
        if (entity) {
          for (const assumption of assumptions) {
            if (!assumption.trim()) continue;
            addClaim(store, {
              id: deps.nextId('claim'),
              subjectId: entity.id,
              claimType: 'assumption',
              statement: assumption,
              provenance: 'user',
              authority: 'authoritative',
              sensitivity: 'internal',
              confidence: 1,
              observedAt: at,
              at,
            });
          }
        }
        appendActivity(store, { at, kind: 'remember', actor: by, payload: { statementId: statement.id, kind, entityId: entity?.id ?? null } });
        return statement;
      });
    },

    preflight(workflowId, input) {
      const resolution = resolutionFor(workflowId, input, deps.host.executorId);
      return { resolution, preflight: preflightOf(resolution, input) };
    },

    start(input) {
      const at = deps.now();
      const executorId = input.executorId ?? deps.host.executorId;
      const executorKind = input.executorKind ?? (deps.host.sessionId ? 'interactive' : 'headless');
      const workflow = deps.workflows.get(input.workflowId);
      if (!workflow) {
        const resolution = resolutionFor(input.workflowId, input.input, executorId);
        throw new Error(resolution.reasons[0]?.message ?? `no workflow ${input.workflowId}`);
      }
      const m = workflow.manifest;
      if (m.interactionClass === 'remember' || m.interactionClass === 'answer') {
        throw new Error(`${m.id} is a ${m.interactionClass} workflow; it records or answers without a run`);
      }
      if (!m.triggers.includes(input.trigger)) throw new Error(`${m.id} does not accept ${input.trigger} triggers (it accepts ${m.triggers.join(', ')})`);
      const keyExplicit = input.idempotencyKey;
      const workIdentity = idempotencyKeyFor(workflow, input.input, input.trigger === 'manual' ? 'manual' : `${input.trigger}:${at.slice(0, 16)}`);
      if (keyExplicit) {
        const existingByKey = getRunByKey(store, keyExplicit);
        if (existingByKey) {
          const resolution = resolutionFor(m.id, input.input, executorId);
          return { run: existingByKey, created: false, resolution, preflight: preflightOf(resolution, input.input) };
        }
      } else {
        const inFlight = findActiveByWorkIdentity(store, workIdentity);
        if (inFlight) {
          const resolution = resolutionFor(m.id, input.input, executorId);
          return { run: inFlight, created: false, resolution, preflight: preflightOf(resolution, input.input) };
        }
      }
      const key = keyExplicit ?? `${workIdentity}:${deps.nextId('inv')}`;
      if (m.concurrency === 'single') {
        const active = listActiveRuns(store).find((r) => r.workflowId === m.id && r.state !== 'blocked');
        if (active) {
          const resolution = resolutionFor(m.id, input.input, executorId);
          const pf = preflightOf(resolution, input.input);
          return { run: active, created: false, resolution, preflight: { ...pf, flags: [...pf.flags, `an active ${m.id} run (${active.id}) already exists; concurrency is single`] } };
        }
      }
      let resolution = resolutionFor(m.id, input.input, executorId);
      if ((resolution.status === 'runnable' || resolution.status === 'outdated') && m.onStaleData === 'block') {
        const kinds = new Set(m.steps.flatMap((s) => s.sources.map((src) => src.kind)));
        const stale = deps.sources().filter((s) => kinds.has(s.kind) && (s.freshness === 'stale' || s.freshness === 'never_read'));
        if (stale.length > 0) {
          resolution = {
            ...resolution,
            status: 'blocked',
            reasons: [...resolution.reasons, ...stale.map((s) => ({ code: 'stale_source' as const, stepId: null, message: `${s.id} is ${s.freshness === 'stale' ? 'stale' : 'unread'} and this workflow blocks on stale data`, remedy: `Refresh ${s.id}.` }))],
            summary: `${m.id} ${m.version} is blocked: ${stale.map((s) => `${s.id} ${s.freshness === 'stale' ? 'stale' : 'unread'}`).join(', ')} (onStaleData: block)`,
          };
        }
      }
      const preflight = preflightOf(resolution, input.input);
      return store.transaction(() => {
        if (resolution.status === 'runnable' || resolution.status === 'outdated') {
          for (const stale of listActiveRuns(store).filter((r) => r.workflowId === m.id && r.state === 'blocked')) {
            transitionRun(store, { id: stale.id, to: 'cancelled', at, reason: 'superseded by a run that resolved' });
          }
        }
        const { run } = createRun(store, {
          id: deps.nextId('run'),
          workflowId: m.id,
          workflowVersion: m.version,
          interactionClass: m.interactionClass as 'manage' | 'maintain',
          triggerKind: input.trigger,
          idempotencyKey: key,
          executorKind,
          executorId,
          hostId: deps.host.hostId,
          sessionId: deps.host.sessionId ?? undefined,
          input: input.input,
          invocationId: key,
          workIdentity,
          workflowDigest: workflow.digest,
          bindings: { steps: m.steps, digest: workflow.digest, version: m.version },
          at,
        });
        store.db.prepare(
          `INSERT INTO run_bindings (run_id, workflow_id, workflow_version, workflow_digest, skill_bindings_json, frozen_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(run.id, m.id, m.version, workflow.digest, JSON.stringify(resolution.plan.map((p) => p.skill)), at);
        if (resolution.status === 'blocked' || resolution.status === 'divergent') {
          const blocked = transitionRun(store, { id: run.id, to: 'blocked', at, reason: resolution.summary, preflight });
          return { run: blocked, created: true, resolution, preflight };
        }
        const done = new Set<string>();
        const roots = new Set(readySteps(m.steps, done).map((s) => s.id));
        resolution.plan.forEach((bound, i) => {
          addStep(store, {
            id: deps.nextId('step'),
            runId: run.id,
            stepId: bound.step.id,
            ordinal: i,
            permissionTier: bound.step.tier,
            maxAttempts: bound.step.retry.maxAttempts,
            input: { skill: bound.skill, needsApproval: bound.needsApproval },
            ready: roots.has(bound.step.id),
            at,
          });
        });
        const ready = transitionRun(store, { id: run.id, to: 'ready', at, preflight });
        return { run: ready, created: true, resolution, preflight };
      });
    },

    claimNext({ runId, owner, leaseMs: requested }) {
      const at = deps.now();
      const who = owner ?? deps.host.executorId;
      expireDeadLeases(store, at, runId);
      const candidates = runId ? [getRun(store, runId)].filter((r): r is WorkflowRun => r !== null) : listActiveRuns(store);
      for (const run of candidates) {
        if (run.state === 'blocked') continue;
        if (run.state === 'waiting_for_decision') {
          const open = listOpenDecisions(store, run.id)[0];
          if (open) return { packet: null, waitingOn: { kind: 'decision', decision: open } };
          transitionRun(store, { id: run.id, to: 'running', at });
        }
        if (['succeeded', 'failed', 'cancelled'].includes(run.state)) continue;
        const currentWorkflow = deps.workflows.get(run.workflowId);
        if (run.workflowDigest && currentWorkflow && currentWorkflow.digest !== run.workflowDigest) {
          return { packet: null, waitingOn: { kind: 're_resolve', reason: `workflow ${run.workflowId} changed since this run was bound; re-resolve before continuing` } };
        }
        advance(run.id, at);
        const manifestSteps = stepsOf(run);
        for (const sr of listSteps(store, run.id).filter((s) => s.state === 'ready')) {
          const step = manifestSteps.find((s) => s.id === sr.stepId)!;
          const decision = gateStep(getRun(store, run.id)!, sr, step, at);
          if (decision) return { packet: null, waitingOn: { kind: 'decision', decision } };
        }
        // Steps the kernel performs itself: deterministic drift detection needs no host.
        let ranKernelStep = false;
        for (const sr of listSteps(store, run.id).filter((s) => s.state === 'ready')) {
          const step = manifestSteps.find((s) => s.id === sr.stepId)!;
          if (!step.capabilities.includes('kernel:drift_detect')) continue;
          const leasedByKernel = claimStep(store, { owner: 'kernel', now: at, leaseUntil: new Date(Date.parse(at) + 60_000).toISOString(), runId: run.id });
          if (!leasedByKernel || leasedByKernel.id !== sr.id) continue;
          const detected = detectDrift(store, { at, requireDecisionForChanges: false });
          const { recorded, alreadyOpen } = recordDrift(store, { runId: run.id, detected, at, nextId: deps.nextId });
          completeStep(store, { id: leasedByKernel.id, owner: 'kernel', token: leasedByKernel.token, at, output: { findings: detected, recordedFindingIds: recorded.map((f) => f.id), alreadyOpen, noDrift: detected.length === 0, evidence: detected.flatMap((d) => d.evidence.map((e) => ({ ref: e.ref, excerpt: e.note }))) } });
          appendActivity(store, { at, kind: 'step.kernel_ran', runId: run.id, stepRunId: sr.id, actor: 'kernel', payload: { stepId: step.id, findings: detected.length, recorded: recorded.length } });
          ranKernelStep = true;
        }
        if (ranKernelStep) advance(run.id, at);
        for (const sr of listSteps(store, run.id).filter((s) => s.state === 'ready')) {
          const boundSkill = (sr.input as { skill?: { id: string; digest: string } | null } | null)?.skill ?? null;
          const registeredSkill = boundSkill ? deps.skills.get(boundSkill.id) : null;
          if (boundSkill && registeredSkill && registeredSkill.digest !== boundSkill.digest) {
            return { packet: null, waitingOn: { kind: 're_resolve', reason: `skill ${boundSkill.id} changed since this run was bound; re-resolve before continuing` } };
          }
        }
        const leased = claimStep(store, { owner: who, now: at, leaseUntil: new Date(Date.parse(at) + (requested ?? leaseMs)).toISOString(), runId: run.id });
        if (!leased) continue;
        const fresh = getRun(store, run.id)!;
        if (fresh.state === 'ready') transitionRun(store, { id: run.id, to: 'running', at });
        const step = manifestSteps.find((s) => s.id === leased.stepId)!;
        const bound = (leased.input as { skill?: { id: string; version: string; digest: string } | null } | null)?.skill ?? null;
        const registered = bound ? deps.skills.get(bound.id) : null;
        const judgment = judgmentOf(fresh);
        const workflowChallenge = deps.workflows.get(fresh.workflowId)?.manifest.deliverable.challenge ?? false;
        const needsChallenge = judgmentRequired(workflowChallenge, judgment);
        const instructions = [
          `Step ${step.id}: ${step.title}.`,
          step.tier === 'observe' || step.tier === 'draft' ? 'Read and draft only; apply nothing.' : `This step may act at ${step.tier}; the gate has already been passed for exactly this step.`,
          step.outputs.length ? `Return an object with: ${step.outputs.join(', ')}.` : 'Return an object with what you found.',
          step.validators.length ? `It will be checked by: ${step.validators.join(', ')}.` : '',
          'Cite every source you read as evidence entries.',
          needsChallenge
            ? 'This work has architectural or irreversible consequences. Apply adversarial review before representing the result as strongly validated. Do not wait for the person to ask.'
            : judgment.depth === 'light'
              ? 'This is low-stakes reversible work. Do not run architecture ceremony or a full adversarial review.'
              : '',
        ].filter(Boolean);
        return {
          packet: {
            leased,
            run: getRun(store, run.id)!,
            step,
            skill: bound && registered
              ? { id: bound.id, version: bound.version, digest: bound.digest, body: () => deps.skills.body(bound.id), file: (p) => deps.skills.file(bound.id, p) }
              : null,
            inputs: inputsFor(fresh, step),
            instructions,
            judgment,
          },
          waitingOn: null,
        };
      }
      const finished = runId ? getRun(store, runId) : null;
      if (finished && ['succeeded', 'failed', 'cancelled'].includes(finished.state)) return { packet: null, waitingOn: { kind: 'finished', state: finished.state } };
      return { packet: null, waitingOn: { kind: 'nothing_ready' } };
    },

    submit({ leased, output, evidence = [], noData = false, resolvableRefs = new Set() }) {
      const at = deps.now();
      const run = getRun(store, leased.runId);
      if (!run) throw new Error(`no run ${leased.runId}`);
      const step = stepsOf(run).find((s) => s.id === leased.stepId);
      if (!step) throw new Error(`run ${run.id} has no frozen step ${leased.stepId}`);
      const currentWorkflow = deps.workflows.get(run.workflowId);
      if (noData) {
        const policy = currentWorkflow?.manifest.onNoData ?? 'fail';
        return store.transaction(() => {
          if (policy === 'fail') {
            const failed = failStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, error: { noData: true }, reason: 'no data' });
            return { step: failed, validation: [], run: advance(run.id, at), deliverable: null };
          }
          if (policy === 'block') {
            const decision = raiseDecision(store, { id: deps.nextId('decision'), kind: 'blocked', question: `Step ${step.id} found no data. Continue without it, or stop?`, runId: run.id, stepRunId: leased.id, options: ['continue', 'stop'], subject: { noData: true }, at });
            transitionStep(store, { id: leased.id, to: 'waiting_for_decision', at, reason: 'no data' });
            transitionRun(store, { id: run.id, to: 'waiting_for_decision', at, reason: `step ${step.id} found no data` });
            void decision;
            return { step: getStep(store, leased.id)!, validation: [], run: getRun(store, run.id)!, deliverable: null };
          }
          const done = completeStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, output: { noData: true, ...output } });
          return { step: done, validation: [], run: advance(run.id, at), deliverable: null };
        });
      }
      const validation = runValidators(step.validators, { output, expectedKeys: step.outputs, evidence, resolvableRefs });
      const failures = validation.filter((v) => !v.ok);
      return store.transaction(() => {
        if (failures.length > 0) {
          const reason = failures.map((f) => `${f.validator}: ${f.problems.join('; ')}`).join(' | ');
          const failed = failStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, error: { validation }, reason });
          appendActivity(store, { at, kind: 'step.validation_failed', runId: run.id, stepRunId: leased.id, actor: leased.leaseOwner, payload: { stepId: step.id, failures: failures.map((f) => f.validator) } });
          return { step: failed, validation, run: advance(run.id, at), deliverable: null };
        }
        const done = completeStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, output: { ...output, evidence } });
        let deliverable: Deliverable | null = null;
        const frozenSteps = stepsOf(run);
        const isLast = frozenSteps[frozenSteps.length - 1]?.id === step.id;
        const judgment = judgmentOf(run);
        const needsChallenge = judgmentRequired(currentWorkflow?.manifest.deliverable.challenge ?? false, judgment);
        if (isLast || step.challenge) {
          deliverable = upsertDraft(store, { id: deps.nextId('deliverable'), runId: run.id, stepRunId: leased.id, kind: currentWorkflow?.manifest.deliverable.kind ?? 'artifact', body: { ...output, evidence }, at });
          if (isLast && validation.every((v) => v.ok) && step.validators.length > 0) {
            deliverable = setTrustState(store, { id: deliverable.id, trustState: 'validated', actor: `validators:${step.validators.join(',')}`, at, verification: { validators: validation, challengeRequired: needsChallenge } });
          }
        }
        return { step: done, validation, run: advance(run.id, at), deliverable };
      });
    },

    fail({ leased, error, reason }) {
      const at = deps.now();
      const failed = failStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, error, reason });
      advance(leased.runId, at);
      return failed;
    },

    decide({ decisionId, resolution, by }) {
      const at = deps.now();
      return store.transaction(() => {
        const decision = getDecision(store, decisionId);
        if (!decision) throw new Error(`no decision ${decisionId}`);
        const resolved = resolveDecision(store, { id: decisionId, resolution, by, at });
        let run: WorkflowRun | null = decision.runId ? getRun(store, decision.runId) : null;
        const subject = (decision.subject ?? {}) as { request?: ActionRequest; noData?: boolean };
        if (decision.kind === 'approval' && subject.request) {
          if (resolution === 'approve') {
            approveAction(store, { id: deps.nextId('grant'), request: subject.request, by, at });
            if (decision.stepRunId) transitionStep(store, { id: decision.stepRunId, to: 'ready', at });
          } else if (decision.stepRunId) {
            transitionStep(store, { id: decision.stepRunId, to: 'cancelled', at, reason: `declined by ${by}` });
          }
        } else if (decision.kind === 'blocked' && subject.noData && decision.stepRunId) {
          if (resolution === 'continue') {
            transitionStep(store, { id: decision.stepRunId, to: 'skipped', at, reason: 'continued without data' });
          } else {
            transitionStep(store, { id: decision.stepRunId, to: 'cancelled', at, reason: `stopped by ${by}` });
          }
        } else if (decision.kind === 'clarification' && run) {
          const input = { ...((run.input ?? {}) as Record<string, unknown>) };
          const answers = { ...((input.answers as Record<string, unknown> | undefined) ?? {}), [decisionId]: resolution };
          store.db.prepare('UPDATE workflow_runs SET input_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...input, answers }), at, run.id);
          if (decision.stepRunId) {
            const sr = getStep(store, decision.stepRunId);
            if (sr?.state === 'waiting_for_decision') transitionStep(store, { id: sr.id, to: 'ready', at });
          }
        }
        if (run) {
          const fresh = getRun(store, run.id)!;
          if (fresh.state === 'waiting_for_decision' && listOpenDecisions(store, run.id).length === 0) {
            transitionRun(store, { id: run.id, to: 'running', at, reason: `decision ${decisionId} resolved by ${by}` });
          }
          run = advance(run.id, at);
        }
        return { decision: resolved, run };
      });
    },

    cancel({ runId, by, reason }) {
      const at = deps.now();
      return store.transaction(() => {
        const run = getRun(store, runId);
        if (!run) throw new Error(`no run ${runId}`);
        const workflow = deps.workflows.get(run.workflowId);
        const immediate = workflow?.manifest.cancellation !== 'after_step';
        setCancelRequested(store, runId, at);
        for (const s of listSteps(store, runId)) {
          if (s.state === 'pending' || s.state === 'ready' || s.state === 'waiting_for_decision') transitionStep(store, { id: s.id, to: 'cancelled', at, reason });
          else if (s.state === 'leased' && immediate) transitionStep(store, { id: s.id, to: 'cancelled', at, reason });
        }
        for (const d of listOpenDecisions(store, runId)) withdrawDecision(store, { id: d.id, reason: `run cancelled: ${reason}`, at });
        appendActivity(store, { at, kind: 'run.cancel_requested', runId, actor: by, payload: { reason, immediate } });
        const stillLeased = listSteps(store, runId).some((s) => s.state === 'leased');
        if (stillLeased) return getRun(store, runId)!; // finishes after the current step
        return transitionRun(store, { id: runId, to: 'cancelled', at, reason, actor: by });
      });
    },

    resume(runId) {
      const at = deps.now();
      return store.transaction(() => {
        const run = getRun(store, runId);
        if (!run) throw new Error(`no run ${runId}`);
        if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
        if (run.state === 'blocked') {
          const resolution = resolutionFor(run.workflowId, (run.input ?? {}) as Record<string, unknown>, run.executorId);
          if (resolution.status === 'runnable' || resolution.status === 'outdated') {
            const roots = new Set(readySteps(resolution.workflow!.manifest.steps, new Set()).map((s) => s.id));
            if (listSteps(store, runId).length === 0) {
              resolution.plan.forEach((bound, i) => addStep(store, { id: deps.nextId('step'), runId, stepId: bound.step.id, ordinal: i, permissionTier: bound.step.tier, maxAttempts: bound.step.retry.maxAttempts, input: { skill: bound.skill, needsApproval: bound.needsApproval }, ready: roots.has(bound.step.id), at }));
            }
            return transitionRun(store, { id: runId, to: 'ready', at, reason: 'resolved on resume', preflight: preflightOf(resolution, (run.input ?? {}) as Record<string, unknown>) });
          }
          return transitionRun(store, { id: runId, to: 'preflight', at, reason: 'still blocked', preflight: preflightOf(resolution, (run.input ?? {}) as Record<string, unknown>) }) && transitionRun(store, { id: runId, to: 'blocked', at, reason: resolution.summary });
        }
        appendActivity(store, { at, kind: 'run.resumed', runId, payload: { from: run.state } });
        return advance(runId, at);
      });
    },

    status(runId) {
      const run = getRun(store, runId);
      if (!run) return null;
      return { run, steps: listSteps(store, runId), deliverables: listDeliverables(store, runId), openDecisions: listOpenDecisions(store, runId), activity: listActivity(store, { runId, limit: 1000 }).length };
    },

    promote({ deliverableId, to, by, verification, reason }) {
      const at = deps.now();
      const current = getDeliverable(store, deliverableId);
      if (!current) throw new Error(`no deliverable ${deliverableId}`);
      if (to === 'final' && current.trustState !== 'accepted') throw new Error('a deliverable is final only after it was accepted');
      const run = getRun(store, current.runId);
      if (run && (to === 'accepted' || to === 'final')) {
        const workflow = deps.workflows.get(run.workflowId);
        const needsChallenge = judgmentRequired(workflow?.manifest.deliverable.challenge ?? false, judgmentOf(run));
        if (needsChallenge && to === 'accepted' && current.trustState !== 'challenged') {
          throw new Error('this outcome has architectural or irreversible consequences; it is accepted only after a recorded challenge');
        }
        if (activeContradictionCount(store) > 0) {
          throw new Error('an active contradiction stands against a governing obligation; it cannot become a trusted finished outcome');
        }
        const body = current.body && typeof current.body === 'object' ? (current.body as Record<string, unknown>) : null;
        if (body) {
          const facts = runValidators(['no_placeholder_facts'], { output: body, expectedKeys: [], evidence: [], resolvableRefs: new Set() });
          if (facts[0] && !facts[0].ok) throw new Error(facts[0].problems.join('; '));
        }
      }
      return setTrustState(store, { id: deliverableId, trustState: to, actor: by, at, verification, reason });
    },
  };
}
