/**
 * hosts/hooks/handlers.ts — what Construct does at a host's lifecycle
 * events, so the habits that keep its work honest do not depend on the
 * host model remembering them.
 *
 * Three events, all deterministic:
 *
 * - After a tool call: when a Jira or Atlassian connector tool returned
 *   items from a source only the host can read (Jira issues whose keys
 *   carry a declared project key), Construct records them as a partial host
 *   read, as readable text with the issue's address and the tool that
 *   carried it. Reporting stops being a step the model can forget. Any other
 *   tool's response is that tool's content, even when it holds Jira-shaped
 *   JSON, and records nothing.
 * - When the host is about to stop: when its last reply named project
 *   facts (a declared ticket key, a file in a declared directory source, a
 *   source id) and it neither checked the answer nor did the work through a
 *   gated step, the host is sent back once to run check_answer. Once: a
 *   hook that can loop is worse than none.
 * - At session start: one line saying to report a reading of any work the
 *   person asks for with classify_request, then what waits (decisions about
 *   runs, sources to report, sources that moved, setup questions to offer
 *   after the person's request), added to the host's context.
 *
 * Every hook fails open. An error is logged and the host carries on; a
 * hook must never wedge someone's session.
 */

import { readFileSync } from 'node:fs';
import type { BrokerContext } from '../../kernel/broker/context.ts';
import { appendActivity } from '../../kernel/state/activity.ts';
import { listOpenDecisions } from '../../kernel/state/decisions.ts';
import { waitingOn } from '../../kernel/broker/tools.ts';
import type { HostReportItem } from '../../kernel/source/service.ts';
import { projectResolver } from '../../kernel/source/resolver.ts';
import { urlProblem } from '../../kernel/project/urls.ts';

/**
 * Tool names whose responses are a Jira or Atlassian connector's: only these are recorded as reads of a jira
 * source. The connectors' actual tool names are not verified here; the pattern takes any tool whose name says jira
 * or atlassian (mcp__atlassian__getJiraIssue, for one).
 */
export const JIRA_TOOL = /jira|atlassian/i;

/** How deep readable text is followed; rich text nests (lists in tables in panels), so deeper than objectsIn. */
const READABLE_DEPTH = 64;

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** Every object in a tool response, including JSON carried inside text content blocks. */
export function objectsIn(value: unknown, out: Record<string, unknown>[] = [], depth = 0): Record<string, unknown>[] {
  if (depth > 12) return out;
  const v = parseMaybeJson(value);
  if (Array.isArray(v)) for (const x of v) objectsIn(x, out, depth + 1);
  else if (v !== null && typeof v === 'object') {
    out.push(v as Record<string, unknown>);
    for (const x of Object.values(v)) objectsIn(x, out, depth + 1);
  }
  return out;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A rich-text node, the Atlassian Document Format shape: a string type with a content list or a text string. */
function isRichText(o: Record<string, unknown>): boolean {
  return typeof o.type === 'string' && (Array.isArray(o.content) || typeof o.text === 'string');
}

/**
 * A rich-text node as text: a text node is inline, a hard break is an inline line break, and a node with content is
 * a block whose inline children join into one line and whose block children go on lines of their own. Its type,
 * marks, and attrs are structure, not content.
 */
function richText(node: unknown, depth: number): { readonly inline: boolean; readonly text: string } | null {
  if (depth > READABLE_DEPTH || !isObject(node) || typeof node.type !== 'string') return null;
  if (typeof node.text === 'string') return { inline: true, text: node.text };
  if (node.type === 'hardBreak') return { inline: true, text: '\n' };
  if (!Array.isArray(node.content)) return null;
  const lines: string[] = [];
  let run = '';
  for (const child of node.content) {
    const r = richText(child, depth + 1);
    if (!r) continue;
    if (r.inline) run += r.text;
    else {
      if (run !== '') lines.push(run);
      run = '';
      if (r.text !== '') lines.push(r.text);
    }
  }
  if (run !== '') lines.push(run);
  return { inline: false, text: lines.join('\n') };
}

/**
 * What an item a tool returned says, as a person would read it: every string and number in document order, one per
 * line, with JSON carried inside strings opened up and rich text reduced to its words. Keys and JSON punctuation
 * are not content, so a quote containing double quotes or a line break reads back the way it was written.
 */
export function readableText(value: unknown): string {
  const lines: string[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > READABLE_DEPTH) return;
    const x = parseMaybeJson(v);
    if (typeof x === 'string') {
      if (x.trim() !== '') lines.push(x);
    } else if (typeof x === 'number') lines.push(String(x));
    else if (Array.isArray(x)) for (const e of x) walk(e, depth + 1);
    else if (isObject(x)) {
      if (isRichText(x)) {
        const r = richText(x, depth);
        if (r && r.text.trim() !== '') lines.push(r.text);
      } else for (const e of Object.values(x)) walk(e, depth + 1);
    }
  };
  walk(value, 0);
  return lines.join('\n');
}

