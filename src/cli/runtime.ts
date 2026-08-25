/**
 * cli/runtime.ts — what every verb needs before it can do anything: which
 * adapter a `--host` names, the store opened and closed around one command,
 * the clock, and this build's own version.
 *
 * The CLI is the host here, so it is the CLI that supplies the clock and the
 * run id — the kernel does neither.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePaths } from '../kernel/paths.ts';
import { openStore } from '../kernel/store/open.ts';
import type { Store } from '../kernel/store/open.ts';
import { resolveStoreLocation } from './local-state.ts';
import { recordCatalogSighting } from '../kernel/store/catalog.ts';
import { DOMAINS } from '../kernel/implication/domains.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import type { Report } from '../kernel/render/report.ts';
import { createOpenCodeAdapter } from '../hosts/opencode/adapter.ts';
import { createClaudeAdapter } from '../hosts/claude/adapter.ts';
import { createCodexAdapter } from '../hosts/codex/adapter.ts';
import { createCursorAdapter } from '../hosts/cursor/adapter.ts';

/**
 * One host name to one adapter, everywhere a --host flag is honored. The
 * default stays opencode; unknown names are the callers' to refuse (work()
 * validates; outcome/ask/notes accept only what their usage line names).
 */
export { HOST_NAMES } from './host-names.ts';
export type { HostName } from './host-names.ts';

export function adapterForHost(
  host: string | undefined,
  opts: { readonly binary?: string; readonly model?: string; readonly dir?: string; readonly timeoutMs?: number },
): HostAdapter {
  if (host === 'claude') return createClaudeAdapter(opts);
  if (host === 'codex') return createCodexAdapter(opts);
  if (host === 'cursor') return createCursorAdapter(opts);
  return createOpenCodeAdapter(opts);
}

export function packageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return (parsed as { version: string }).version;
}

/**
 * The spine commands. The CLI is the host here, so it is the CLI that supplies
 * the clock and the run id — the kernel does neither.
 */
export function withStore<T>(fn: (store: Store) => T): T {
  const store = openStore(resolveStoreLocation(process.cwd(), process.env).path);
  try {
    leaveCatalogMark(store);
    return fn(store);
  } finally {
    store.close();
  }
}

/**
 * Every open leaves word of the catalog this build carries. The store is the
 * one place every Construct on the machine visits — the released binary a host
 * launches and the newer tree the user runs — so it is where an older build's
 * catalog reads learn they are behind. Advance-only in the store; recording
 * the same or an older catalog writes nothing.
 */
function leaveCatalogMark(store: Store): void {
  recordCatalogSighting(store, {
    version: packageVersion(),
    domains: DOMAINS.length,
    at: now(),
  });
}

/**
 * The async twin. Separate rather than generic over both, because a `finally`
 * that closes the store around a function returning a promise closes it while
 * the work is still running — the failure mode is a coordinator writing to a
 * closed database, and it only shows up under load.
 */
export async function withStoreAsync<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const store = openStore(resolveStoreLocation(process.cwd(), process.env).path);
  try {
    leaveCatalogMark(store);
    return await fn(store);
  } finally {
    store.close();
  }
}

export function now(): string {
  return new Date().toISOString();
}

/** Where the token-signing secret lives: next to the store it guards. */
export function secretFile(): string {
  return join(resolvePaths().dataDir, 'capability-secret');
}

/** The operator's own two streams, as the sink a long kernel pass reports into. */
export const terminalReport: Report = {
  say: (text) => {
    process.stdout.write(text);
  },
  warn: (text) => {
    process.stderr.write(text);
  },
};
