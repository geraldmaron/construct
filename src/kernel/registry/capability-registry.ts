/**
 * kernel/registry/capability-registry.ts — the capabilities a step may
 * require, and the handshake that says which of them a host or connector
 * actually provides right now. Names describe what can be done, never a
 * tool or a binary.
 */

import type { ActionTier } from '../state/steps.ts';
import type { CapabilityDeclaration, CapabilityName } from './models.ts';

export const BUILTIN_CAPABILITIES: readonly CapabilityDeclaration[] = Object.freeze([
  { name: 'read_project_files', description: 'Read files inside the project root.', tier: 'observe', kind: 'read' },
  { name: 'read_project_context', description: 'Read Construct’s own context: constitution, sources, claims, runs.', tier: 'observe', kind: 'read' },
  { name: 'read_source', description: 'Read a declared source of a given kind (scope: the kind).', tier: 'observe', kind: 'read' },
  { name: 'write_project_files', description: 'Change files inside the project root, reversibly.', tier: 'project_write', kind: 'write' },
  { name: 'write_project_context', description: 'Record statements, claims, decisions, lessons in Construct state.', tier: 'project_write', kind: 'write' },
  { name: 'write_source', description: 'Change an external system through a declared source (scope: the kind).', tier: 'external_write', kind: 'write' },
  { name: 'run_validator', description: 'Run a deterministic validator over a step output (scope: the validator).', tier: 'observe', kind: 'validator' },
  { name: 'model_review', description: 'Ask the session’s model to review with an explicit input and output schema.', tier: 'draft', kind: 'review' },
  { name: 'ask_user', description: 'Raise a decision or clarification to the person and wait.', tier: 'observe', kind: 'interaction' },
  { name: 'run_tests', description: 'Run the project’s own test command and read the result.', tier: 'observe', kind: 'validator' },
  { name: 'kernel', description: 'A deterministic check Construct runs itself when the step is reached (scope: drift_detect).', tier: 'observe', kind: 'validator' },
]);

export const BUILTIN_VALIDATORS: readonly string[] = Object.freeze([
  'schema',
  'citations_present',
  'no_uncited_material_findings',
  'deliverable_complete',
  'constitution_shape',
  'no_velocity_as_capacity',
  'evidence_refs_resolve',
]);

export function capabilityDeclaration(name: CapabilityName): CapabilityDeclaration | null {
  const base = name.includes(':') ? name.slice(0, name.indexOf(':')) : name;
  return BUILTIN_CAPABILITIES.find((c) => c.name === base) ?? null;
}

export function isKnownCapability(name: CapabilityName): boolean {
  return capabilityDeclaration(name) !== null;
}

export function isKnownValidator(name: string): boolean {
  return BUILTIN_VALIDATORS.includes(name);
}

/** What the current host, session, and connectors can actually do. */
export interface HostCapabilities {
  readonly hostId: string;
  readonly sessionId: string | null;
  readonly executorId: string;
  /** Capability names available, with scope where relevant (read_source:jira). */
  readonly available: ReadonlySet<CapabilityName>;
  /** Tiers this executor may reach at most, before grants. */
  readonly maxTier: ActionTier;
  readonly restrictions: readonly string[];
  readonly budgetCents: number | null;
}

/** Whether a required capability is provided, honoring scope: `read_source:jira` needs that exact scope or the unscoped name. */
export function provides(host: HostCapabilities, required: CapabilityName): boolean {
  if (host.available.has(required)) return true;
  const base = required.includes(':') ? required.slice(0, required.indexOf(':')) : required;
  return host.available.has(base);
}