function str(o: Record<string, unknown>, ...path: string[]): string | undefined {
  let cur: unknown = o;
  for (const p of path) cur = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>)[p] : undefined;
  return typeof cur === 'string' ? cur : undefined;
}

/** A project key as a pattern: escaped, not stripped, since keys may carry underscores (PLAT_A-101). */
export function projectKeyPattern(projectKey: string): string {
  return projectKey.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The address a person would open for an issue: its own url or webUrl, or the browse page derived from its REST
 * self link (`<base>/rest/api/<n>/issue/...` gives `<base>/browse/<key>`). Only an http(s) address with no
 * credentials in it is kept.
 */
export function issueUrl(o: Record<string, unknown>, key: string): string | undefined {
  const self = str(o, 'self');
  const base = self ? /^(https?:\/\/.+?)\/rest\/api\/(?:\d+|latest)\/issue\//i.exec(self.trim())?.[1] : undefined;
  const candidates = [str(o, 'url'), str(o, 'webUrl'), base ? `${base}/browse/${key}` : undefined];
  return candidates.find((u): u is string => u !== undefined && urlProblem(u) === null)?.trim();
}

/** Jira-shaped items in a response whose key belongs to the given project key, as readable text with their address. */
export function jiraItemsIn(response: unknown, projectKey: string): HostReportItem[] {
  const keyPattern = new RegExp(`^${projectKeyPattern(projectKey)}-\\d+$`);
  const byKey = new Map<string, HostReportItem>();
  for (const o of objectsIn(response)) {
    const key = str(o, 'key') ?? str(o, 'issueKey');
    if (!key || !keyPattern.test(key)) continue;
    const title = str(o, 'fields', 'summary') ?? str(o, 'summary') ?? str(o, 'title');
    const updatedAt = str(o, 'fields', 'updated') ?? str(o, 'updated') ?? str(o, 'updatedAt');
    // Uncut: the source service caps what it keeps and says when it cut.
    const text = readableText(o);
    const prev = byKey.get(key);
    const url = issueUrl(o, key) ?? prev?.url;
    // The fullest object for a key wins; a bare link to an issue should not displace the issue itself.
    // Without the tracker's own updated time, a response cannot say whether the ticket changed, only that it exists.
    if (!prev || (prev.text?.length ?? 0) < text.length) byKey.set(key, { ref: key, ...(title ? { title } : {}), ...(url ? { url } : {}), ...(updatedAt ? { updatedAt } : { weak: true }), text, kind: 'work_item' });
    else if (url && !prev.url) byKey.set(key, { ...prev, url });
  }
  return [...byKey.values()];
}

export interface PostToolInput {
  readonly tool_name?: string;
  readonly tool_response?: unknown;
}

/** Record host-read items a tool call returned. Returns what was recorded, per source. */
export function onPostTool(ctx: BrokerContext, input: PostToolInput): { readonly reported: Record<string, number> } {
  const reported: Record<string, number> = {};
  const name = input.tool_name ?? '';
  // Construct's own tools return its own records, not reads of an outside system.
  if (/construct/i.test(name)) return { reported };
  for (const s of ctx.sources.list()) {
    if (ctx.sources.canRead(s.id) || s.kind !== 'jira' || !s.locator) continue;
    // Only a Jira or Atlassian tool's response is a read of the tracker; the same shape elsewhere proves nothing.
    if (!JIRA_TOOL.test(name)) continue;
    const items = jiraItemsIn(input.tool_response, s.locator).map((i) => ({ ...i, via: name }));
    if (items.length === 0) continue;
    ctx.sources.reportRead(s.id, { items, partial: true }, ctx.now(), () => ctx.nextId('snap'));
    reported[s.id] = items.length;
    appendActivity(ctx.store, { at: ctx.now(), kind: 'hook.read_reported', actor: ctx.actor, payload: { sourceId: s.id, items: items.length, tool: name } });
  }
  return { reported };
}

interface TranscriptTurn {
  readonly texts: string[];
  readonly tools: string[];
}

/** The host's turn since the person's last message: what it said and which tools it called. */
export function lastTurn(transcriptPath: string): TranscriptTurn {
  let lines: string[];
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
  } catch {
    return { texts: [], tools: [] };
  }
  const entries = lines.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } }).filter((e): e is Record<string, unknown> => e !== null);
  const isPrompt = (e: Record<string, unknown>) => {
    if (e.type !== 'user') return false;
    const c = (e.message as { content?: unknown } | undefined)?.content;
    if (typeof c === 'string') return true;
    return Array.isArray(c) && c.some((b) => (b as { type?: string }).type === 'text');
  };
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) if (isPrompt(entries[i]!)) { start = i + 1; break; }
  const texts: string[] = [];
  const tools: string[] = [];
  for (const e of entries.slice(start)) {
    if (e.type !== 'assistant') continue;
    const c = (e.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c as { type?: string; text?: string; name?: string }[]) {
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      if (b.type === 'tool_use' && typeof b.name === 'string') tools.push(b.name);
    }
  }
  return { texts, tools };
}

