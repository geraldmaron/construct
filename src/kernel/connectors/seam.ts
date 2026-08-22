/**
 * kernel/connectors/seam.ts — the interfaces a defined API connector must
 * satisfy, and nothing else. No connector lives here, and no connector may
 * ever be imported here: this module is what a connector implements, read
 * from the outside in, the same way a host adapter implements
 * `ProposalApplier` without the kernel ever importing a host.
 *
 * See docs/internal/connector-seam-design.md for the design decision this seam
 * exists to carry out — the adversarial pass, the alternative it was
 * weighed against, and the reasoning behind the two properties this module
 * is small enough to be:
 *
 *   - A connector produces exactly what a host adapter already produces:
 *     a `SourceSurvey` for a read (kernel/run/sourcereads.ts), an
 *     `ApplyReport` for a write (kernel/run/apply.ts). There is no
 *     connector-specific record shape, because inventing one would be a
 *     second kind of evidence the kernel has to learn to read.
 *   - What a connector adds that a host's own report does not carry on its
 *     own is that its record is `witnessed` rather than `reported` — built
 *     by code that ran, not relayed from a claim a model made about
 *     running. `choosePath` is the one piece of decision logic this module
 *     owns, and it is pure: given what is actually available, which rung
 *     of the licensed ladder answers, and what evidence class that rung's
 *     answer carries.
 */

import type { SourceSurvey } from '../run/sourcereads.ts';
import type { ApplyReport } from '../run/apply.ts';
import type { WriteProposal } from '../store/sources.ts';

/**
 * Whose account a record rests on. `witnessed` means the code that
 * constructed the record ran and can show its work — a connector's own
 * fetch, a receipt with an id or a URL a reader could open. `reported`
 * means the kernel is relaying a claim it cannot itself verify — a host's
 * or a model's telling, however honestly stated. Neither is a judgment
 * about honesty; a host's report is real evidence and stays reported
 * evidence, not because it is doubted but because a reader deciding how
 * much weight to put on it needs to know which kind they are holding.
 */
export type EvidenceClass = 'witnessed' | 'reported';

/** One connector's answer to "what does this source actually hold." */
export type ConnectorRead = (locator: string) => Promise<SourceSurvey>;

/**
 * One connector's answer to "carry out this approved change." Shares its
 * shape with `ProposalApplier` exactly — a connector is one more
 * implementation of the same interface a host adapter satisfies — so
 * `applyProposal` (kernel/run/apply.ts) takes either without knowing which
 * it was handed.
 */
export type ConnectorApply = (proposal: WriteProposal) => Promise<ApplyReport>;

/** Which rung of the licensed ladder actually answered, and why. */
export type PathVerdict =
  | { readonly path: 'host-mcp'; readonly evidence: 'reported'; readonly reason: string }
  | { readonly path: 'connector'; readonly evidence: 'witnessed'; readonly reason: string }
  | { readonly path: 'refused'; readonly evidence: null; readonly reason: string };

/**
 * The ladder, decided: host MCP first when present, a gated connector when
 * one exists and the host cannot carry the work, an honest refusal when
 * neither can. This is authority order, not fidelity order — a host answer
 * outranks a connector's not because it is more trustworthy (it is
 * `reported`; a connector's own answer is `witnessed`) but because presence
 * beats a build cost nobody has paid yet. The evidence class travels with
 * the verdict precisely so that ordering is never mistaken for a trust
 * ranking downstream.
 */
export function choosePath(input: {
  readonly hostMcpAvailable: boolean;
  readonly connectorAvailable: boolean;
}): PathVerdict {
  if (input.hostMcpAvailable) {
    return {
      path: 'host-mcp',
      evidence: 'reported',
      reason: 'a host MCP surface is present and licensed first by the use/build gate',
    };
  }
  if (input.connectorAvailable) {
    return {
      path: 'connector',
      evidence: 'witnessed',
      reason: 'no host MCP surface is present; a gated connector carries the work instead',
    };
  }
  return {
    path: 'refused',
    evidence: null,
    reason: 'no host MCP surface and no connector is present — nothing carries this work',
  };
}
