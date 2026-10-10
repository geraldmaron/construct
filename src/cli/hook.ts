/**
 * cli/hook.ts — the command a host's lifecycle hooks run. It reads the host's
 * event JSON on stdin, answers on stdout the way the host expects, and always
 * exits 0: a hook must never be the error the person sees.
 *
 * Two hook packs share this one command, told apart by how they call it:
 *
 * - `construct hook <host> <event>` (installed by `construct hooks install
 *   --host`): coordination. At session start it says who else is working in
 *   the project; after an edit it says when the edited file is reserved by
 *   another claimant in the same checkout. It opens the store read-only,
 *   answers within its own budget, says facts only within 400 bytes, and
 *   counts each run in the project's state directory.
 * - `construct hook <event> --client=<host>` (installed by `construct init
 *   --client`): grounding. After a tool runs it records what the host read
 *   from host-only sources; at stop it sends back, once, a reply that stated
 *   project facts unchecked; at session start it notes what waits.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { coordinationFor } from '../kernel/coord/awareness.ts';
import { openStateStore, type StateStore } from '../kernel/state/open.ts';
import { findOverlaps, MAIN_LANE, normalizeLeasePath, whereHeld } from '../kernel/work/leases.ts';
import { projectDbPath, projectStateDir } from '../kernel/project/layout.ts';
import { createContext, locateProject, worktreeHolding, type CliContext, type ProjectLocation } from './context.ts';
import { NoProjectError } from '../kernel/project/discover.ts';

import { stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { UsageError } from './output.ts';
import { openBroker } from './broker-context.ts';
import { onPostTool, onSessionStart, onStop } from '../hosts/hooks/handlers.ts';

export const HOOK_SPEC: CommandSpec = {
  path: ['hook'],
  gloss: 'run by a host hook Construct installed (coordination: <host> <event>; grounding: <event> --client); reads the event on stdin, exits 0 once its command line parses',
  group: 'Host',
  positionals: ['<host-or-event>', '[event]'],
  flags: [
    { name: 'client', gloss: 'grounding hooks: which host sent the event (default: claude-code)', takesValue: true },
    { name: 'project', gloss: 'grounding hooks: the project root (default: the event\'s cwd, then the working directory)', takesValue: true },
  ],
  readOnly: false,
};

export const HOOK_HOSTS = ['claude-code'] as const;
export const COORDINATION_HOOK_EVENTS = ['session-start', 'post-tool-use'] as const;
export type HookEvent = (typeof COORDINATION_HOOK_EVENTS)[number];

/** The longest a hook process runs, from its start, whatever the host allows. */
export const HOOK_BUDGET_MS = 1500;
/** How long a hook waits for a locked store before saying nothing. */
export const HOOK_LOCK_WAIT_MS = 200;
/** The most a hook adds to the model's context. */
export const HOOK_OUTPUT_BUDGET = 400;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

interface Payload {
  readonly cwd?: unknown;
  readonly session_id?: unknown;
  readonly tool_name?: unknown;
  readonly tool_input?: unknown;
}

const HOOK_EVENT_NAMES: Readonly<Record<HookEvent, string>> = { 'session-start': 'SessionStart', 'post-tool-use': 'PostToolUse' };

function context(event: HookEvent, text: string): string {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: HOOK_EVENT_NAMES[event], additionalContext: text } });
}

/** Cut `text` so the whole hook output fits the budget. */
function bounded(event: HookEvent, text: string): string {
  let t = text;
  while (t.length > 0 && Buffer.byteLength(context(event, t)) > HOOK_OUTPUT_BUDGET) t = `${t.slice(0, Math.max(0, t.length - 20)).trimEnd()}…`;
  return context(event, t);
}

