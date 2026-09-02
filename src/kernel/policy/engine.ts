/**
 * kernel/policy/engine.ts — may this action run, and if not, what is the
 * smallest thing that would let it?
 *
 * The engine reads the tier defaults and the grants and returns a decision
 * that names its basis. A denial always says what was attempted, which
 * capability or scope is missing, what remains safe to do now, and the
 * smallest step-up: an approval scoped to exactly this action, never a wider
 * one. Approvals it mints expire soon and name their executor, so they cannot
 * persist or transfer. Break-glass never turns off evidence, integrity, or
 * completion gates; the decision says so every time.
 */

import type { StateStore } from '../state/open.ts';
import { appendActivity } from '../state/activity.ts';
import { coveringGrants, createGrant, type Grant, type GrantableTier } from '../state/grants.ts';
import type { ActionTier } from '../state/steps.ts';
import { TIER_POLICIES } from './lattice.ts';

export const INTERACTION_CLASSES = ['answer', 'remember', 'manage', 'maintain'] as const;
export type InteractionClass = (typeof INTERACTION_CLASSES)[number];

export interface ActionRequest {
  readonly tier: ActionTier;
  /** The system acted on: 'construct-state', 'project-files', 'jira', 'github', ... */
  readonly targetSystem: string;
  /** The exact thing: a ticket key, a path, a repository. Required above draft. */
  readonly targetResource?: string;
  /** A plain sentence a person would recognize: "update PROJ-14's status to Done". */
  readonly operation: string;
  readonly workflowId?: string;
  readonly executorId: string;
  readonly runId?: string;
  readonly budgetCents?: number;
}

export interface PolicyContext {
  readonly at: string;
  readonly interactionClass: InteractionClass;
  /** From project config policy.projectWrite. */
  readonly projectWritePolicy: 'managed' | 'never';
  /** The person asked, in so many words, to remember or record this. */
  readonly explicitRememberRequest?: boolean;
}

export type StepUp =
  | { readonly kind: 'approval'; readonly description: string; readonly proposedGrant: ProposedGrant }
  | { readonly kind: 'managed_outcome'; readonly description: string }
  | { readonly kind: 'project_policy'; readonly description: string }
  | { readonly kind: 'name_the_target'; readonly description: string }
  | { readonly kind: 'licensed_review'; readonly description: string }
  | { readonly kind: 'none'; readonly description: string };

export interface ProposedGrant {
  readonly actionTier: GrantableTier;
  readonly targetSystem: string;
  readonly targetResource: string;
  readonly workflowId: string | null;
  readonly executorId: string;
  readonly budgetCents: number | null;
  /** How long the approval would stand. */
  readonly ttlMs: number;
}

export interface PermissionDenial {
  readonly attempted: string;
  readonly missing: string;
  readonly safeNow: readonly string[];
  readonly stepUp: StepUp;
}

export type PolicyDecision =
  | {
      readonly allowed: true;
      readonly basis: 'tier_default' | 'explicit_request' | 'managed_outcome' | 'standing_grant' | 'action_time_approval' | 'break_glass';
      readonly grant: Grant | null;
      /** Always true: no basis switches off evidence, source-integrity, or completion gates. */
      readonly gatesStillApply: true;
    }
  | { readonly allowed: false; readonly denial: PermissionDenial; readonly gatesStillApply: true };

export const DEFAULT_APPROVAL_TTL_MS = 60 * 60_000;

const SAFE_BELOW_WRITE: readonly string[] = [
  'read the sources already connected and report what they say',
  'draft the change and show it without applying it',
];

function deny(attempted: string, missing: string, safeNow: readonly string[], stepUp: StepUp): PolicyDecision {
  return { allowed: false, denial: { attempted, missing, safeNow, stepUp }, gatesStillApply: true };
}

function allow(basis: Extract<PolicyDecision, { allowed: true }>['basis'], grant: Grant | null = null): PolicyDecision {
  return { allowed: true, basis, grant, gatesStillApply: true };
}

function proposedGrantFor(request: ActionRequest, ttlMs: number): ProposedGrant {
  return {
    actionTier: request.tier as GrantableTier,
    targetSystem: request.targetSystem,
    targetResource: request.targetResource!,
    workflowId: request.workflowId ?? null,
    executorId: request.executorId,
    budgetCents: request.budgetCents ?? null,
    ttlMs,
  };
}

