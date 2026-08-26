/**
 * kernel/plan/planner.ts — one planning pass over the outcome plus declared
 * sources, producing the structured plan Rung 1 promises: understanding,
 * run-level risk tier from the catalog, decomposition into steps, routing to
 * role playbooks, and sequencing.
 *
 * The planner is deterministic assembly, not model consultation. The
 * judgment-bearing inputs — which domains the outcome implicates, and how that
 * inference was reached — arrive already made (the namer is primary; the
 * keyword dispatcher is the frozen lexical fallback, labeled as exactly that
 * in the routing it decided). What this module owns is putting those inputs
 * into one recorded shape and enforcing the single hard gate: a plan element
 * whose citation names a source nobody declared or a domain the catalog does
 * not carry is fabricating provenance, so it is discarded and the discard is
 * said aloud in the plan. Nothing softer is rejected here; plan quality is
 * steered by the verdict corpus.
 */

import type { DensifiedIntake } from '../intake/densify.ts';
import type { Implication } from '../implication/map.ts';
import type { InferredBy } from '../implication/naming.ts';
import { domainsByName } from '../implication/domains.ts';
import { riskTierFor } from '../lessons/admission.ts';
import type { EngagementMode, Source } from '../store/sources.ts';
import { playbookFor } from './playbooks.ts';
import type { Citation, DiscardedElement, Plan, PlanRouting, PlanStep, RoutedBy } from './schema.ts';

export interface PlanInput {
  readonly id: string;
  readonly run: string;
  readonly outcome: string;
  /** Densification's output, absorbed here; null when no densifier ran. */
  readonly densified: DensifiedIntake | null;
  readonly implicated: readonly Implication[];
  readonly inferredBy: InferredBy;
  readonly sources: readonly Source[];
  readonly workspace: string;
  readonly mode: EngagementMode;
  readonly plannedAt: string;
}

/** How the run's inference method reads as a routing label. */
function routedByFrom(inferredBy: InferredBy): RoutedBy {
  switch (inferredBy) {
    case 'namer':
    case 'cache':
      return 'namer';
    case 'session':
      return 'session';
    case 'user':
      return 'user';
    default:
      // 'keywords' and 'none' both mean the namer did not decide: the frozen
      // lexical dispatcher did, or nothing fired at all.
      return 'lexical-fallback';
  }
}

/**
 * Keep only citations that point at something real: a declared source or a
 * catalog domain. Returns the survivors and a discard description for each
 * fabrication, because a silent discard would hide exactly the failure the
 * gate exists to expose.
 */
export function vetCitations(
  citations: readonly Citation[],
  sources: readonly Source[],
): { kept: Citation[]; discarded: DiscardedElement[] } {
  const declared = new Set(sources.map((s) => s.id));
  const catalog = domainsByName();
  const kept: Citation[] = [];
  const discarded: DiscardedElement[] = [];
  for (const citation of citations) {
    if (citation.kind === 'source') {
      if (declared.has(citation.source)) kept.push(citation);
      else {
        discarded.push({
          description: `citation of source ${citation.source}`,
          reason: `no declared source ${citation.source} — fabricated provenance`,
        });
      }
    } else if (catalog.has(citation.domain)) {
      kept.push(citation);
    } else {
      discarded.push({
        description: `citation of catalog domain ${citation.domain}`,
        reason: `the catalog carries no domain ${citation.domain} — fabricated provenance`,
      });
    }
  }
  return { kept, discarded };
}

/**
 * Build the plan. One step per implicated domain, sequenced by risk: high-tier
 * steps run first so what needs a licensed eye or careful handling is seen
 * before low-tier work builds on top of it; ties keep implication order
 * (strongest signal first), which is already the routing's own ranking.
 */
export function buildPlan(input: PlanInput): Plan {
  const routedBy = routedByFrom(input.inferredBy);
  const discarded: DiscardedElement[] = [];

  const ordered = [...input.implicated].sort((a, b) => {
    const tierA = riskTierFor(a.domain) === 'high' ? 0 : 1;
    const tierB = riskTierFor(b.domain) === 'high' ? 0 : 1;
    if (tierA !== tierB) return tierA - tierB;
    return input.implicated.indexOf(a) - input.implicated.indexOf(b);
  });

  const steps: PlanStep[] = [];
  const routing: PlanRouting[] = [];
  let previous: string | null = null;
  for (const [index, implication] of ordered.entries()) {
    const id = `${input.id}-step-${index + 1}`;
    const playbook = playbookFor(implication.domain);
    const raw: Citation[] = [
      { kind: 'catalog', domain: implication.domain },
      ...input.sources.map((s): Citation => ({ kind: 'source', source: s.id })),
    ];
    const vetted = vetCitations(raw, input.sources);
    discarded.push(...vetted.discarded);
    steps.push({
      id,
      description: `${playbook.template.deliverable} for this outcome from the ${implication.domain} concern`,
      domain: implication.domain,
      stage: 'discover',
      deliverable: playbook.template,
      // High-tier steps gate what follows; low-tier steps chain so the run
      // reads as one sequence a person can audit, not a fan-out.
      after: previous ? [previous] : [],
      citations: vetted.kept,
    });
    routing.push({
      step: id,
      domain: implication.domain,
      routedBy,
      evidence: implication.signals,
    });
    previous = id;
  }

  const understanding = input.densified
    ? {
        restated: input.densified.outcome,
        constraints: input.densified.constraints,
        decisions: input.densified.decisions,
        parked: input.densified.parked,
      }
    : { restated: input.outcome, constraints: [], decisions: [], parked: [] };

  const riskTier = ordered.some((i) => riskTierFor(i.domain) === 'high') ? 'high' : 'low';

  return {
    id: input.id,
    run: input.run,
    outcome: input.outcome,
    understanding,
    // Nothing implicated is not safety — it means routing saw nothing, and an
    // unseen outcome is exactly the unknown the catalog rates high.
    riskTier: ordered.length === 0 ? 'high' : riskTier,
    workspace: input.workspace,
    mode: input.mode,
    steps,
    routing,
    discarded,
    sourcesDeclared: input.sources.map((s) => s.id),
    plannedAt: input.plannedAt,
  };
}