/** The Construct session serving this host session, when one registered under the host's id. */
function sessionOf(store: StateStore, hostSessionId: string | null): string | null {
  if (!hostSessionId) return null;
  const row = store.db.prepare('SELECT id FROM sessions WHERE host_session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(hostSessionId) as { id: string } | undefined;
  return row?.id ?? null;
}

function sessionStart(store: StateStore, sessionId: string | null, lane: string | null, now: string): string {
  const c = coordinationFor(store, { sessionId, laneRoot: lane, now });
  if (c.others === 0 && c.held.length === 0 && c.offers === 0) return '';
  const held = c.held.map((h) => `${h.work} by ${h.by}${h.paths.length ? ` (${h.paths.join(', ')})` : ''}`).join('; ');
  // Without its own session's id, the hook cannot leave itself out of the count.
  const counted = sessionId ? `${String(c.others)} other session(s) here, ${String(c.sameCheckout)} in this checkout.` : `${String(c.others)} session(s) here, ${String(c.sameCheckout)} in this checkout, possibly including this one.`;
  const parts = [
    `Construct: ${counted}`,
    held ? `Held: ${held}${c.more ? ` and ${String(c.more)} more` : ''}.` : '',
    c.offers ? `${String(c.offers)} handoff(s) wait for you.` : '',
    c.sameCheckout > 0 ? 'Claim with paths before editing; do not switch branches or stash here.' : 'Claim with paths before editing.',
  ];
  return bounded('session-start', parts.filter(Boolean).join(' '));
}

function editedPath(payload: Payload): string | null {
  if (typeof payload.tool_name !== 'string' || !EDIT_TOOLS.has(payload.tool_name)) return null;
  const input = payload.tool_input;
  if (!input || typeof input !== 'object') return null;
  const i = input as { file_path?: unknown; notebook_path?: unknown };
  const path = typeof i.file_path === 'string' ? i.file_path : typeof i.notebook_path === 'string' ? i.notebook_path : null;
  return path && path.length < 4096 ? path : null;
}

/**
 * Whether a claim might be this session's own. Known when the hook knows its
 * session; otherwise any claim held by a session of this same host might be,
 * and the hook stays quiet about it rather than tell an agent to stop editing
 * its own file.
 */
function possiblyOwn(store: StateStore, workId: string, sessionId: string | null): boolean {
  const row = store.db
    .prepare('SELECT w.claim_session AS session, s.host AS host FROM work_items w LEFT JOIN sessions s ON s.id = w.claim_session WHERE w.id = ?')
    .get(workId) as { session: string | null; host: string | null } | undefined;
  if (!row?.session) return false;
  if (sessionId) return row.session === sessionId;
  return row.host === null || row.host === 'claude-code';
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * After an edit: whether another claim holds the edited file in the checkout
 * the file is in. That is the project's checkout holding the file, which may
 * be another worktree than the one the session runs in, so an edit made in a
 * worktree is judged against the claims recorded for that worktree.
 */
function postToolUse(store: StateStore, payload: Payload, cwd: string, located: ProjectLocation, sessionId: string | null, now: string): string {
  const path = editedPath(payload);
  if (!path) return '';
  const held = worktreeHolding(located.root, isAbsolute(path) ? path : resolve(cwd, path));
  if (!held || !held.path) return '';
  const { worktree } = held;
  const here = located.lane === null ? worktree.main : !worktree.main && realpathOr(located.lane.checkout) === worktree.checkout;
  const lane = worktree.main ? MAIN_LANE : here ? located.lane!.root : worktree.root;
  const overlaps = findOverlaps(store, { paths: [normalizeLeasePath(held.path, 'check')], laneRoot: lane, now })
    .filter((o) => o.kind === 'collision' && !possiblyOwn(store, o.workId, sessionId));
  if (overlaps.length === 0) return '';
  const o = overlaps[0]!;
  const reserved = `Construct: ${o.path} is reserved by ${o.holder} for ${o.workId} until ${o.until}`;
  const act = 'Another agent holds it: stop editing it, and claim other work or ask for a handoff.';
  // Another worktree's path can be long; it comes last so the output budget trims it, not what to do.
  return bounded('post-tool-use', here ? `${reserved}, in this checkout. ${act}` : `${reserved}. ${act} Held ${whereHeld(o)}.`);
}

/**
 * What the hook prints for one event: a JSON line the host adds to the
 * model's context, or nothing. Never throws.
 */
export function hookResponse(event: HookEvent, payload: Payload, ctx: CliContext): string {
  return respond(event, payload, ctx).text;
}

/** The hook's output, and whether something went wrong on the way to it. */
function respond(event: HookEvent, payload: Payload, ctx: CliContext): { readonly text: string; readonly failed: boolean } {
  let store: StateStore | null = null;
  try {
    const cwd = typeof payload.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : ctx.cwd;
    const located = locateProject({ ...ctx, cwd, sessionCwd: undefined });
    const dbPath = projectDbPath(located.root);
    if (!existsSync(dbPath)) return { text: '', failed: false };
    store = openStateStore(dbPath, { readOnly: true, busyTimeoutMs: HOOK_LOCK_WAIT_MS });
    const sessionId = sessionOf(store, typeof payload.session_id === 'string' ? payload.session_id : null);
    const now = ctx.now();
    return { text: event === 'session-start' ? sessionStart(store, sessionId, located.lane?.root ?? null, now) : postToolUse(store, payload, cwd, located, sessionId, now), failed: false };
  } catch (error) {
    // No project where the host is working is an ordinary quiet run; anything else failed.
    return { text: '', failed: !(error instanceof NoProjectError) };
  } finally {
    try {
      store?.close();
    } catch {
      // Closing a read-only handle has nothing to lose.
    }
  }
}

/** Count one hook run in the project's state directory. Best effort. */
export function recordHookHealth(stateDir: string, event: string, outcome: 'said' | 'quiet' | 'failed', at: string): void {
  try {
    const file = join(stateDir, 'hook-health.json');
    let health: Record<string, { runs: number; said: number; failed: number; lastAt: string }> = {};
    try {
      health = JSON.parse(readFileSync(file, 'utf8')) as typeof health;
    } catch {
      health = {};
    }
    const h = health[event] ?? { runs: 0, said: 0, failed: 0, lastAt: at };
    health[event] = { runs: h.runs + 1, said: h.said + (outcome === 'said' ? 1 : 0), failed: h.failed + (outcome === 'failed' ? 1 : 0), lastAt: at };
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(health, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    // Health is a courtesy; a hook never fails for it.
  }
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolveText) => {
    const chunks: Buffer[] = [];
    let size = 0;
    process.stdin.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 1_000_000) chunks.push(c);
    });
    process.stdin.on('end', () => resolveText(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolveText(''));
  });
}

