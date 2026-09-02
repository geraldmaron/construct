/**
 * kernel/registry/resolver.ts — can this workflow run here, now, and why or
 * why not? Every answer is a list of named reasons; nothing is chosen as
 * "close enough". A runnable result carries the bound plan: each step with
 * the exact skill version and digest it will use, in order.
 */

import type { RegistryLock } from '../project/lock.ts';
import { coveringGrants } from '../state/grants.ts';
import type { StateStore } from '../state/open.ts';
import type { ActionTier } from '../state/steps.ts';
import { tierAtLeast } from '../policy/lattice.ts';
import { isKnownCapability, isKnownValidator, provides, type HostCapabilities } from './capability-registry.ts';
import { DependencyCycleError, stepOrder } from './dependency-graph.ts';
import { lockStatus, type LockRow } from './lockfile.ts';
import type { RegisteredSkill, RegisteredWorkflow, WorkflowStep } from './models.ts';
import { satisfies } from './semver.ts';
import type { SkillRegistry } from './skill-registry.ts';
import type { WorkflowRegistry } from './workflow-registry.ts';

export const RESOLUTION_REASONS = [
  'missing_workflow',
  'missing_skill',
  'incompatible_version',
  'missing_capability',
  'dependency_cycle',
  'missing_step_input',
  'schema_mismatch',
  'unknown_action_tier',
  'capability_unavailable',
  'ungranted_consequential',
  'missing_validator',
  'stale_source',
  'unavailable_source',
  'ambiguous_executor',
  'lockfile_divergence',
  'tier_above_executor',
] as const;
export type ResolutionReasonCode = (typeof RESOLUTION_REASONS)[number];

export interface ResolutionReason {
  readonly code: ResolutionReasonCode;
  readonly stepId: string | null;
  readonly message: string;
  /** What would clear it, in a sentence. */
  readonly remedy: string;
}

export interface BoundStep {
  readonly step: WorkflowStep;
  readonly skill: { readonly id: string; readonly version: string; readonly digest: string } | null;
  readonly needsApproval: boolean;
}

export type ResolutionStatus = 'runnable' | 'blocked' | 'outdated' | 'divergent';

export interface Resolution {
  readonly status: ResolutionStatus;
  readonly workflow: RegisteredWorkflow | null;
  readonly reasons: readonly ResolutionReason[];
  readonly plan: readonly BoundStep[];
  readonly executor: string | null;
  readonly lock: readonly LockRow[];
  readonly summary: string;
}

export interface SourceAvailability {
  readonly kind: string;
  readonly id: string;
  readonly reachability: 'unknown' | 'reachable' | 'unreachable';
  readonly freshness: 'fresh' | 'stale' | 'never_read' | 'no_expectation';
}

export interface ResolveInput {
  readonly workflowId: string;
  readonly versionRange?: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly skills: SkillRegistry;
  readonly workflows: WorkflowRegistry;
  readonly lock: RegistryLock;
  readonly host: HostCapabilities;
  /** Other executors that could run headless steps; more than one without a pin is ambiguous. */
  readonly executorCandidates?: readonly string[];
  readonly pinnedExecutor?: string | null;
  readonly sources: readonly SourceAvailability[];
  readonly store: StateStore;
  readonly at: string;
  readonly targetSystemFor?: (step: WorkflowStep) => string;
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string') ? 'string[]' : 'array';
  if (value === null) return 'null';
  return typeof value;
}

