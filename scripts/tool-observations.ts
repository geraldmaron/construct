/** Protocol observations shared by deterministic tests and final delivery checks. No corpus or model runner. */
import { redact } from '../src/kernel/render/redact.ts';

/** Persist observations without lease capabilities, credential-shaped data or UUID tokens. */
export function redactObservation(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[bounded]';
  if (Array.isArray(value)) return value.map((v) => redactObservation(v, depth + 1));
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /^(?:token|claimToken|acceptanceKey|secret|password|authorization|cookie)$/i.test(k)
          ? '[redacted]'
          : redactObservation(v, depth + 1),
      ]),
    );
  if (typeof value !== 'string') return value;
  try {
    return JSON.stringify(redactObservation(JSON.parse(value), depth + 1));
  } catch {
    /* Ordinary prose. */
  }
  return redact(value).replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[opaque-id]');
}
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** A write that counts as Construct taking the request on, by tool and, where the tool has several, by action. */
export interface EngagementWrite {
  readonly tool: string;
  readonly actions?: readonly string[];
  /** started: start_outcome returned started:true or created a run; recorded: remember returned a record; succeeded: the call returned no error. */
  readonly when: 'started' | 'recorded' | 'succeeded';
}

export const ENGAGEMENT_WRITES = [
  { tool: 'start_outcome', when: 'started' },
  { tool: 'remember', when: 'recorded' },
  {
    tool: 'work',
    actions: ['add', 'update', 'link', 'unlink', 'requalify', 'claim', 'handoff', 'accept', 'complete', 'release', 'takeover', 'reopen'],
    when: 'succeeded',
  },
  { tool: 'decide', when: 'succeeded' },
  { tool: 'promote_deliverable', when: 'succeeded' },
  { tool: 'delegate', actions: ['start', 'cancel', 'triage', 'integrate'], when: 'succeeded' },
] as readonly EngagementWrite[];
/** One newline-delimited frame the tap saw between a host and a server, or the tap's own launch line. */
export interface TapFrame {
  readonly t: number;
  readonly dir: 'host->server' | 'server->host' | 'tap';
  readonly line?: string;
  readonly launch?: readonly string[];
}

/** A tools/call the host made and what came back, paired by JSON-RPC id. */
export interface ToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  /** The structured result, the parsed text result, or the protocol error. */
  readonly result: unknown;
  readonly isError: boolean;
  readonly answered: boolean;
  readonly at: number;
  readonly answeredAt: number | null;
}

function parseLine(line: string | undefined): Record<string, unknown> | null {
  if (typeof line !== 'string') return null;
  try {
    const value = JSON.parse(line) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function resultPayload(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0] as { text?: unknown } | undefined;
  if (first && typeof first.text === 'string') {
    try {
      return JSON.parse(first.text) as unknown;
    } catch {
      return first.text;
    }
  }
  return result;
}

/** Every tools/call in a tap log with its answer, in the order the host made them. */
export function pairToolCalls(frames: readonly TapFrame[]): ToolCall[] {
  const calls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
    isError: boolean;
    answered: boolean;
    at: number;
    answeredAt: number | null;
  }> = [];
  const pending = new Map<string, number>();
  for (const frame of frames) {
    const message = parseLine(frame.line);
    if (!message) continue;
    const key = message.id === undefined || message.id === null ? null : JSON.stringify(message.id);
    if (frame.dir === 'host->server' && message.method === 'tools/call' && key !== null) {
      const params = isRecord(message.params) ? message.params : {};
      pending.set(key, calls.length);
      calls.push({
        name: typeof params.name === 'string' ? params.name : '',
        arguments: isRecord(params.arguments) ? params.arguments : {},
        result: null,
        isError: false,
        answered: false,
        at: frame.t,
        answeredAt: null,
      });
    } else if (frame.dir === 'server->host' && key !== null && pending.has(key)) {
      const call = calls[pending.get(key)!]!;
      pending.delete(key);
      call.answered = true;
      call.answeredAt = frame.t;
      if (message.error !== undefined) {
        call.isError = true;
        call.result = message.error;
      } else {
        call.isError = isRecord(message.result) && message.result.isError === true;
        call.result = resultPayload(message.result);
      }
    }
  }
  return calls;
}

export function actionOf(call: ToolCall): string | null {
  return typeof call.arguments.action === 'string' ? call.arguments.action : null;
}

/**
 * True when a start_outcome or remember result put a question to the person
 * instead of starting or recording: started:false, a pending remember, or a
 * server without the started flag that blocked the run on a missing input,
 * which is that server's way of asking for it.
 */
export function isQuestionResult(call: ToolCall): boolean {
  if (!call.answered || call.isError || !isRecord(call.result)) return false;
  if (call.name === 'start_outcome') {
    if (call.result.started === false) return true;
    if (call.result.started !== undefined) return false;
    const preflight = isRecord(call.result.preflight) ? call.result.preflight : {};
    const reasons = Array.isArray(preflight.reasons) ? preflight.reasons : [];
    return reasons.some((r) => isRecord(r) && r.code === 'missing_step_input');
  }
  if (call.name === 'remember')
    return (
      (call.result.remembered === null || call.result.remembered === undefined) &&
      call.result.pending !== undefined &&
      call.result.pending !== null
    );
  return false;
}

/** True when this answered call is a write that counts as engagement under PREREGISTRATION. */
export function isEngagementWrite(
  call: ToolCall,
  prereg: { readonly engagementWrites: readonly EngagementWrite[] } = { engagementWrites: ENGAGEMENT_WRITES },
): boolean {
  if (!call.answered || call.isError || (isRecord(call.result) && call.result.error != null) || isQuestionResult(call)) return false;
  const rule = prereg.engagementWrites.find((w) => w.tool === call.name);
  if (!rule) return false;
  if (rule.actions && !rule.actions.includes(actionOf(call) ?? '')) return false;
  const result = isRecord(call.result) ? call.result : {};
  if (rule.when === 'started') {
    if (result.started === true) return true;
    // A baseline server without the started flag created a run whenever it returns one and is not asking for an input.
    return result.started === undefined && isRecord(result.run) && typeof result.run.id === 'string';
  }
  if (rule.when === 'recorded') return isRecord(result.remembered);
  return true;
}

/** The stop policy: a run ends once the first engagement write has its result; a question result lets it continue. */
export function shouldStop(
  calls: readonly ToolCall[],
  prereg: { readonly engagementWrites: readonly EngagementWrite[] } = { engagementWrites: ENGAGEMENT_WRITES },
): boolean {
  return calls.some((c) => isEngagementWrite(c, prereg));
}
