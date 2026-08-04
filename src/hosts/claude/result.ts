/**
 * hosts/claude/result.ts — reduce one `claude -p --output-format json`
 * envelope to what the kernel consumes. The counterpart of
 * hosts/opencode/events.ts for a host that reports a single result object
 * instead of an event stream.
 *
 * Everything here reads defensively off fixtures captured from the real
 * binary (tests/hosts/claude/fixtures/), because the transcript-shaped
 * assumptions that were never captured are the ones that turn out wrong —
 * capturing OpenCode's corrected two of them, and capturing this host's
 * immediately surfaced the silent model fallback pin.ts records.
 */

export interface ClaudeUsage {
  /** total_cost_usd — a real number on this host; the ceiling binds. */
  readonly cost: number;
  /** num_turns; spendOf() treats zero-step usage as unmeasured, so it matters. */
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ClaudeEnvelope {
  readonly text: string;
  readonly sessionId: string | null;
  readonly subtype: string;
  readonly isError: boolean;
  readonly stopReason: string | null;
  readonly usage: ClaudeUsage;
  /** modelUsage keys: the models that actually served this run. */
  readonly modelsRan: readonly string[];
  /** Tool uses the permission system refused. */
  readonly permissionDenials: readonly unknown[];
}

/**
 * Parse the envelope, or return null for output that is not one. Null is a
 * distinct answer from an error envelope: it means the host did not speak the
 * pinned format at all, which is version-drift territory, not a failed run.
 */
export function reduceEnvelope(stdout: string): ClaudeEnvelope | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'result') return null;

  const usage = (parsed.usage ?? {}) as Record<string, unknown>;
  const modelUsage = (parsed.modelUsage ?? {}) as Record<string, unknown>;

  const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

  return {
    text: typeof parsed.result === 'string' ? parsed.result : '',
    sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : null,
    subtype: typeof parsed.subtype === 'string' ? parsed.subtype : 'unknown',
    isError: parsed.is_error === true,
    stopReason: typeof parsed.stop_reason === 'string' ? parsed.stop_reason : null,
    usage: {
      cost: number(parsed.total_cost_usd),
      steps: number(parsed.num_turns),
      inputTokens: number(usage.input_tokens),
      outputTokens: number(usage.output_tokens),
    },
    modelsRan: Object.keys(modelUsage),
    permissionDenials: Array.isArray(parsed.permission_denials) ? parsed.permission_denials : [],
  };
}

/**
 * Did the model the caller asked for actually serve the run? Inclusion rather
 * than equality, because the CLI accepts aliases: a request for "haiku" is
 * honored by "claude-haiku-4-5-20251001". An empty request is never drift —
 * the caller delegated the choice.
 */
export function modelDrifted(requested: string | undefined, ran: readonly string[]): boolean {
  if (!requested) return false;
  if (ran.length === 0) return false;
  return !ran.some((model) => model.includes(requested) || requested.includes(model));
}
