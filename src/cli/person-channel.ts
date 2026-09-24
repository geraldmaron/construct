/**
 * cli/person-channel.ts — whether this invocation is the person typing in a
 * terminal of their own, or something answering on their behalf.
 *
 * The command line counts as a person channel only when stdin and stdout are a
 * terminal, the environment carries no agent-host marker, and no agent host is
 * among this process's ancestors. A model running the command through its
 * host's shell tool, or typing into a terminal pane the host controls, fails at
 * least one of those, so its answer is recorded as relayed. This is not proof
 * against a program the person's own account runs on purpose; it stops a model
 * from approving on the person's behalf by running `construct inbox resolve`.
 */

import { spawnSync } from 'node:child_process';
import type { DecisionChannel } from '../kernel/policy/channels.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';

export interface TerminalFacts {
  /** stdin and stdout are both attached to a terminal. */
  readonly interactive: boolean;
  /** The first ancestor process that is an agent host, if any, as its command line. */
  readonly agentAncestor: string | null;
}

/** Agent hosts as they appear in a process's command line. */
const AGENT_PROCESS = [
  /\/(?:Claude|Cursor|ChatGPT|Codex|Windsurf|Zed)\.app\//i,
  /(?:^|\/)(?:claude|cursor-agent|codex|opencode|gemini|goose|aider|amp)(?:\s|$)/i,
  /@anthropic-ai\/claude-code|@openai\/codex|@google\/gemini-cli|opencode-ai|@block\/goose/i,
];

const MAX_DEPTH = 32;

/** Walk this process's ancestors and return the first that is an agent host. */
function agentAncestorOf(pid: number): string | null {
  let current = pid;
  for (let depth = 0; depth < MAX_DEPTH && current > 1; depth += 1) {
    const r = spawnSync('ps', ['-o', 'ppid=,args=', '-p', String(current)], { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout.trim()) return null;
    const match = /^\s*(\d+)\s+(.*)$/s.exec(r.stdout.trim());
    if (!match) return null;
    const [, parent, args] = match as unknown as [string, string, string];
    if (depth > 0 && AGENT_PROCESS.some((re) => re.test(args))) return args.slice(0, 200);
    current = Number(parent);
  }
  return null;
}

export function terminalFacts(): TerminalFacts {
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return { interactive, agentAncestor: interactive ? agentAncestorOf(process.pid) : null };
}

/** The channel this invocation's answer arrives on. `facts` is a seam for tests. */
export function channelFor(env: NodeJS.ProcessEnv, facts: TerminalFacts = terminalFacts()): DecisionChannel {
  if (!facts.interactive) return 'relay';
  if (detectAmbientHost(env)) return 'relay';
  if (facts.agentAncestor) return 'relay';
  return 'tty_cli';
}

/** Who to record as answering, by channel. */
export function answeredBy(channel: DecisionChannel): string {
  return channel === 'tty_cli' ? 'person via cli' : 'relayed via cli (no person at a terminal)';
}
