/**
 * cli/hook.ts — the command a host's lifecycle hooks run. Reads the host's
 * event JSON on stdin and answers on stdout the way the host expects.
 *
 * Always exits 0 and never blocks on its own failure: a hook that errors
 * logs to stderr and lets the host carry on.
 */

import { openBroker } from './broker-context.ts';
import { createContext, type CliContext } from './context.ts';
import { stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { UsageError } from './output.ts';
import { onPostTool, onSessionStart, onStop } from '../hosts/hooks/handlers.ts';

export const HOOK_EVENTS = ['post-tool', 'stop', 'session-start'] as const;

export const HOOK_SPEC: CommandSpec = {
  path: ['hook'],
  gloss: 'handle a host lifecycle event (post-tool | stop | session-start); hosts run it, people rarely do',
  group: 'Host',
  positionals: ['<event>'],
  flags: [
    { name: 'client', gloss: 'which host sent the event (default: claude-code)', takesValue: true },
    { name: 'project', gloss: 'the project root (default: the event\'s cwd, then the working directory)', takesValue: true },
  ],
  readOnly: false,
};

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

export async function hook(args: ParsedArgs, ctx: CliContext = createContext(), stdin: () => Promise<string> = readStdin): Promise<number> {
  const event = args.positionals[0];
  if (!event || !(HOOK_EVENTS as readonly string[]).includes(event)) throw new UsageError(`event must be one of ${HOOK_EVENTS.join(' | ')}`);
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