/** Which project facts a reply names: declared ticket keys, files in declared directory sources, source ids. */
export function projectFactsIn(ctx: BrokerContext, text: string): string[] {
  const out = new Set<string>();
  for (const s of ctx.sources.list()) {
    if (s.kind === 'jira' && s.locator) for (const m of text.matchAll(new RegExp(`(?<![\\w-])${projectKeyPattern(s.locator)}-\\d+\\b`, 'g'))) out.add(m[0]);
    if (new RegExp(`\\b${s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text) && s.id.length >= 4) out.add(s.id);
  }
  // A file name is a project fact only when it names a file this project actually holds: "package.json" in
  // passing, or a dependency's README, is not.
  const resolve = projectResolver(ctx.store, ctx.root);
  for (const m of text.matchAll(/\b[\w./-]+\.(?:md|markdown|txt|csv|json)\b/g)) {
    const r = resolve(m[0]);
    if (r?.kind === 'file' && r.sourceId) out.add(m[0]);
  }
  return [...out];
}

export interface StopInput {
  readonly transcript_path?: string;
  readonly stop_hook_active?: boolean;
}

export type StopVerdict = { readonly decision: 'block'; readonly reason: string } | null;

/** Send the host back once when it stated project facts it did not check. */
export function onStop(ctx: BrokerContext, input: StopInput): StopVerdict {
  if ((ctx.policy?.answerCheck ?? 'nudge') === 'off') return null;
  if (input.stop_hook_active) return null;
  if (!input.transcript_path) return null;
  const turn = lastTurn(input.transcript_path);
  if (turn.texts.length === 0) return null;
  const checked = turn.tools.some((t) => /check_answer$/.test(t));
  const gated = turn.tools.some((t) => /submit_work$/.test(t));
  if (checked || gated) return null;
  const facts = projectFactsIn(ctx, turn.texts.join('\n'));
  if (facts.length === 0) return null;
  appendActivity(ctx.store, { at: ctx.now(), kind: 'hook.answer_unchecked', actor: ctx.actor, payload: { facts: facts.slice(0, 10) } });
  return {
    decision: 'block',
    reason: `Your reply states project facts (${facts.slice(0, 5).join(', ')}${facts.length > 5 ? ', …' : ''}) without check_answer. Call check_answer with the reply and what it rests on; if it finds problems, correct the reply or say which parts are unsupported. If the reply was not stating facts, say so in one line.`,
  };
}

/** The line every session starts with, whatever waits: the person's request is read by the host, through classify_request. */
export const SESSION_START_LINE = 'Construct is bound to this project: for work the person asks for, call classify_request with your own reading first.';

/**
 * A short note for the start of a session: the classify_request line, then
 * the decisions about runs, what the host should read and report, and the
 * setup questions to offer once the person's request is handled. A setup
 * question is never counted as a decision that waits.
 */
export async function onSessionStart(ctx: BrokerContext): Promise<string> {
  const at = ctx.now();
  const waits = waitingOn(listOpenDecisions(ctx.store));
  const toReport: string[] = [];
  const moved: string[] = [];
  for (const s of ctx.sources.list()) {
    if (!ctx.sources.canRead(s.id)) {
      const f = ctx.sources.status(s.id, at).freshness;
      if (f === 'never_read' || f === 'stale') toReport.push(s.id);
    } else if ((await ctx.sources.peek(s.id)) === true) moved.push(s.id);
  }
  const parts: string[] = [];
  if (waits.inRuns.length > 0) parts.push(`${String(waits.inRuns.length)} decision(s) about runs wait on the person (inbox).`);
  if (moved.length > 0) parts.push(`Changed since last read: ${moved.join(', ')}; refresh before relying on them.`);
  if (toReport.length > 0) parts.push(`Only you can read ${toReport.join(', ')}; report what you cite from them with sources action report.`);
  if (waits.setup.length > 0) parts.push(`After the person's request, offer the ${String(waits.setup.length)} setup question(s) bootstrap lists.`);
  return parts.length ? `${SESSION_START_LINE} ${parts.join(' ')} State project facts only after check_answer.` : SESSION_START_LINE;
}
