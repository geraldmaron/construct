/**
 * kernel/capabilities/postconditions.ts — hard binary postconditions per
 * producer role. Ported from construct-legacy lib/capabilities/postconditions.mjs.
 *
 * A brief carries postconditions for documentation purposes. This module adds
 * binary, programmatically-validated assertions that a producer's output packet
 * must satisfy before a handoff is allowed to proceed. Rules are pure functions
 * of the packet — no IO, no model calls — so they're deterministic and cheap.
 *
 * Two deliberate differences from the source:
 *   - It reports, it does not throw. v2's module already only returned a result
 *     object (the ContractViolationError/BLOCKED_CONTRACT throw lived in the
 *     dispatcher that called it); saying so here keeps the kernel boundary
 *     honest — deciding what a failure *means* is the host's job.
 *   - Rule ids are carried over verbatim — they are what already-logged
 *     violations are keyed by, so renaming one orphans its history. Packet
 *     FIELD names are not: v2's `contractStart` is `briefStart` here, because
 *     the field is a v3 surface and the glossary binds every surface. The
 *     behavior lock covers the rules, not v2's spelling of its inputs.
 *
 * Producers covered:
 *   reviewer   — prevents silent rubber-stamp reviews
 *   security   — prevents post-hoc threat models
 *   debugger   — prevents symptom-only fixes
 *   operations — prevents stale-doc PRs (v2's docs-keeper, folded in)
 *   designer   — prevents post-hoc accessibility review
 */

const ROOT_CAUSE_SOURCES = new Set(['reproduction', 'trace', 'test']);

export interface PostconditionRule {
  /** Stable identifier — violations are logged and grepped by this. */
  readonly id: string;
  readonly description: string;
  /** True when the packet satisfies the rule. */
  check(packet: unknown): boolean;
  readonly reason: string;
}

export interface PostconditionFailure {
  readonly id: string;
  readonly reason: string;
}

export interface PostconditionResult {
  readonly ok: boolean;
  readonly producer: string;
  readonly failures: readonly PostconditionFailure[];
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLaterOrEqual(a: unknown, b: unknown): boolean {
  const ta = a instanceof Date ? a.getTime() : Date.parse(String(a));
  const tb = b instanceof Date ? b.getTime() : Date.parse(String(b));
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return false;
  return ta >= tb;
}

/** Field reads go through this so a rule stays total on an arbitrary packet. */
function field(packet: unknown, key: string): unknown {
  if (!packet || typeof packet !== 'object') return undefined;
  return (packet as Record<string, unknown>)[key];
}

export const POSTCONDITIONS: Readonly<Record<string, readonly PostconditionRule[]>> = {
  reviewer: [
    {
      id: 'reviewer.findings-or-explicit-clear',
      description:
        'Reviewer must either return at least one finding or explicitly state "no issues found at: <paths>".',
      check: (p) =>
        isNonEmptyArray(field(p, 'findings')) ||
        isNonEmptyArray(field(p, 'noIssuesFoundAt')) ||
        isNonEmptyString(field(p, 'noIssuesFoundStatement')),
      reason:
        'Reviewer output rubber-stamped: empty findings and no explicit "no issues found at: <paths>" statement.',
    },
  ],
  security: [
    {
      id: 'security.threat-model-not-post-hoc',
      description:
        'Threat model must be updated at or after the brief start (not retrofitted).',
      check: (p) => {
        const updatedAt = field(p, 'threatModelUpdatedAt');
        const start = field(p, 'briefStart');
        if (!updatedAt || !start) return false;
        return isLaterOrEqual(updatedAt, start);
      },
      reason:
        'Threat model missing or older than the brief start — likely retrofitted after implementation.',
    },
  ],
  debugger: [
    {
      id: 'debugger.root-cause-confirmed-via',
      description:
        'Root cause must be confirmed via reproduction, trace, or test (not inferred).',
      check: (p) => {
        const via = field(p, 'rootCauseConfirmedVia');
        return typeof via === 'string' && ROOT_CAUSE_SOURCES.has(via);
      },
      reason: `rootCauseConfirmedVia must be one of: ${[...ROOT_CAUSE_SOURCES].join(', ')}.`,
    },
  ],
  operations: [
    {
      id: 'docs-keeper.cross-doc-coherence-check-ran',
      description:
        'Operations must run the cross-doc coherence check and attach a named diff.',
      check: (p) =>
        field(p, 'crossDocCoherenceCheckRan') === true && isNonEmptyString(field(p, 'coherenceDiff')),
      reason:
        'crossDocCoherenceCheckRan must be true AND coherenceDiff must be a non-empty named diff.',
    },
  ],
  designer: [
    {
      id: 'designer.accessibility-check-ran',
      description: 'Designer must run the accessibility check before handoff (no post-hoc a11y).',
      check: (p) => field(p, 'accessibilityCheckRan') === true,
      reason:
        'accessibilityCheckRan must be true — accessibility review is a precondition for any visual deliverable.',
    },
  ],
};

/**
 * Evaluate the binary postcondition rules for a producer's output packet. A
 * producer with no registered rules passes vacuously — the same open-world
 * default the source had, so adding a role never retroactively blocks it.
 */
export function validateBinaryPostconditions(
  producer: string,
  packet: unknown,
): PostconditionResult {
  const rules = POSTCONDITIONS[producer] ?? [];
  if (rules.length === 0) return { ok: true, producer, failures: [] };
  const failures: PostconditionFailure[] = [];
  for (const rule of rules) {
    let satisfied: boolean;
    try {
      satisfied = rule.check(packet);
    } catch {
      // A rule that throws on a malformed packet counts as unsatisfied, never
      // as an escape hatch past the check.
      satisfied = false;
    }
    if (!satisfied) failures.push({ id: rule.id, reason: rule.reason });
  }
  return { ok: failures.length === 0, producer, failures };
}

/** List the rule ids registered for a producer — for tests and for surfacing what a role must produce. */
export function describePostconditions(
  producer: string,
): readonly { id: string; description: string }[] {
  return (POSTCONDITIONS[producer] ?? []).map((r) => ({ id: r.id, description: r.description }));
}
