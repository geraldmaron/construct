/**
 * hosts/codex/result.ts — reduce a `codex exec --json` JSONL stream to what
 * the kernel consumes. The counterpart of hosts/claude/result.ts for a host
 * that reports an event stream instead of a single envelope.
 *
 * Everything here reads defensively off streams captured from the real binary
 * on the pinned version, because transcript-shaped assumptions that were
 * never captured are the ones that turn out wrong — capturing this host's is
 * what surfaced that usage carries tokens and never dollars, and that a
 * failed turn still emits well-formed events before the nonzero exit.
 */

export interface CodexUsage {
  /**
   * Always zero: the stream reports token counts and no cost field, and a
   * subscription login has no per-run price to report. Together with zero
   * steps this reads downstream as unmeasured, never as free.
   */
  readonly cost: number;
  readonly steps: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CodexStream {
  /** The final agent message, empty when no agent_message item completed. */
  readonly text: string;
  readonly threadId: string | null;
  /** Whether a turn.completed event arrived. */
  readonly completed: boolean;
  /** turn.failed and error event messages, in stream order. */
  readonly errors: readonly string[];
  readonly usage: CodexUsage;
}

/**
 * Parse the stream, or return null when nothing in it is a recognisable
 * event. Null is a distinct answer from a failed turn: it means the host did
 * not speak the pinned format at all, which is version-drift territory.
 */
export function reduceStream(stdout: string): CodexStream | null {
  let sawEvent = false;
  let text = '';
  let threadId: string | null = null;
  let completed = false;
  const errors: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') continue;
    sawEvent = true;

    if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id;
    } else if (event.type === 'item.completed') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item && item.type === 'agent_message' && typeof item.text === 'string') {
        text = item.text;
      } else if (item && item.type === 'error' && typeof item.message === 'string') {
        errors.push(item.message);
      }
    } else if (event.type === 'turn.completed') {
      completed = true;
      const usage = (event.usage ?? {}) as Record<string, unknown>;
      const number = (value: unknown): number =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
      inputTokens = number(usage.input_tokens);
      outputTokens = number(usage.output_tokens);
    } else if (event.type === 'turn.failed') {
      const error = (event.error ?? {}) as Record<string, unknown>;
      if (typeof error.message === 'string') errors.push(error.message);
    } else if (event.type === 'error' && typeof event.message === 'string') {
      errors.push(event.message);
    }
  }

  if (!sawEvent) return null;
  return {
    text,
    threadId,
    completed,
    errors,
    usage: { cost: 0, steps: 0, inputTokens, outputTokens },
  };
}
