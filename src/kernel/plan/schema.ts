/**
 * kernel/plan/schema.ts — the shape of a plan: one structured, recorded pass
 * over the outcome plus declared sources, produced before any role works.
 *
 * A plan is not advice; it is the run's stated understanding, its risk tier,
 * its decomposition, and its routing, each element carrying the provenance
 * that justifies it. Sufficiency is structural: a deliverable template names the
 * slots a deliverable must fill, and an empty slot is a machine-checkable
 * information gap with a defined acquisition ladder — never a stall.
 *
 * Provenance discipline: a plan element cites either a declared source (by
 * source id) or the domain catalog (by domain name). A citation matching
 * neither is fabricated provenance; the planner discards the element and says
 * so in the plan record. That is the one hard gate. Everything softer —
 * whether the decomposition was wise, whether the routing fit — is steered by
 * the verdict corpus, not rejected structurally.
 */

import type { EngagementMode } from '../store/sources.ts';

/** Where a plan element's justification points. */
export type Citation =
  | { readonly kind: 'source'; readonly source: string }
  | { readonly kind: 'catalog'; readonly domain: string };

/**
 * The staged process every role playbook follows. The stages are a shared
 * vocabulary, not a state machine: a step names the stage it starts in, and
 * later stages are the role's obligation, not separate tasks.
 */
export const PLAYBOOK_STAGES = ['discover', 'research', 'clarify', 'draft', 'review'] as const;

export type PlaybookStage = (typeof PLAYBOOK_STAGES)[number];

/**
 * A required field of a deliverable template. Empty means the information is
 * missing, and missing is a gap the acquisition ladder resolves — it is never
 * grounds for refusing to draft.
 */
export interface Slot {
  readonly name: string;
  /** What belongs here, in words a person can audit. */
  readonly expects: string;
  readonly required: boolean;
}

/**
 * How the body under a template's slots is shaped.
 *
 * `issues` is issue-spotting: numbered issues, each with a resolving step and
 * an owner. `document` is everything else — a PRD, a strategy review, a plan —
 * and fills the same slots as prose, tables, and diagrams. The form is data
 * on the template so a role writing a requirements document is not also told
 * to number issues on every page, which is how every deliverable used to
 * collapse into the same list.
 */
export type DeliverableForm = 'issues' | 'document';

/** The deliverable a role's playbook produces, with the slots that make sufficiency checkable. */
export interface DeliverableTemplate {
  readonly deliverable: string;
  readonly form: DeliverableForm;
  readonly slots: readonly Slot[];
}

/**
 * The acquisition ladder, in order. A gap climbs: read the declared sources,
 * research beyond them, ask the human (batched to the inbox, always with an
 * assumed default so the draft never blocks), and finally assume-and-label.
 * Every rung produces a draft; no rung produces a stall.
 */
export const ACQUISITION_LADDER = [
  'read-sources',
  'research',
  'ask-human',
  'assume-and-label',
] as const;

export type AcquisitionRung = (typeof ACQUISITION_LADDER)[number];

/** One step of the decomposition, routed to a role playbook. */
export interface PlanStep {
  readonly id: string;
  readonly description: string;
  /** The domain (role) this step routes to, from the catalog. */
  readonly domain: string;
  /** The stage the step enters the playbook at. */
  readonly stage: PlaybookStage;
  readonly deliverable: DeliverableTemplate;
  /** Ids of steps that must settle first. Empty means the step can start at once. */
  readonly after: readonly string[];
  readonly citations: readonly Citation[];
}

/**
 * How a step's routing was reached. The namer is primary; the keyword
 * dispatcher is the frozen lexical fallback and is labeled as exactly that
 * wherever it decided.
 */
export type RoutedBy = 'namer' | 'lexical-fallback' | 'user';

export interface PlanRouting {
  readonly step: string;
  readonly domain: string;
  readonly routedBy: RoutedBy;
  /** The evidence: namer's reason, the keywords that fired, or the user's words. */
  readonly evidence: readonly string[];
}

/** A plan element the planner refused to keep, and the reason said aloud. */
export interface DiscardedElement {
  readonly description: string;
  readonly reason: string;
}

/**
 * The plan: one recorded deliverable per run. Understanding absorbs the densified
 * intake — there is no separate densification pass once a plan exists.
 */
export interface Plan {
  readonly id: string;
  readonly run: string;
  readonly outcome: string;
  /** The run's understanding: constraints, prior decisions, parked tangents. */
  readonly understanding: {
    readonly restated: string;
    readonly constraints: readonly string[];
    readonly decisions: readonly string[];
    readonly parked: readonly string[];
  };
  /** Worst tier across implicated domains; an unknown domain is high. */
  readonly riskTier: 'low' | 'high';
  /**
   * The workspace whose sources, mode, and lessons this plan was built from.
   * Recorded because everything below is only interpretable against it: "no
   * sources declared" on the wrong workspace reads identically to the right
   * one, and the dispatch reads the workspace's memory through this field.
   */
  readonly workspace: string;
  readonly mode: EngagementMode;
  readonly steps: readonly PlanStep[];
  readonly routing: readonly PlanRouting[];
  /** What the planner discarded for fabricated provenance, said aloud. */
  readonly discarded: readonly DiscardedElement[];
  /** Source ids declared on the workspace at plan time. Declared, not read: whether a run read them is the source_reads record, never this field. */
  readonly sourcesDeclared: readonly string[];
  readonly plannedAt: string;
}