export function resolveWorkflow(input: ResolveInput): Resolution {
  const reasons: ResolutionReason[] = [];
  const workflow = input.workflows.get(input.workflowId);
  if (!workflow) {
    const known = input.workflows.list().map((w) => w.manifest.id);
    return {
      status: 'blocked',
      workflow: null,
      reasons: [{ code: 'missing_workflow', stepId: null, message: `no workflow "${input.workflowId}"`, remedy: known.length ? `Choose one of: ${known.join(', ')}.` : 'Add a workflow under workflows/ or .construct/workflows/.' }],
      plan: [],
      executor: null,
      lock: [],
      summary: `no workflow "${input.workflowId}"`,
    };
  }
  const m = workflow.manifest;
  if (input.versionRange && !satisfies(m.version, input.versionRange)) {
    reasons.push({ code: 'incompatible_version', stepId: null, message: `workflow ${m.id} is ${m.version}; ${input.versionRange} was asked for`, remedy: 'Ask for a range this version satisfies, or update the workflow.' });
  }

  // Inputs against the schema.
  for (const key of m.requiredInputs) {
    if (input.input[key] === undefined) reasons.push({ code: 'missing_step_input', stepId: null, message: `input "${key}" is required and absent`, remedy: `Provide ${key} (${m.inputSchema[key] ?? 'value'}).` });
  }
  for (const [key, value] of Object.entries(input.input)) {
    const expected = m.inputSchema[key];
    if (!expected) {
      reasons.push({ code: 'schema_mismatch', stepId: null, message: `input "${key}" is not declared by the workflow`, remedy: `Remove ${key} or add it to the workflow's inputSchema.` });
      continue;
    }
    const actual = typeOf(value);
    if (!(actual === expected || (expected === 'object' && actual === 'object'))) {
      reasons.push({ code: 'schema_mismatch', stepId: null, message: `input "${key}" is ${actual}, not ${expected}`, remedy: `Pass ${key} as ${expected}.` });
    }
  }

  // Order (cycles) first; a cyclic workflow has no plan at all.
  let order: string[] = [];
  try {
    order = stepOrder(m.steps);
  } catch (error) {
    if (error instanceof DependencyCycleError) {
      reasons.push({ code: 'dependency_cycle', stepId: null, message: error.message, remedy: 'Break the cycle in the workflow’s needs.' });
    } else {
      throw error;
    }
  }

  const executor = input.pinnedExecutor ?? input.host.executorId;
  const candidates = input.executorCandidates ?? [];
  const headlessSteps = m.steps.filter((s) => s.capabilities.some((c) => c.startsWith('run_')) && !input.host.sessionId);
  if (!input.pinnedExecutor && candidates.length > 1 && headlessSteps.length > 0) {
    reasons.push({ code: 'ambiguous_executor', stepId: null, message: `${String(candidates.length)} executors could run this (${candidates.join(', ')}) and none is pinned`, remedy: 'Pin one with headless.executor.' });
  }

  const plan: BoundStep[] = [];
  for (const id of order) {
    const step = m.steps.find((s) => s.id === id)!;
    let bound: BoundStep['skill'] = null;
    if (step.skill) {
      const skill = input.skills.get(step.skill.id);
      if (!skill) {
        const portable = input.skills.portableOnly().find((p) => p.name === step.skill!.id);
        reasons.push({
          code: 'missing_skill',
          stepId: step.id,
          message: portable ? `skill "${step.skill.id}" ships without a Construct manifest, so no workflow can bind it` : `no skill "${step.skill.id}"`,
          remedy: portable ? `Add ${step.skill.id}/construct.skill.json.` : `Install or author the skill ${step.skill.id}.`,
        });
      } else if (!satisfies(skill.manifest.version, step.skill.range)) {
        reasons.push({ code: 'incompatible_version', stepId: step.id, message: `skill ${skill.manifest.id} is ${skill.manifest.version}; step needs ${step.skill.range}`, remedy: 'Update the skill or widen the step’s range.' });
      } else {
        bound = { id: skill.manifest.id, version: skill.manifest.version, digest: skill.digest };
        for (const dep of skill.manifest.skillDependencies) {
          const d = input.skills.get(dep.id);
          if (!d) reasons.push({ code: 'missing_skill', stepId: step.id, message: `skill ${skill.manifest.id} depends on "${dep.id}", which is absent`, remedy: `Install ${dep.id}.` });
          else if (!satisfies(d.manifest.version, dep.range)) reasons.push({ code: 'incompatible_version', stepId: step.id, message: `skill ${skill.manifest.id} needs ${dep.id} ${dep.range}; ${d.manifest.version} is present`, remedy: 'Update the dependency or the range.' });
        }
        for (const cap of skill.manifest.capabilities) {
          if (!step.capabilities.includes(cap) && !provides(input.host, cap)) {
            reasons.push({ code: 'capability_unavailable', stepId: step.id, message: `skill ${skill.manifest.id} needs ${cap}, which this host does not provide`, remedy: `Connect something that provides ${cap}, or run in a host that does.` });
          }
        }
      }
    }
    const tier = step.tier as string;
    if (!['observe', 'draft', 'project_write', 'external_write', 'destructive', 'licensed_judgment'].includes(tier)) {
      reasons.push({ code: 'unknown_action_tier', stepId: step.id, message: `step tier "${tier}" is not in the lattice`, remedy: 'Use one of the six tiers.' });
    }
    if (!tierAtLeast(input.host.maxTier, step.tier)) {
      reasons.push({ code: 'tier_above_executor', stepId: step.id, message: `step needs ${step.tier}; this executor may reach ${input.host.maxTier} at most`, remedy: 'Run in an executor allowed to act at that tier, or lower the step.' });
    }
    for (const cap of step.capabilities) {
      if (!isKnownCapability(cap)) reasons.push({ code: 'missing_capability', stepId: step.id, message: `capability "${cap}" is not one Construct knows`, remedy: 'Declare a known capability.' });
      else if (!provides(input.host, cap)) reasons.push({ code: 'capability_unavailable', stepId: step.id, message: `capability ${cap} is not available in this host`, remedy: `Connect something that provides ${cap}.` });
    }
    for (const v of step.validators) {
      if (!isKnownValidator(v)) reasons.push({ code: 'missing_validator', stepId: step.id, message: `validator "${v}" is not one Construct ships`, remedy: 'Name a shipped validator.' });
    }
    if (step.loadBearing && step.validators.length === 0) {
      reasons.push({ code: 'missing_validator', stepId: step.id, message: 'load-bearing step has no validator', remedy: 'Add a validator to the step.' });
    }
    for (const req of step.sources) {
      const matching = input.sources.filter((s) => s.kind === req.kind);
      if (matching.length === 0) {
        if (req.required) reasons.push({ code: 'unavailable_source', stepId: step.id, message: `no ${req.kind} source is declared`, remedy: `Declare a ${req.kind} source.` });
        continue;
      }
      const usable = matching.filter((s) => s.reachability !== 'unreachable' && (req.freshness === 'any' || s.freshness === 'fresh' || s.freshness === 'no_expectation'));
      if (usable.length === 0 && req.required) {
        const stale = matching.some((s) => s.freshness === 'stale' || s.freshness === 'never_read');
        reasons.push(
          stale
            ? { code: 'stale_source', stepId: step.id, message: `every ${req.kind} source is stale or unread (${matching.map((s) => s.id).join(', ')})`, remedy: `Refresh a ${req.kind} source.` }
            : { code: 'unavailable_source', stepId: step.id, message: `every ${req.kind} source is unreachable (${matching.map((s) => s.id).join(', ')})`, remedy: `Reconnect a ${req.kind} source.` },
        );
      }
    }
    let needsApproval = false;
    if (tierAtLeast(step.tier, 'external_write') && step.tier !== 'licensed_judgment') {
      const system = input.targetSystemFor ? input.targetSystemFor(step) : (step.sources[0]?.kind ?? 'external');
      const covered = coveringGrants(input.store, { actionTier: step.tier as ActionTier, targetSystem: system, workflowId: m.id, executorId: executor, at: input.at });
      needsApproval = covered.length === 0;
      if (needsApproval) {
        reasons.push({ code: 'ungranted_consequential', stepId: step.id, message: `step acts at ${step.tier} on ${system} and nothing grants it`, remedy: 'Approval will be asked for at that step with the exact target; the run can start and will pause there.' });
      }
    }
    if (step.tier === 'licensed_judgment') {
      reasons.push({ code: 'ungranted_consequential', stepId: step.id, message: 'step is a licensed judgment, which Construct never performs', remedy: 'Reshape the step to prepare material for a qualified reviewer.' });
    }
    plan.push({ step, skill: bound, needsApproval });
  }

  const lock = lockStatus(input.lock, input.skills.list(), input.workflows.list()).filter((row) =>
    (row.kind === 'workflow' && row.id === m.id) || (row.kind === 'skill' && plan.some((p) => p.skill?.id === row.id)),
  );
  for (const row of lock) {
    if (row.state === 'diverged' || row.state === 'blocked' || row.state === 'missing') {
      reasons.push({ code: 'lockfile_divergence', stepId: null, message: `${row.kind} ${row.id}: ${row.why}`, remedy: 'Run the registry update to reconcile the lock, confirming any project-authored change.' });
    }
  }

  // Approvals at run time do not block starting; everything else does.
  const hard = reasons.filter((r) => !(r.code === 'ungranted_consequential' && r.stepId !== null && plan.find((p) => p.step.id === r.stepId)?.step.tier !== 'licensed_judgment'));
  let status: ResolutionStatus = 'runnable';
  if (hard.some((r) => r.code === 'lockfile_divergence')) status = 'divergent';
  if (hard.some((r) => r.code !== 'lockfile_divergence')) status = 'blocked';
  if (status === 'runnable' && lock.some((row) => row.state === 'outdated' || row.state === 'unlocked')) status = 'outdated';
  const summary =
    status === 'runnable'
      ? `${m.id} ${m.version} can run: ${String(plan.length)} step(s)${plan.some((p) => p.needsApproval) ? `, approval needed at ${plan.filter((p) => p.needsApproval).map((p) => p.step.id).join(', ')}` : ''}`
      : `${m.id} ${m.version} is ${status}: ${hard.length ? hard.map((r) => r.message).join('; ') : lock.filter((r) => r.state !== 'current').map((r) => r.why).join('; ')}`;
  return { status, workflow, reasons, plan, executor, lock, summary };
}
