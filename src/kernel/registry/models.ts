/**
 * kernel/registry/models.ts — what a skill, a workflow, and a capability
 * declare. The manifests are versioned JSON; every field here takes part in
 * resolution and is validated on the way in (validation.ts).
 */

import type { ActionTier } from '../state/steps.ts';

export const SKILL_MANIFEST_FILE = 'construct.skill.json';
export const SKILL_MANIFEST_FORMAT = 'construct-skill';
export const SKILL_MANIFEST_VERSION = 1;

export const WORKFLOW_MANIFEST_FILE = 'workflow.json';
export const WORKFLOW_MANIFEST_FORMAT = 'construct-workflow';
export const WORKFLOW_MANIFEST_VERSION = 1;

export const INTERACTION_CLASSES = ['answer', 'remember', 'manage', 'maintain'] as const;
export type InteractionClass = (typeof INTERACTION_CLASSES)[number];

export const BUNDLE_ORIGINS = ['builtin', 'project'] as const;
export type BundleOrigin = (typeof BUNDLE_ORIGINS)[number];

/** A capability name: what a step needs, never a tool. */
export type CapabilityName = string;

export interface VersionedDependency {
  readonly id: string;
  readonly range: string;
}

export interface QualityGate {
  /** A validator id from the capability registry (deterministic), or a review the workflow must run. */
  readonly validator: string;
  readonly appliesTo: string;
  readonly required: boolean;
}

export interface SkillManifest {
  readonly format: typeof SKILL_MANIFEST_FORMAT;
  readonly formatVersion: typeof SKILL_MANIFEST_VERSION;
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly category: 'method' | 'operational' | 'professional';
  readonly owner: string;
  readonly activation: readonly string[];
  readonly standDown: readonly string[];
  readonly interactionClasses: readonly InteractionClass[];
  readonly outcomes: readonly string[];
  readonly deliverableTypes: readonly string[];
  readonly inputs: readonly string[];
  readonly outputSchemas: readonly string[];
  readonly requiredSourceTypes: readonly string[];
  readonly minimumEvidence: string;
  readonly capabilities: readonly CapabilityName[];
  readonly actionTiers: readonly ActionTier[];
  readonly skillDependencies: readonly VersionedDependency[];
  readonly workflowDependencies: readonly VersionedDependency[];
  readonly qualityGates: readonly QualityGate[];
  readonly escalation: readonly string[];
  readonly licensedReviewBoundaries: readonly string[];
  readonly observedOn: readonly { readonly host: string; readonly model: string; readonly note: string }[];
  readonly evals: readonly string[];
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

export interface WorkflowManifest {
  readonly format: typeof WORKFLOW_MANIFEST_FORMAT;
  readonly formatVersion: typeof WORKFLOW_MANIFEST_VERSION;
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly purpose: string;
  readonly activation: readonly string[];
  readonly standDown: readonly string[];
  readonly interactionClass: InteractionClass;
  readonly inputSchema: Readonly<Record<string, 'string' | 'number' | 'boolean' | 'string[]' | 'object'>>;
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
  readonly evals: readonly string[];
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
  readonly manifest: WorkflowManifest;
  readonly origin: BundleOrigin;
  readonly dir: string;
  readonly digest: string;
  readonly files: readonly string[];
}
