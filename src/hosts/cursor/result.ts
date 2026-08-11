/**
 * hosts/cursor/result.ts — reduce one `cursor-agent -p --output-format json`
 * envelope to what the kernel consumes. Shaped like hosts/claude/result.ts
 * because the host speaks a near-identical single-envelope format; the
 * differences (camelCase token counts, no cost, no model usage map) are the
 * host's and are pinned as expectations.
 *
 * Everything here reads defensively off envelopes captured from the real
 * binary on the pinned version.
 */

export interface CursorUsage {
  /**
   * Always zero: the envelope reports token counts and no cost field, and a
   * subscription login has no per-run price. Together with zero steps this
   * reads downstream as unmeasured, never as free.
   */
  readonly cost: number;
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CursorEnvelope {
  readonly text: string;
  readonly sessionId: string | null;
  readonly subtype: string;
  readonly isError: boolean;
  readonly usage: CursorUsage;
}

/**
 * Parse the envelope, or return null for output that is not one. Null is a
 * distinct answer from an error envelope: it means the host did not speak
 * the pinned format at all, which is version-drift territory, not a failed
 * run.
 */
export function reduceEnvelope(stdout: string): CursorEnvelope | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.type !== 'result') return null;

  const usage = (parsed.usage ?? {}) as Record<string, unknown>;
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  return {
    text: typeof parsed.result === 'string' ? parsed.result : '',
    sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : null,
    subtype: typeof parsed.subtype === 'string' ? parsed.subtype : 'unknown',
    isError: parsed.is_error === true,
    usage: {
      cost: 0,
      steps: 0,
      inputTokens: number(usage.inputTokens),
      outputTokens: number(usage.outputTokens),
    },
  };
}
