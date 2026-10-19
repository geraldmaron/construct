/**
 * kernel/registry/models.ts — what a skill, a workflow, and a capability
 * declare. The manifests are versioned JSON; every field here takes part in
 * resolution and is validated on the way in (validation.ts).
 */

import type { ActionTier } from '../state/steps.ts';
import { SLOT_TYPES } from './slots.ts';

export const SKILL_MANIFEST_FILE = 'construct.skill.json';
export const SKILL_MANIFEST_FORMAT = 'construct-skill';
export const SKILL_MANIFEST_VERSION = 1;

export const WORKFLOW_MANIFEST_FILE = 'workflow.json';
export const WORKFLOW_MANIFEST_FORMAT = 'construct-workflow';
export const WORKFLOW_MANIFEST_VERSION = 1;

export const INTERACTION_CLASSES = ['answer', 'remember', 'manage', 'maintain'] as const;
export type InteractionClass = (typeof INTERACTION_CLASSES)[number];

/** The types a workflow input may declare: plain JSON shapes, and the kernel-checked slots (slots.ts). */
export const INPUT_TYPES = ['string', 'number', 'boolean', 'string[]', 'object', ...SLOT_TYPES] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const BUNDLE_ORIGINS = ['builtin', 'project'] as const;
export type BundleOrigin = (typeof BUNDLE_ORIGINS)[number];

/** A capability name: what a step needs, never a tool. */
export type CapabilityName = string;

export interface VersionedDependency {
  readonly id: string;
  readonly range: string;
}

export interface SkillManifest {
  readonly format: typeof SKILL_MANIFEST_FORMAT;
  readonly formatVersion: typeof SKILL_MANIFEST_VERSION;
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly category: 'method' | 'operational' | 'professional';
  readonly owner: string;
  /** What the host must provide wherever the skill is bound; the resolver blocks a step that cannot. */
  readonly capabilities: readonly CapabilityName[];
  /** The highest action tier a step may apply this skill at; the resolver blocks a step above it. */
  readonly maxTier: ActionTier;
  /** Validators the deliverable must pass wherever the skill is bound; the resolver blocks a workflow whose steps name none of them. */
  readonly requiredValidators: readonly string[];
  readonly skillDependencies: readonly VersionedDependency[];
}

export interface WorkflowStep {
  readonly id: string;
  readonly title: string;
  readonly needs: readonly string[];
  readonly skill: VersionedDependency | null;
  readonly capabilities: readonly CapabilityName[];
  readonly sources: readonly { readonly kind: string; readonly freshness: 'fresh' | 'any'; readonly required: boolean }[];
  readonly tier: ActionTier;
  /** Input keys and where they come from: "input.<key>" or "steps.<id>.<output>". */
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: readonly string[];
  readonly validators: readonly string[];
  readonly loadBearing: boolean;
  readonly challenge: boolean;
  readonly retry: { readonly maxAttempts: number; readonly backoffMs: number };
  readonly timeoutMs: number;
}

export type WorkflowDomain = Partial<Omit<WorkflowManifest, 'domains' | 'domainStep' | 'steps' | 'id' | 'version'>> & {
  readonly skill: VersionedDependency;
  readonly steps?: Readonly<Record<string, Partial<Omit<WorkflowStep, 'id'>>>>;
};

export interface WorkflowManifest {
  readonly domainStep?: string;
  readonly domains?: Readonly<Record<string, WorkflowDomain>>;
  readonly execution?: {
    readonly path: 'research' | 'decision' | 'artifact' | 'implementation' | 'review';
    readonly checkpoints: readonly string[];
    readonly evidenceObligations: readonly string[];
    readonly maxGatherCalls: number;
    readonly stopWhen: readonly string[];
    readonly assurance: 'structural' | 'independent_review';
  };
  readonly format: typeof WORKFLOW_MANIFEST_FORMAT;
  readonly formatVersion: typeof WORKFLOW_MANIFEST_VERSION;
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly purpose: string;
  readonly interactionClass: InteractionClass;
  readonly inputSchema: Readonly<Record<string, InputType>>;
  readonly requiredInputs: readonly string[];
  readonly steps: readonly WorkflowStep[];
  readonly triggers: readonly ('manual' | 'schedule' | 'event')[];
  readonly onNoData: 'succeed_empty' | 'block' | 'fail';
  readonly onStaleData: 'block' | 'proceed_flagged' | 'fail';
  readonly concurrency: 'single' | 'per_input';
  readonly dedupeKey: readonly string[];
  readonly cancellation: 'immediate' | 'after_step';
  readonly deliverable: { readonly kind: string; readonly schema: string; readonly challenge: boolean };
  readonly proposes: readonly ('constitution' | 'sources' | 'skills' | 'workflows' | 'lessons')[];
}

export interface CapabilityDeclaration {
  readonly name: CapabilityName;
  readonly description: string;
  /** The lowest tier an action using this capability can be. */
  readonly tier: ActionTier;
  readonly kind: 'read' | 'write' | 'validator' | 'review' | 'interaction';
}

export interface RegisteredSkill {
  readonly manifest: SkillManifest;
  readonly origin: BundleOrigin;
  readonly dir: string;
  readonly digest: string;
  readonly description: string;
  /** Files by relative path, so a selected body loads on demand. */
  readonly files: readonly string[];
}

export interface RegisteredWorkflow {
  readonly canonicalId?: string;
  readonly domain?: string;
  readonly manifest: WorkflowManifest;
  readonly origin: BundleOrigin;
  readonly dir: string;
  readonly digest: string;
  readonly files: readonly string[];
}
