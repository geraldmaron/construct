/**
 * kernel/tracker/crossing.ts — the shape an approved write proposal takes when
 * it is bound for the user's own tracker.
 *
 * Seat mode's whole posture is propose, never done: Construct fills one role
 * on a human team, and the team's tracker — not Construct's store — is where
 * work lives. An approved proposal crossing into that tracker is therefore a
 * projection event, and the mirror substrate (field authority, the projection
 * record, the persisted mirror table) is what makes the crossing auditable
 * later: what Construct asserted, distinct from what the tracker owns.
 *
 * This module owns the pure half: which source kinds are trackers, and the
 * issue-shaped record a proposal projects as. The record carries only what
 * the domain side may assert under the authority map — a title and a
 * description. Live state (status, assignee, priority) is the tracker's even
 * at creation: projecting a status would be Construct claiming authority over
 * a field the reconciliation rule says it must never overwrite, on the row's
 * very first write.
 *
 * The description carries the approved words verbatim, with the justification
 * they were approved on. The title is the change's first line — a view for a
 * tracker list, never a rewrite; anyone auditing the crossing reads the
 * description.
 */

export const TRACKER_SOURCE_KINDS = ['github', 'jira'] as const;

export function isTrackerSourceKind(kind: string): boolean {
  return (TRACKER_SOURCE_KINDS as readonly string[]).includes(kind);
}

export interface CrossingProposal {
  readonly id: string;
  readonly change: string;
  readonly justification: string;
}

/** How much of the change's first line a tracker list gets before an ellipsis. */
const TITLE_CAP = 120;

/**
 * The issue record a proposal projects as: identity plus the two fields the
 * domain owns. Every non-identity field here must be domain-owned under
 * kernel/tracker/authority.ts, and a test holds that by asking the authority
 * map rather than repeating the list.
 */
export function proposalIssue(proposal: CrossingProposal): Record<string, unknown> {
  const change = proposal.change.trim();
  const firstLine = (change.split('\n', 1)[0] ?? '').trim();
  return {
    id: proposal.id,
    title: firstLine.length > TITLE_CAP ? `${firstLine.slice(0, TITLE_CAP - 1)}…` : firstLine,
    description: `${change}\n\nWhy: ${proposal.justification}`,
  };
}
