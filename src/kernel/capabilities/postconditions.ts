/**
 * kernel/capabilities/postconditions.ts — hard binary postconditions per
 * producer role.
 *
 * A brief carries postconditions for documentation purposes. This module adds
 * binary, programmatically-validated assertions that a producer's output packet
 * must satisfy before a handoff is allowed to proceed. Rules are pure functions
 * of the packet — no IO, no model calls — so they're deterministic and cheap.
 *
 * It reports, it does not throw: deciding what a failure *means* is the host's
 * job, and the kernel boundary stays honest by returning a result rather than
 * raising.
 *
 * A producer is a role a dispatch can actually emit, which in this kernel means
 * a domain in the catalog. A rule keyed to anything else can never fire on a
 * real brief, and — worse — a rule keyed to a name that LOOKS like a domain
 * silently attaches itself to that domain's briefs through
 * `describePostconditions`. Registrations are therefore keyed to catalog domain
 * names and to nothing else; a pack that wants a rule ships it with the pack.
 *
 * The registry is caller-replaceable for the same reason the domain catalog is:
 * a workspace carries its own without forking the kernel.
 */

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

/** Field reads go through this so a rule stays total on an arbitrary packet. */
export function packetField(packet: unknown, key: string): unknown {
  if (!packet || typeof packet !== 'object') return undefined;
  return (packet as Record<string, unknown>)[key];
}

/**
 * No rules ship registered today. The five that used to live here were keyed to
 * predecessor role names (reviewer, debugger, and three that collided with real
 * or planned catalog domains), so they attached themselves to briefs whose
 * packets could never carry the fields they demanded. A pack that needs a
 * binary rule registers it with the pack, keyed to the domain it dispatches as.
 */
export const POSTCONDITIONS: Readonly<Record<string, readonly PostconditionRule[]>> = {};

/**
 * Evaluate the binary postcondition rules for a producer's output packet. A
 * producer with no registered rules passes vacuously — an open-world default,
 * so adding a role never retroactively blocks it.
 */
export function validateBinaryPostconditions(
  producer: string,
  packet: unknown,
  registry: Readonly<Record<string, readonly PostconditionRule[]>> = POSTCONDITIONS,
): PostconditionResult {
  const rules = registry[producer] ?? [];
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
  registry: Readonly<Record<string, readonly PostconditionRule[]>> = POSTCONDITIONS,
): readonly { id: string; description: string }[] {
  return (registry[producer] ?? []).map((r) => ({ id: r.id, description: r.description }));
}
