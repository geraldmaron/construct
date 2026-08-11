/**
 * kernel/hosts/interface.ts — the host adapter seam: the abstract interface
 * every host adapter must satisfy, plus its validator. Ported from the
 * predecessor's runtime-adapter interface (construct-legacy
 * lib/runtime/.../interface.mjs).
 *
 * A "host" is anything Construct hands work to and reads a result back from:
 * an in-process handler, a coding-agent CLI, an ACP-speaking agent, or a future
 * replacement. Conforming adapters are interchangeable to their callers — that
 * is the whole point of the seam, and why the kernel defines the shape but
 * ships no adapter: an adapter is by definition host-coupled and belongs
 * outside the kernel boundary.
 *
 * Required surface (every adapter, regardless of declared capabilities):
 *   name          non-empty string, unique per adapter instance
 *   kind          non-empty string; recommended values: 'general', 'coding'
 *   capabilities  drawn from CAPABILITIES; declares OPTIONAL behavior beyond
 *                 the mandatory base. 'interrupt' means cancel() can actually
 *                 stop in-flight work; its absence means cancel() is a safe
 *                 no-op, not a missing method — some real transports (a
 *                 blocking spawnSync, say) genuinely cannot be interrupted once
 *                 started, and the interface requires that limitation be
 *                 declared, not hidden.
 *   init(config)  async setup; must run before invoke()/health() are valid
 *   invoke(req, ctx) async; runs one unit of work and resolves a HostResult.
 *                 ctx may carry an invocationId chosen by the caller — an
 *                 adapter must honor a supplied id so cancel(invocationId) can
 *                 target a call before it settles.
 *   health()      async liveness probe
 *   cancel(id)    async; always present, always resolves, never throws. An
 *                 adapter's authority to stop in-flight work is declared via
 *                 'interrupt', not assumed.
 *
 * validate() is intentionally structural (shape, not behavior): it is the cheap
 * gate a registry runs at registration time. Proving an adapter actually
 * *honors* the interface is the conformance suite's job, not this function's.
 */

import type { ModelTier } from '../brief/tiers.ts';

export const CAPABILITIES = ['interrupt', 'stream', 'sandbox', 'concurrent'] as const;

export type HostCapability = (typeof CAPABILITIES)[number];

export type HostStatus = 'ok' | 'error' | 'cancelled';

export interface HostResult {
  readonly id: string;
  readonly status: HostStatus;
  readonly output: unknown;
  readonly error: unknown;
}

export interface HostContext {
  /** Caller-chosen id; an adapter must honor it so cancel() can target the call. */
  readonly invocationId?: string;
  readonly [key: string]: unknown;
}

export interface HostHealth {
  readonly live: boolean;
  readonly detail?: string;
}

export interface HostCancellation {
  readonly cancelled: boolean;
  readonly reason?: string;
}

export interface HostAdapter {
  readonly name: string;
  readonly kind: string;
  readonly capabilities: readonly HostCapability[];
  init(config?: unknown): Promise<void>;
  invoke(request: unknown, context?: HostContext): Promise<HostResult>;
  health(): Promise<HostHealth>;
  cancel(invocationId: string): Promise<HostCancellation>;

  /**
   * The concrete model this adapter will run, if it can say. Recorded on every
   * task so a claim about what a run demonstrated is qualified by what actually
   * ran.
   */
  readonly model?: string | null;

  /**
   * How long this adapter will wait for one invocation before abandoning it.
   *
   * Declared rather than assumed: a caller that reports a timeout without being
   * able to say what the limit was, or that sets a lease against a limit it
   * guessed at, is describing a wall it cannot see. Optional, and absence means
   * the adapter will not say — not that it waits forever.
   */
  readonly invocationTimeoutMs?: number;

  /**
   * Which capability tier `model` (or the adapter's default) sits at.
   *
   * Optional, and its absence is meaningful rather than neutral: a brief
   * declaring a floor above `any` is recorded as degraded when the host will not
   * say, because silence is not compliance. Tier membership lives here, next to
   * each adapter's pin, precisely so the kernel never learns a vendor's model
   * names — it compares ordinals and nothing else.
   */
  modelTier?(model?: string): ModelTier | null;

  /**
   * Whether `model` (or the adapter's default) belongs to a tuned family —
   * one whose producer prompts are validated against its output shapes with
   * eval evidence on record. Family membership is read off vendor model
   * strings, so it lives host-side like tier membership; the kernel only
   * relays the answer. An untuned or silent answer means the dispatch runs
   * best-effort and is recorded as exactly that.
   */
  modelTuning?(model?: string): ModelTuning | null;
}

/** A host's answer about tuning evidence for a model. */
export interface ModelTuning {
  /** The tuned family the model belongs to, or null when none matches. */
  readonly family: string | null;
  readonly tuned: boolean;
}

export interface HostValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const REQUIRED_METHODS = ['init', 'invoke', 'health', 'cancel'] as const;

/**
 * Validate a host adapter against this interface. Structural only —
 * see the module note. Returns every error rather than the first, so a new
 * adapter author fixes one round of problems, not one problem per round.
 */
export function validate(host: unknown): HostValidation {
  const errors: string[] = [];

  if (!host || typeof host !== 'object') {
    return { valid: false, errors: ['Host must be a non-null object'] };
  }
  const h = host as Record<string, unknown>;

  if (typeof h.name !== 'string' || !h.name) {
    errors.push('Host must have a non-empty string "name"');
  }
  if (typeof h.kind !== 'string' || !h.kind) {
    errors.push('Host must have a non-empty string "kind"');
  }
  if (!Array.isArray(h.capabilities)) {
    errors.push('Host must declare "capabilities" as an array');
  } else {
    for (const cap of h.capabilities) {
      if (!(CAPABILITIES as readonly unknown[]).includes(cap)) {
        errors.push(`Unknown capability "${String(cap)}". Valid: ${CAPABILITIES.join(', ')}`);
      }
    }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof h[method] !== 'function') {
      errors.push(`Host must implement ${method}()`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Check whether a host declares a given capability. */
export function hasCapability(host: unknown, capability: string): boolean {
  const caps = (host as { capabilities?: unknown } | null)?.capabilities;
  return Array.isArray(caps) && caps.includes(capability);
}
