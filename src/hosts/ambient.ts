/**
 * hosts/ambient.ts — which host, if any, this process is already running
 * inside, read from the environment markers hosts set on their own
 * subprocesses.
 *
 * This is presence, not spawn capability. An ambient host can be detected
 * and still have no wired adapter to spawn (Bob today). In-session dispatch
 * does not need a spawn adapter: `work` hands the session the tasks through
 * `construct serve`. Detection stays a separate fact from spawnability —
 * the caller (`cli/work.ts`, `cli/outcome.ts`, the doctor surface) decides
 * what to do with the two facts together.
 *
 * Detection lives here, in the hosts layer, deliberately: the kernel reads no
 * env beyond `kernel/paths.ts`, and an ambient host is exactly the kind of
 * outside-world fact the kernel is not supposed to know.
 *
 * Each marker below is verified against a primary source, not guessed:
 *
 * - `CLAUDECODE=1` and `CLAUDE_CODE_ENTRYPOINT` are set by Claude Code on
 *   every subprocess it spawns (Anthropic's own env-vars reference).
 * - `CURSOR_AGENT` and `CURSOR_CLI` are set by Cursor's agent and integrated
 *   terminal respectively (Cursor's own forum threads on the topic).
 * - `BOB_SHELL_CLI_IDE_SERVER_PORT` is IBM's own documented Bob Shell
 *   variable, but it is scoped to dev-container IDE integration in IBM's
 *   docs, not to every Bob session — so a Bob CLI session outside that
 *   integration is invisible to this module. No broader Bob session marker
 *   is documented anywhere IBM publishes; this is a known detection gap, not
 *   an oversight, and it is recorded rather than papered over with a guess.
 * - Codex CLI has no marker at all: a request to add one (`AGENT=codex`, the
 *   same convention Goose and Amp already follow) was filed against
 *   `openai/codex` and closed as not planned. There is nothing to key on, so
 *   codex is not detected ambiently here — dispatch to codex stays reachable
 *   through `--host=codex` exactly as before.
 * - `TERM_PROGRAM` was named as a candidate marker in the decision this
 *   module implements, but it does not hold up: Cursor's integrated terminal
 *   reports `TERM_PROGRAM=vscode`, identical to plain VS Code, so the value
 *   cannot distinguish the host it claims to identify. It is not used as a
 *   positive signal for that reason — a wrong host name would be worse than
 *   no name.
 */

export type AmbientHostName = 'claude' | 'cursor' | 'bob';

export interface AmbientDetection {
  /** The host this process is running inside, by the name its adapter (if any) uses. */
  readonly host: AmbientHostName;
  /** The env var whose presence matched, so the detection can be explained rather than asserted. */
  readonly marker: string;
}

/**
 * Every env var this module reads, in one place: the source of truth for
 * both detection and for a test wanting to guarantee a sterile, marker-free
 * environment (the same env keys, cleared, is the regression case).
 */
export const AMBIENT_ENV_KEYS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CURSOR_AGENT',
  'CURSOR_CLI',
  'BOB_SHELL_CLI_IDE_SERVER_PORT',
] as const;

interface Detector {
  readonly host: AmbientHostName;
  /** Returns the matched marker's env var name, or null if this detector found nothing. */
  readonly check: (env: NodeJS.ProcessEnv) => string | null;
}

// Checked in this order: the most specific, most-verified markers first, so a
// process that happens to carry more than one host's leftover env (a Cursor
// terminal opened from inside Claude Code, say) resolves to the host it is
// actually running inside right now rather than whichever detector runs last.
const DETECTORS: readonly Detector[] = [
  {
    host: 'claude',
    check: (env) => {
      if (env.CLAUDECODE === '1') return 'CLAUDECODE';
      if (env.CLAUDE_CODE_ENTRYPOINT !== undefined) return 'CLAUDE_CODE_ENTRYPOINT';
      return null;
    },
  },
  {
    host: 'cursor',
    check: (env) => {
      if (env.CURSOR_AGENT !== undefined) return 'CURSOR_AGENT';
      if (env.CURSOR_CLI !== undefined) return 'CURSOR_CLI';
      return null;
    },
  },
  {
    host: 'bob',
    check: (env) => {
      if (env.BOB_SHELL_CLI_IDE_SERVER_PORT !== undefined) return 'BOB_SHELL_CLI_IDE_SERVER_PORT';
      return null;
    },
  },
];

/**
 * The ambient host this process is running inside, or null when nothing
 * matched. `env` defaults to the real environment; a caller under test passes
 * a fabricated one so the result never depends on what actually launched the
 * test runner.
 */
export function detectAmbientHost(env: NodeJS.ProcessEnv = process.env): AmbientDetection | null {
  for (const detector of DETECTORS) {
    const marker = detector.check(env);
    if (marker !== null) return { host: detector.host, marker };
  }
  return null;
}
