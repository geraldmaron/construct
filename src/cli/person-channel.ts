/**
 * cli/person-channel.ts — whether this invocation is the person typing in a
 * terminal of their own, or something answering on their behalf.
 *
 * The command line counts as a person channel only when stdin and stdout are a
 * terminal, the environment carries no agent-host or editor-terminal marker,
 * and no agent host or agent-capable editor is among this process's ancestors.
 * A model running the command through its host's shell tool, or typing into a
 * terminal pane an editor or agent host controls, fails at least one of those,
 * so its answer is recorded as relayed. When the ancestry cannot be read, the
 * answer is relayed too: not knowing is never taken as the person. This is not
 * proof against a program the person's own account runs on purpose; it stops a
 * model from approving on the person's behalf by running `construct inbox
 * resolve`.
 */

import { spawnSync } from 'node:child_process';
import type { DecisionChannel } from '../kernel/policy/channels.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';

export interface TerminalFacts {
  /** stdin and stdout are both attached to a terminal. */
  readonly interactive: boolean;
  /**
   * The first ancestor process that is an agent host, as its command line, or
   * UNREADABLE_ANCESTRY when the ancestors could not be read; null only when
   * every ancestor was read and none is an agent host.
   */
  readonly agentAncestor: string | null;
}

/** Stands in for an agent ancestor when the process tree could not be read. */
export const UNREADABLE_ANCESTRY = '(process ancestry could not be read)';

/** Interpreters a host's entry script runs under, so the script is the program that counts. */
const INTERPRETER = String.raw`(?:\S*\/)?(?:node|nodejs|bun|deno|sh|bash|zsh|python3?)(?:\s+-\S+)*\s+`;

/**
 * Agent hosts and editors whose terminals an agent can type into, as they
 * appear in a process's command line. Application bundles and distinctive
 * binary or package names match anywhere in it. Names that are also common
 * directory names (`code`, `studio`) match only as the program itself, or as
 * the script an interpreter runs, so a terminal multiplexer started in
 * ~/code is not taken for an editor.
 */
const AGENT_PROCESS: readonly RegExp[] = [
  /\/(?:Claude|Cursor|ChatGPT|Codex|Windsurf|Zed|Visual Studio Code(?: - Insiders)?|VSCodium|Warp|WarpPreview|Kiro|Trae(?: CN)?|Android Studio|IntelliJ IDEA[^/]*|PyCharm[^/]*|WebStorm|GoLand|Rider|CLion|DataGrip|PhpStorm|RubyMine|RustRover|Fleet|Aqua|DataSpell)\.app\//i,
  /\bCode(?: - Insiders)? Helper\b/,
  /JetBrains/i,
  /(?:^|\/)(?:claude|cursor-agent|codex|opencode|gemini|goose|aider|amp|copilot|copilot-language-server|cline|code-insiders|codium|warp-terminal|kiro|trae|idea|idea64|pycharm|webstorm|goland|rider|clion|datagrip|phpstorm|rubymine|rustrover)(?:\.sh)?(?:\s|$)/i,
  new RegExp(String.raw`^(?:${INTERPRETER})?(?:\S*\/)?(?:code|cn|studio|warp)(?:\.sh)?(?:\s|$)`, 'i'),
  /(?:^|\/)cursor-agent\//i,
  /@anthropic-ai\/claude-code|@openai\/codex|@google\/gemini-cli|opencode-ai|@block\/goose|@github\/copilot|@continuedev\/cli|\/node_modules\/cline\//i,
];

/** Whether a process command line (as `ps -o args=` prints it) is an agent host or an agent-capable editor. */
export function isAgentProcess(args: string): boolean {
  return AGENT_PROCESS.some((re) => re.test(args));
}

/** TERM_PROGRAM values set by the integrated terminals of editors and agent terminals. */
const RELAY_TERM_PROGRAMS: ReadonlySet<string> = new Set(['vscode', 'warpterminal', 'kiro', 'trae']);

/**
 * The environment marker, if any, saying this process runs in a terminal an
 * editor or agent host controls. Agent hosts' own markers are read by
 * `detectAmbientHost`; these are the editors' integrated terminals.
 */
export function relayMarkerIn(env: NodeJS.ProcessEnv): string | null {
  const program = env.TERM_PROGRAM?.toLowerCase();
  if (program && RELAY_TERM_PROGRAMS.has(program)) return `TERM_PROGRAM=${env.TERM_PROGRAM}`;
  if (env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return 'TERMINAL_EMULATOR=JetBrains-JediTerm';
  if (env.CURSOR_TRACE_ID !== undefined) return 'CURSOR_TRACE_ID';
  const vscode = Object.keys(env).find((key) => key.startsWith('VSCODE_'));
  return vscode ?? null;
}

/** Runs `ps` with these arguments. A seam for tests; production runs /bin/ps. */
export type PsRunner = (args: readonly string[]) => { readonly status: number | null; readonly stdout: string; readonly error?: Error };

/** The real `ps`, by absolute path so nothing earlier on PATH can answer for it. */
export const systemPs: PsRunner = (args) => {
  const r = spawnSync('/bin/ps', [...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout ?? '', error: r.error };
};

const MAX_DEPTH = 32;

/**
 * Walk `pid`'s ancestors and return the first that is an agent host, or
 * UNREADABLE_ANCESTRY if any step of the walk fails before it reaches the root.
 */
export function agentAncestorOf(pid: number, ps: PsRunner = systemPs): string | null {
  let current = pid;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (current < 1) return null;
    let r: ReturnType<PsRunner>;
    try {
      r = ps(['-o', 'ppid=,args=', '-p', String(current)]);
    } catch {
      return UNREADABLE_ANCESTRY;
    }
    if (r.error || r.status !== 0 || !r.stdout.trim()) return UNREADABLE_ANCESTRY;
    const match = /^\s*(\d+)\s+(.*)$/s.exec(r.stdout.trim());
    if (!match) return UNREADABLE_ANCESTRY;
    const [, parent, args] = match as unknown as [string, string, string];
    if (depth > 0 && isAgentProcess(args)) return args.slice(0, 200);
    current = Number(parent);
  }
  return UNREADABLE_ANCESTRY;
}

export function terminalFacts(ps: PsRunner = systemPs): TerminalFacts {
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  return { interactive, agentAncestor: interactive ? agentAncestorOf(process.pid, ps) : null };
}

/** The channel this invocation's answer arrives on. `facts` is a seam for tests. */
export function channelFor(env: NodeJS.ProcessEnv, facts: TerminalFacts = terminalFacts()): DecisionChannel {
  if (!facts.interactive) return 'relay';
  if (detectAmbientHost(env)) return 'relay';
  if (relayMarkerIn(env)) return 'relay';
  if (facts.agentAncestor) return 'relay';
  return 'tty_cli';
}

/** Who to record as answering, by channel. */
export function answeredBy(channel: DecisionChannel): string {
  return channel === 'tty_cli' ? 'person via cli' : 'relayed via cli (no person at a terminal)';
}