/**
 * The command a host runs. It never returns a non-zero code, and it ends the
 * process when its budget runs out rather than let the host wait.
 */
async function coordinationHook(args: ParsedArgs, ctx: CliContext): Promise<number> {
  // The budget runs from process start: loading Node and Construct spends it too.
  const timer = setTimeout(() => process.exit(0), Math.max(50, HOOK_BUDGET_MS - process.uptime() * 1000));
  timer.unref();
  const [host, event] = args.positionals;
  if (!(HOOK_HOSTS as readonly string[]).includes(host ?? '') || !(COORDINATION_HOOK_EVENTS as readonly string[]).includes(event ?? '')) return 0;
  let payload: Payload = {};
  try {
    const parsed = JSON.parse((await readStdin()) || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Payload;
  } catch {
    payload = {};
  }
  const { text: out, failed } = respond(event as HookEvent, payload, ctx);
  if (out) process.stdout.write(`${out}\n`);
  try {
    const cwd = typeof payload.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : ctx.cwd;
    const root = locateProject({ ...ctx, cwd, sessionCwd: undefined }).root;
    recordHookHealth(projectStateDir(root), `${host!}:${event!}`, failed ? 'failed' : out ? 'said' : 'quiet', ctx.now());
  } catch {
    // No project, nothing to count.
  }
  return 0;
}
export const GROUNDING_HOOK_EVENTS = ['post-tool', 'stop', 'session-start'] as const;


async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function groundingHook(args: ParsedArgs, ctx: CliContext, stdin: () => Promise<string>): Promise<number> {
  const event = args.positionals[0];
  if (!event || !(GROUNDING_HOOK_EVENTS as readonly string[]).includes(event)) throw new UsageError(`event must be one of ${GROUNDING_HOOK_EVENTS.join(' | ')}`);
  let input: Record<string, unknown> = {};
  try {
    const raw = await stdin();
    input = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (error) {
    process.stderr.write(`construct hook ${event}: unreadable event (${(error as Error).message}); carrying on\n`);
    return 0;
  }
  let opened: ReturnType<typeof openBroker> | null = null;
  try {
    const project = stringFlag(args, 'project');
    const bound = project ? { ...ctx, cwd: project } : typeof input.cwd === 'string' ? { ...ctx, cwd: input.cwd } : ctx;
    opened = openBroker(bound, { client: stringFlag(args, 'client') ?? 'claude-code' });
    const broker = opened.broker;
    if (event === 'post-tool') {
      onPostTool(broker, input);
    } else if (event === 'stop') {
      const verdict = onStop(broker, input);
      if (verdict) process.stdout.write(JSON.stringify(verdict));
    } else {
      const note = await onSessionStart(broker);
      if (note) process.stdout.write(note);
    }
  } catch (error) {
    // Not a Construct project, a locked database, anything: the host's session matters more than this hook.
    process.stderr.write(`construct hook ${event}: ${(error as Error).message}; carrying on\n`);
  } finally {
    opened?.project.store.close();
  }
  return 0;
}

/**
 * Run the hook a host called. The first word names a host for the
 * coordination pack and an event for the grounding pack.
 */
export async function hook(args: ParsedArgs, ctx: CliContext = createContext(), stdin: () => Promise<string> = readAllStdin): Promise<number> {
  if ((HOOK_HOSTS as readonly string[]).includes(args.positionals[0] ?? '')) return coordinationHook(args, ctx);
  return groundingHook(args, ctx, stdin);
}
