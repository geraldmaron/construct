/**
 * cli/hear.ts — record ordinary talk as a run, without a tool name.
 *
 * Host prompt-submit hooks (Cursor `beforeSubmitPrompt`, Claude
 * `UserPromptSubmit`) launch this with the user's words on stdin. The host
 * runs the hook; the model does not choose a tool. A pass that only works
 * when someone types `record_outcome` is not this path.
 *
 * Seats are not inferred here. No keyword map, no phrase table, no folder
 * name treated as a catalog domain. `inferredBy` is `none` unless this
 * exact outcome text is already on the log, in which case nothing is
 * written again.
 */

import { readFileSync } from 'node:fs';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { startRunSeated } from '../kernel/run/outcome.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import type { Store } from '../kernel/store/open.ts';
import { now, withStore } from './runtime.ts';

export interface HearOpts {
  /** Hook payload or raw words. Tests inject this; the CLI reads fd 0. */
  readonly stdinText?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Injected; the kernel never reads the clock. */
  readonly now?: () => string;
}

function promptFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--prompt=')) return arg.slice('--prompt='.length);
    if (arg === '--prompt') return argv[i + 1];
  }
  return undefined;
}

function readDefaultStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Words a prompt-submit hook (or a test) just handed over.
 *
 * Cursor and Claude both put the user text on `prompt`. Anything else on
 * stdin is treated as the words themselves, not parsed for catalog tokens.
 */
export function wordsFromHookInput(argv: readonly string[], stdinText: string): string {
  const flagged = promptFlag(argv);
  if (flagged !== undefined) return flagged.trim();
  const rest = argv
    .filter((arg) => arg !== '--prompt' && !arg.startsWith('--prompt=') && !arg.startsWith('--'))
    .join(' ')
    .trim();
  if (rest.length > 0) return rest;
  const raw = stdinText.trim();
  if (raw.length === 0) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const prompt = (parsed as { prompt?: unknown }).prompt;
      if (typeof prompt === 'string') return prompt.trim();
    }
  } catch {
    // Not JSON. The hook body is the words.
  }
  return raw;
}

function runForOutcomeText(store: Store, outcome: string): string | undefined {
  for (const entry of readWorkLog(store)) {
    if (entry.action !== 'outcome-received') continue;
    const detail = entry.detail as { outcome?: unknown } | null;
    if (detail !== null && typeof detail.outcome === 'string' && detail.outcome === outcome) {
      return entry.run;
    }
  }
  return undefined;
}

function hookReply(run: string): string {
  return `${JSON.stringify({ continue: true, run })}\n`;
}

/**
 * Record the spoken words as a run. Always allows the host prompt to
 * continue. Creates nothing when there are no words.
 */
export function hear(argv: readonly string[] = [], opts: HearOpts = {}): number {
  const fromArgv = wordsFromHookInput(argv, '');
  const stdinText = fromArgv.length > 0 ? '' : (opts.stdinText ?? readDefaultStdin());
  const words = fromArgv.length > 0 ? fromArgv : wordsFromHookInput([], stdinText);
  if (words.length === 0) {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return 0;
  }

  return withStore((store) => {
    const existing = runForOutcomeText(store, words);
    if (existing !== undefined) {
      process.stdout.write(hookReply(existing));
      return 0;
    }

    const at = (opts.now ?? now)();
    const ambient = detectAmbientHost(opts.env ?? process.env);
    const started = startRunSeated(store, {
      runId: `run-${at.replace(/[-:.TZ]/g, '')}`,
      outcome: words,
      at,
      implicated: [],
      inferredBy: 'none',
      host: ambient === null ? 'hook' : `hook:${ambient.host}`,
    });
    process.stdout.write(hookReply(started.runId));
    return 0;
  });
}