/** Decide one action against tier defaults and grants. Pure apart from reading grants. */
export function evaluateAction(store: StateStore, request: ActionRequest, context: PolicyContext): PolicyDecision {
  const policy = TIER_POLICIES[request.tier];
  const attempted = `${request.operation} (${request.tier} on ${request.targetSystem}${request.targetResource ? ` ${request.targetResource}` : ''})`;

  if (request.tier === 'licensed_judgment') {
    return deny(
      attempted,
      'a qualified person’s sign-off, which Construct never supplies',
      ['spot the issues and prepare the material a qualified reviewer would need', 'draft the question for that reviewer'],
      { kind: 'licensed_review', description: 'Hand the prepared material to a qualified reviewer; their decision is recorded as theirs.' },
    );
  }

  if (request.tier === 'observe' || request.tier === 'draft') {
    return allow('tier_default');
  }

  if (request.tier === 'project_write') {
    if (context.interactionClass === 'remember') {
      if (context.explicitRememberRequest) return allow('explicit_request');
      return deny(
        attempted,
        'an explicit request to remember or record this',
        ['answer without recording anything'],
        { kind: 'none', description: 'Ask the person whether they want this remembered; record it only if they say so.' },
      );
    }
    if (context.projectWritePolicy === 'never') {
      return deny(
        attempted,
        'project policy allows no project writes (policy.projectWrite is never)',
        SAFE_BELOW_WRITE,
        { kind: 'project_policy', description: 'Change policy.projectWrite to managed in .construct/project.json if writes inside managed outcomes should be allowed.' },
      );
    }
    if (context.interactionClass === 'manage' || context.interactionClass === 'maintain') {
      return allow('managed_outcome');
    }
    return deny(
      attempted,
      'a managed outcome; a plain question never writes',
      SAFE_BELOW_WRITE,
      { kind: 'managed_outcome', description: 'Start a managed outcome for this change so the write is scoped, recorded, and verifiable.' },
    );
  }

  // external_write and destructive
  if (!request.targetResource) {
    return deny(
      attempted,
      `the exact ${request.targetSystem} resource this would change`,
      SAFE_BELOW_WRITE,
      { kind: 'name_the_target', description: 'Name the exact resource (a ticket, a repository, a path) before asking for approval.' },
    );
  }
  const covering = coveringGrants(store, {
    actionTier: request.tier,
    targetSystem: request.targetSystem,
    targetResource: request.targetResource,
    workflowId: request.workflowId,
    executorId: request.executorId,
    at: context.at,
  }).filter((g) => request.tier !== 'destructive' || g.breakGlass || g.executorId !== null);
  const withinBudget = covering.filter((g) => g.budgetCents === null || request.budgetCents === undefined || request.budgetCents <= g.budgetCents);
  if (withinBudget.length > 0) {
    const grant = withinBudget[0]!;
    if (grant.breakGlass) return allow('break_glass', grant);
    const isApproval = grant.executorId !== null && grant.targetResource !== null && grant.endsAt !== null;
    return allow(isApproval ? 'action_time_approval' : 'standing_grant', grant);
  }
  const missing =
    covering.length > 0
      ? `a grant whose budget covers ${String(request.budgetCents)} cents (the covering grant allows ${String(covering[0]!.budgetCents)})`
      : `${policy.requirement === 'action_time_approval' ? 'approval' : 'a grant'} for ${request.tier} on ${request.targetSystem} ${request.targetResource}${request.executorId ? ` by ${request.executorId}` : ''}`;
  return deny(attempted, missing, SAFE_BELOW_WRITE, {
    kind: 'approval',
    description: `Approve exactly this: ${request.operation}. The approval covers only ${request.targetSystem} ${request.targetResource}, only ${request.executorId}, and expires.`,
    proposedGrant: proposedGrantFor(request, DEFAULT_APPROVAL_TTL_MS),
  });
}

/** One sentence per part of a denial, in the order a person needs them. */
export function explainDenial(denial: PermissionDenial): string {
  return [
    `Attempted: ${denial.attempted}.`,
    `Missing: ${denial.missing}.`,
    `Safe now: ${denial.safeNow.join('; ')}.`,
    `Smallest step-up: ${denial.stepUp.description}`,
  ].join('\n');
}

export interface ApproveInput {
  readonly id: string;
  readonly request: ActionRequest;
  readonly by: string;
  readonly at: string;
  readonly ttlMs?: number;
}

/**
 * A person approves exactly this action. The grant names the resource,
 * workflow, executor, and budget from the request and expires after the TTL,
 * so it neither widens, persists, nor transfers.
 */
export function approveAction(store: StateStore, input: ApproveInput): Grant {
  const { request } = input;
  if (request.tier === 'licensed_judgment' || request.tier === 'observe' || request.tier === 'draft' || request.tier === 'project_write') {
    throw new Error(`${request.tier} is not approved this way: ${TIER_POLICIES[request.tier].description}`);
  }
  if (!request.targetResource) throw new Error('an approval names the exact resource it covers');
  const ttlMs = input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;
  if (!(ttlMs > 0)) throw new Error('an approval must last a positive amount of time');
  return store.transaction(() => {
    const grant = createGrant(store, {
      id: input.id,
      actionTier: request.tier as GrantableTier,
      targetSystem: request.targetSystem,
      targetResource: request.targetResource,
      workflowId: request.workflowId,
      executorId: request.executorId,
      budgetCents: request.budgetCents,
      startsAt: input.at,
      endsAt: new Date(Date.parse(input.at) + ttlMs).toISOString(),
      grantedBy: input.by,
      at: input.at,
    });
    appendActivity(store, {
      at: input.at,
      kind: 'policy.approved',
      runId: request.runId ?? null,
      actor: input.by,
      payload: { grantId: grant.id, operation: request.operation, tier: request.tier, targetSystem: request.targetSystem, targetResource: request.targetResource },
    });
    return grant;
  });
}

export interface BreakGlassInput {
  readonly id: string;
  readonly request: ActionRequest;
  readonly reason: string;
  readonly by: string;
  readonly at: string;
  readonly ttlMs: number;
}

/**
 * Break glass: an exact, short, reasoned grant for one executor. It changes
 * who may act, never what must still be evidenced, verified, or completed.
 */
export function breakGlass(store: StateStore, input: BreakGlassInput): Grant {
  const { request } = input;
  if (request.tier !== 'external_write' && request.tier !== 'destructive') {
    throw new Error('break-glass applies to external or destructive actions only');
  }
  if (!request.targetResource) throw new Error('break-glass names the exact resource');
  return createGrant(store, {
    id: input.id,
    actionTier: request.tier,
    targetSystem: request.targetSystem,
    targetResource: request.targetResource,
    workflowId: request.workflowId,
    executorId: request.executorId,
    budgetCents: request.budgetCents,
    startsAt: input.at,
    endsAt: new Date(Date.parse(input.at) + input.ttlMs).toISOString(),
    grantedBy: input.by,
    breakGlass: true,
    reason: input.reason,
    at: input.at,
  });
}
