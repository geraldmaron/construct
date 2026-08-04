/**
 * hosts/opencode/events.ts — the parser for `opencode run --format json`.
 *
 * Pure: text in, a reduced result out. No process, no clock, no filesystem, so
 * every behavior below is testable against a captured transcript from the real
 * pinned host rather than against a guess about its shape.
 *
 * Two behaviors here were read off the real host at the pinned version, not
 * assumed. tests/hosts/opencode/fixtures holds the transcripts they came from,
 * and scripts/probe-opencode-conformance.mjs re-checks them against a live
 * binary:
 *
 * 1. A run emits MANY step_finish events, one per step. Token counts and cost
 *    are therefore summed across steps; reading the last event reports one
 *    step's usage as the whole run's, which understates spend — and the
 *    coordinator's spend ceiling (construct-r67.5) is built on this number.
 * 2. A tool call can fail while the run succeeds. A rejected permission comes
 *    back as part.state.status "error" with the run still exiting 0, so tool
 *    failures are surfaced separately from run failures and a caller can tell
 *    "the role could not read the file" from "the host fell over".
 *
 * Tolerating non-JSON lines is a third behavior but a weaker claim, and worth
 * stating precisely because the first reading of it here was wrong: the host
 * writes human-facing notices ("permission requested: ...; auto-rejecting",
 * ANSI included) to stderr, and stdout under `--format json` is clean NDJSON.
 * The tolerance exists because any caller that merges the two streams — which
 * every `2>&1` capture does, including the one that produced that first
 * misreading — would otherwise crash the parse on a healthy run. Notices are
 * kept rather than dropped so a merged capture loses nothing.
 */

export type OpenCodeEventType = 'step_start' | 'step_finish' | 'text' | 'tool_use' | 'error';

export interface OpenCodeToolCall {
  readonly tool: string;
  readonly callId: string;
  /** 'completed' | 'error' | whatever else the host reports; not narrowed, so an
   *  unfamiliar status survives to the caller instead of being coerced to one we know. */
  readonly status: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly error: string | null;
}

export interface OpenCodeUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Host-reported, in the host's own units. 0 for a local model. */
  readonly cost: number;
  /** How many step_finish events this was summed from. */
  readonly steps: number;
}

export interface OpenCodeRunResult {
  readonly sessionId: string | null;
  /** Concatenated text parts, in emission order. Empty string if the run produced none. */
  readonly text: string;
  readonly toolCalls: readonly OpenCodeToolCall[];
  /** Run-level errors. Non-empty means the run failed, whatever the exit code said. */
  readonly errors: readonly string[];
  /** Non-JSON lines the host wrote to stdout, ANSI stripped. Kept, never dropped. */
  readonly notices: readonly string[];
  readonly finishReasons: readonly string[];
  readonly usage: OpenCodeUsage;
}

interface ParsedLine {
  readonly event: Record<string, unknown> | null;
  readonly notice: string | null;
}

// Matches CSI sequences (colour, bold, reset). The host writes these into
// stdout notices even when stdout is not a TTY.
const ANSI = /\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * Parse one stdout line. A line that is not a JSON object is a notice, not an
 * error — see behavior 1 in the module note.
 */
export function parseLine(line: string): ParsedLine {
  const clean = stripAnsi(line).trim();
  if (!clean) return { event: null, notice: null };
  if (!clean.startsWith('{')) return { event: null, notice: clean };
  try {
    const parsed: unknown = JSON.parse(clean);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { event: null, notice: clean };
    }
    return { event: parsed as Record<string, unknown>, notice: null };
  } catch {
    return { event: null, notice: clean };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readToolCall(part: Record<string, unknown>): OpenCodeToolCall | null {
  const tool = asString(part.tool);
  if (!tool) return null;
  const state = asRecord(part.state) ?? {};
  return {
    tool,
    callId: asString(part.callID) ?? '',
    status: asString(state.status) ?? 'unknown',
    input: state.input ?? null,
    output: state.output ?? null,
    error: asString(state.error),
  };
}

/**
 * Reduce a full stdout transcript to one result.
 *
 * Every number here is summed across steps and every list is kept in emission
 * order; nothing is inferred that the host did not actually report.
 */
export function reduceTranscript(stdout: string): OpenCodeRunResult {
  let sessionId: string | null = null;
  const textParts: string[] = [];
  const toolCalls: OpenCodeToolCall[] = [];
  const errors: string[] = [];
  const notices: string[] = [];
  const finishReasons: string[] = [];

  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let cost = 0;
  let steps = 0;

  for (const line of stdout.split('\n')) {
    const { event, notice } = parseLine(line);
    if (notice !== null) notices.push(notice);
    if (!event) continue;

    sessionId ??= asString(event.sessionID);
    const part = asRecord(event.part) ?? {};

    switch (asString(event.type)) {
      case 'text': {
        const text = asString(part.text);
        if (text) textParts.push(text);
        break;
      }
      case 'tool_use': {
        const call = readToolCall(part);
        if (call) toolCalls.push(call);
        break;
      }
      case 'step_finish': {
        steps += 1;
        const reason = asString(part.reason);
        if (reason) finishReasons.push(reason);
        const tokens = asRecord(part.tokens) ?? {};
        const cache = asRecord(tokens.cache) ?? {};
        inputTokens += asNumber(tokens.input);
        outputTokens += asNumber(tokens.output);
        reasoningTokens += asNumber(tokens.reasoning);
        totalTokens += asNumber(tokens.total);
        cacheReadTokens += asNumber(cache.read);
        cacheWriteTokens += asNumber(cache.write);
        cost += asNumber(part.cost);
        break;
      }
      case 'error': {
        // The host nests the human-readable string at error.data.message and
        // the class at error.name; either may be missing.
        const error = asRecord(event.error) ?? {};
        const data = asRecord(error.data) ?? {};
        const message = asString(data.message) ?? asString(error.name) ?? 'unknown host error';
        errors.push(message);
        break;
      }
      default:
        break;
    }
  }

  return {
    sessionId,
    text: textParts.join(''),
    toolCalls,
    errors,
    notices,
    finishReasons,
    usage: {
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost,
      steps,
    },
  };
}

/** Tool calls the host reported as failed. A run can succeed with these non-empty. */
export function failedToolCalls(result: OpenCodeRunResult): readonly OpenCodeToolCall[] {
  return result.toolCalls.filter((call) => call.status === 'error');
}
